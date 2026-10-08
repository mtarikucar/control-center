import { DEFAULT_CONSTITUTION, OWNER, type BudgetSummary, type Constitution, type CycleTrigger, type CycleTriggerKind, type OfficeEvent, type StoredEvent, type Task, type TaskStatus } from '@cc/shared';
import { ConflictError, ForbiddenError, ValidationError } from '../errors.ts';
import type { EventStore } from '../event-store.ts';
import type { Roster } from '../roster.ts';
import type { Board, BoardOptions } from './board.ts';
import { constitutionChanges } from './budget.ts';
import type { Company } from './company.ts';
import type { CompanyStateStore } from './goal-store.ts';
import type { DueReport } from './scheduling.ts';
import { OPEN_STATUSES, type TaskStore } from './store.ts';
import { clean, fold, lines } from './text.ts';

const MIN = 60_000;
/** Triggers within this long of the first one waiting go into the same cycle (§3.1, “toplama penceresi”). */
export const CYCLE_WINDOW_MS = 2 * MIN;
/** While work is open a cycle comes at least this often, events or not (§3.1, “kalp atışı”). */
export const HEARTBEAT_MS = 45 * MIN;
/** How often the office clock looks whether a cycle is due. */
export const CYCLE_CHECK_MS = 30_000;
/** Triggers listed for one cycle; more are not (the board reads the log either way). */
const MAX_TRIGGERS = 50;

/** What lasts across a restart (company_state): the last start, the triggers waiting, the cycle open, an unclosed one. */
const KEY = { lastStart: 'cycle.lastStartAt', pending: 'cycle.pending', open: 'cycle.open', unclosed: 'cycle.unclosed' } as const;

const PLAN_TR: Partial<Record<string, string>> = { approved: 'onaylandı', declined: 'onaylanmadı', kept: 'revizyonu onaylanmadı', done: 'bitti', stopped: 'sahibince durduruldu' };

export interface CycleDeps {
  events: Pick<EventStore, 'append' | 'subscribe'>;
  state: CompanyStateStore;
  company: Pick<Company, 'coordinator' | 'paused' | 'goals' | 'nameOf'>;
  roster: Pick<Roster, 'get'>;
  tasks: Pick<TaskStore, 'list' | 'get'>;
  /** The board (buildBoard over the office's services). */
  board: (o: BoardOptions) => Board;
  /** The owner's reserve (no heartbeat while it holds) and the constitution (a change of it is a constraint). */
  budget?: { reserveActive(): boolean; constitution(): Constitution };
  /** The office clock: the due check is one of its jobs; its runs report the tasks that just passed their due date. */
  clock?: { every(name: string, ms: number, fn: () => void): void; onRan(fn: (report: DueReport) => void): void };
  now?: () => number;
}

/** The cycle the coordinator is in: from the board's delivery to the end of the turn that carried it. */
interface OpenCycle {
  startedAt: number;
  since: number;
  triggers: CycleTrigger[];
  /** What the turn's results cost so far (null: none yet). */
  costUsd: number | null;
  /** cycleClose recorded it. */
  closed: boolean;
}

/** What a cycle opens with: the board, and why it opened. */
export interface CycleOpening {
  at: number;
  /** The previous cycle's start (0: the first). */
  since: number;
  triggers: CycleTrigger[];
  unclosedWarning: boolean;
  /** The board's text, the cycle's first message. */
  text: string;
  /** The board's kickoff (no active goal, or a goal without a running plan): for the model routing. */
  kickoff: boolean;
}

/** The events the cycle reads; any other is passed by at once. */
const WATCHED = new Set<OfficeEvent['type']>(['task.changed', 'plan.changed', 'goal.changed', 'company.paused', 'budget.changed', 'turn.finished', 'lifecycle.changed']);

/** Logged under the coordinator's desk although the owner or the office did it: the owner's plan and goal decisions, a pause, a plan the office finished. */
function onDesk(ev: OfficeEvent): boolean {
  if (ev.type === 'company.paused') return true;
  if (ev.type === 'goal.changed') return ev.change === 'stopped';
  if (ev.type === 'plan.changed') return ev.change === 'declined' || ev.change === 'kept' || ev.change === 'stopped' || ev.change === 'done' || (ev.change === 'approved' && ev.plan.approvedBy === 'owner');
  return false;
}

const closedStatus = (s: TaskStatus) => s === 'done' || s === 'cancelled';
const windowOf = (t: CycleTrigger) => (t.kind === 'start' ? 0 : CYCLE_WINDOW_MS);
const same = (a: CycleTrigger, b: CycleTrigger) => a.kind === b.kind && a.note === b.note;
const identical = (a: CycleTrigger, b: CycleTrigger) => same(a, b) && a.at === b.at && a.seq === b.seq;

function parse<T>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * The coordinator's management cycle (spec 2026-10-08-management-cycle-design §3.1, §3.3, §5): the office watches the
 * event log and says when a cycle is due — the work changed (a hand-in, a review decision, someone left with no work, a
 * plan's or a goal's status, a constraint, a stall), at the latest every HEARTBEAT_MS while work is open, once when the
 * office starts with work open. Triggers close together go into one cycle (CYCLE_WINDOW_MS from the first). Nothing the
 * coordinator does itself is a trigger: what is logged under its desk (but for what the owner or the office logs there)
 * and whatever happens inside its own tool calls (`acting`). Nothing while the company is paused, no heartbeat in the
 * owner's reserve, nothing without a coordinator. The dispatcher delivers a due cycle and says so (`started`); the turn
 * ends with cycleClose (`close`) or is logged not closed (`ended`), and the next board warns. What it needs to survive a
 * restart is kept in company_state.
 */
export class ManagementCycle {
  readonly #d: CycleDeps;
  readonly #now: () => number;
  readonly #listeners = new Set<() => void>();
  /** Who is acting now: an office tool's caller, during the synchronous part of the call. */
  #actor: string | null = null;
  /** Each open task's holder and status as last seen: who a task left, and whether a block is new. */
  readonly #holders = new Map<string, { assignee: string; status: TaskStatus }>();
  /** The constitution and the reserve as last announced (a budget.changed changing neither is only spending). */
  #constitution: Constitution = DEFAULT_CONSTITUTION;
  #reserve = false;
  /** The last moment the office had no open work: the heartbeat counts from it or from the last cycle, the later. */
  #quietAt = 0;
  #running = false;

  constructor(d: CycleDeps) {
    this.#d = d;
    this.#now = d.now ?? Date.now;
  }

  start(): () => void {
    this.#running = true;
    const now = this.#now();
    this.#quietAt = now;
    this.#holders.clear();
    for (const t of this.#d.tasks.list({ statuses: OPEN_STATUSES, limit: 100_000 })) this.#holders.set(t.id, { assignee: t.assignee, status: t.status });
    this.#constitution = this.#d.budget?.constitution() ?? DEFAULT_CONSTITUTION;
    this.#reserve = this.#d.budget?.reserveActive() ?? false;
    // A cycle the stopped office left open: its turn ended with that run.
    if (this.#open()) this.ended();
    if (this.#d.company.coordinator() && this.#openWork()) this.#push({ kind: 'start', at: now, note: '', seq: null });
    const off = this.#d.events.subscribe((e) => this.#onEvent(e));
    if (this.#d.clock) {
      this.#d.clock.every('management.cycle', CYCLE_CHECK_MS, () => this.#tick());
      this.#d.clock.onRan((report) => this.#overdue(report));
    }
    return () => {
      this.#running = false;
      off();
    };
  }

  /** Runs `fn` as `employeeId`'s own action (an office tool's call): what it logs is theirs, not a trigger when it is the coordinator's. */
  acting<T>(employeeId: string, fn: () => T): T {
    const outer = this.#actor;
    this.#actor = employeeId;
    try {
      return fn();
    } finally {
      this.#actor = outer;
    }
  }

  /** Called when a cycle may have become due (the dispatcher looks at the coordinator). */
  onDue(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => void this.#listeners.delete(fn);
  }

  /** A cycle should open now (the coordinator gets the board when it is free). */
  due(now: number = this.#now()): boolean {
    if (!this.#d.company.coordinator() || this.#d.company.paused() || this.#open()) return false;
    const pending = this.#pending();
    if (pending.length > 0) return now >= Math.min(...pending.map((t) => t.at + windowOf(t)));
    return this.#heartbeatDue(now);
  }

  /** Triggers wait in their window: a cycle is on its way (the coordinator's decisions wait for it). */
  waiting(now: number = this.#now()): boolean {
    return this.#pending().length > 0 && !this.#open() && !this.due(now);
  }

  /** The coordinator is in a cycle's turn. */
  isOpen(): boolean {
    return this.#open() !== null;
  }

  /** What the due cycle opens with: the board since the previous cycle, and its triggers (the heartbeat when none wait). */
  opening(now: number = this.#now()): CycleOpening {
    const pending = this.#pending();
    const triggers: CycleTrigger[] = pending.length > 0 ? pending : [{ kind: 'heartbeat', at: now, note: '', seq: null }];
    const since = this.#lastStart();
    const unclosedWarning = this.#d.state.get(KEY.unclosed) === 'true';
    let board: Board;
    try {
      board = this.#d.board({ since, now, unclosedWarning });
    } catch (err) {
      // The board never stops the office: the cycle goes on, and the coordinator reads the office with its tools.
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      this.#d.events.append(this.#d.company.coordinator()?.id ?? null, { type: 'error', message: `Yönetim panosu hazırlanamadı: ${message}` });
      board = { text: `Yönetim panosu hazırlanamadı (${message}). Ofisi officeStatus, agendaRead, goalsRead ve budgetStatus ile oku.`, kickoff: false };
    }
    return { at: now, since, triggers, unclosedWarning, text: board.text, kickoff: board.kickoff };
  }

  /** The board went to the coordinator: the cycle is open and logged; its triggers are spent, later ones wait for the next. */
  started(o: CycleOpening): void {
    this.#savePending(this.#pending().filter((t) => !o.triggers.some((x) => identical(x, t))));
    this.#d.state.set(KEY.lastStart, String(o.at));
    this.#d.state.set(KEY.unclosed, null);
    this.#saveOpen({ startedAt: o.at, since: o.since, triggers: o.triggers, costUsd: null, closed: false });
    this.#d.events.append(this.#d.company.coordinator()?.id ?? null, { type: 'management.cycle.started', triggers: o.triggers, since: o.since, unclosedWarning: o.unclosedWarning });
  }

  /** The board never reached the coordinator (no session could read it): its triggers wait again, as if it had not gone. */
  lost(o: CycleOpening): void {
    const open = this.#open();
    if (open && open.startedAt === o.at) {
      this.#saveOpen(null);
      this.#d.state.set(KEY.lastStart, o.since > 0 ? String(o.since) : null);
      if (o.unclosedWarning) this.#d.state.set(KEY.unclosed, 'true');
    }
    const kept = this.#pending();
    const back = o.triggers.filter((t) => t.kind !== 'heartbeat' && !kept.some((x) => same(x, t)));
    this.#savePending([...back, ...kept].slice(0, MAX_TRIGGERS));
  }

  /** The turn that carried the board is over. Without cycleClose it is logged not closed, once, and the next board warns. */
  ended(): void {
    const open = this.#open();
    if (!open) return;
    this.#saveOpen(null);
    if (open.closed) return;
    this.#d.state.set(KEY.unclosed, 'true');
    this.#record(false, open, { changes: [], reasoning: '', next: null });
  }

  /** cycleClose: the coordinator closes the open cycle with what it changed and why (with no change, “değişiklik yok, çünkü …”). */
  close(by: string, input: { changes?: string[]; reasoning?: string; next?: string }): { changes: string[] } {
    const c = this.#d.company.coordinator();
    if (!c || c.id !== by) throw new ForbiddenError('Yönetim turunu yalnız koordinatör kapatır.');
    const open = this.#open();
    if (!open) throw new ConflictError('Açık bir yönetim turu yok: cycleClose yalnız yönetim panosuyla açılan turu kapatır.');
    if (open.closed) throw new ConflictError('Bu yönetim turu zaten kapandı.');
    const changes = lines(input.changes, 'Değişiklikler', 20, 300);
    const reasoning = clean(input.reasoning, 'Gerekçe', 2000, true);
    const next = clean(input.next, 'Sonraki tur', 500, false) || null;
    if (changes.length === 0 && !fold(reasoning).includes('degisiklik yok')) throw new ValidationError('Değişiklik yoksa gerekçeyi “değişiklik yok, çünkü …” diye yaz.');
    this.#saveOpen({ ...open, closed: true });
    this.#record(true, open, { changes, reasoning, next });
    return { changes };
  }

  /** A trigger the office saw without an event of its own (someone still at a task after the reminder). */
  trigger(kind: CycleTriggerKind, note: string): void {
    if (!this.#d.company.coordinator()) return;
    this.#push({ kind, at: this.#now(), note, seq: null });
  }

  #onEvent(e: StoredEvent): void {
    const ev = e.event;
    if (!WATCHED.has(ev.type)) return;
    // A turn's end and cost matter only to an open cycle.
    if ((ev.type === 'turn.finished' || ev.type === 'lifecycle.changed') && (e.employeeId === null || !this.#open())) return;
    // Kept up to date whoever acted: the next event is judged against it.
    const before = ev.type === 'task.changed' ? this.#track(ev.task) : undefined;
    const constraint = ev.type === 'budget.changed' ? this.#constraintOf(ev.budget) : null;
    const c = this.#d.company.coordinator();
    if (!c) return;
    if (e.employeeId === c.id) this.#coordinatorEvent(ev);
    if (this.#actor === c.id || (e.employeeId === c.id && !onDesk(ev))) return;
    for (const t of this.#triggersOf(e, c.id, before, constraint)) this.#push(t);
  }

  /** The cycle's turn: its cost, and its end (the coordinator leaves `working`). */
  #coordinatorEvent(ev: OfficeEvent): void {
    const open = this.#open();
    if (!open) return;
    if (ev.type === 'turn.finished') this.#saveOpen({ ...open, costUsd: Math.round(((open.costUsd ?? 0) + ev.costUsd) * 1e6) / 1e6 });
    else if (ev.type === 'lifecycle.changed' && ev.from === 'working' && ev.to !== 'working') this.ended();
  }

  #triggersOf(e: StoredEvent, coordinatorId: string, before: { assignee: string; status: TaskStatus } | undefined, constraint: string | null): CycleTrigger[] {
    const ev = e.event;
    const at = (kind: CycleTriggerKind, note: string): CycleTrigger => ({ kind, at: e.ts, note, seq: e.seq });
    const name = (id: string) => this.#d.company.nameOf(id);
    switch (ev.type) {
      case 'task.changed': {
        const t = ev.task;
        const out: CycleTrigger[] = [];
        if (t.kind !== 'review' && (ev.change === 'in_review' || ev.change === 'finished')) out.push(at('delivery', `“${t.title}” (${name(t.assignee)})`));
        if (ev.change === 'reviewed') out.push(at('review', this.#reviewNote(t)));
        if (t.status === 'blocked' && before?.status !== 'blocked') out.push(at('stuck', `“${t.title}” takıldı (${name(t.assignee)})`));
        // The task left its holder (closed, or moved to someone else) and they hold nothing now.
        const left = before && (closedStatus(t.status) || before.assignee !== t.assignee) ? before.assignee : null;
        if (left && this.#free(left, coordinatorId)) out.push(at('idle', name(left)));
        return out;
      }
      case 'plan.changed': {
        const what = PLAN_TR[ev.change];
        return what ? [at('plan', `“${ev.plan.title}” planı ${what}`)] : [];
      }
      case 'goal.changed': {
        if (ev.change === 'updated') return [];
        const what = ev.change === 'set' ? 'açıldı' : ev.change === 'stopped' ? 'sahibince durduruldu' : ev.goal.status === 'done' ? 'tamamlandı' : 'bırakıldı';
        return [at('goal', `“${ev.goal.title}” hedefi ${what}`)];
      }
      case 'company.paused':
        return ev.paused ? [] : [at('constraint', 'sahibi şirketi sürdürdü')];
      case 'budget.changed':
        return constraint ? [at('constraint', constraint)] : [];
      default:
        return [];
    }
  }

  /** Remembers the task as it now stands; returns how it stood before (undefined: not open before). */
  #track(t: Task): { assignee: string; status: TaskStatus } | undefined {
    const before = this.#holders.get(t.id);
    if (closedStatus(t.status)) this.#holders.delete(t.id);
    else this.#holders.set(t.id, { assignee: t.assignee, status: t.status });
    return before;
  }

  /** Someone who could take work holds no open task. */
  #free(id: string, coordinatorId: string): boolean {
    if (id === coordinatorId || id === OWNER) return false;
    try {
      const e = this.#d.roster.get(id);
      if (e.kind === 'coordinator' || e.lifecycle === 'archived') return false;
    } catch {
      return false;
    }
    return this.#d.tasks.list({ assignee: id, statuses: OPEN_STATUSES, limit: 1 }).length === 0;
  }

  #reviewNote(review: Task): string {
    let title = review.title;
    try {
      if (review.reviewOf) title = this.#d.tasks.get(review.reviewOf).title;
    } catch {
      // The reviewed task is gone: the review's own title says enough.
    }
    return `“${title}”: ${review.result?.review?.decision === 'changes' ? 'değişiklik istendi' : 'onaylandı'} (${this.#d.company.nameOf(review.assignee)})`;
  }

  /** What changed in a budget announcement: the constitution, the reserve; null when only the money moved. */
  #constraintOf(b: BudgetSummary): string | null {
    const rules = constitutionChanges(this.#constitution, b.constitution);
    const reserve = b.reserve.active === this.#reserve ? null : b.reserve.active ? 'sahibinin kota payı devreye girdi' : 'sahibinin kota payı serbest kaldı';
    this.#constitution = b.constitution;
    this.#reserve = b.reserve.active;
    const parts = [rules.length ? `anayasa: ${rules.join('; ')}` : null, reserve].filter((p): p is string => p !== null);
    return parts.length ? parts.join('; ') : null;
  }

  /** Tasks the clock just found past their due date. */
  #overdue(report: DueReport): void {
    if (!this.#running || !this.#d.company.coordinator()) return;
    for (const id of report.overdue) {
      try {
        const t = this.#d.tasks.get(id);
        this.#push({ kind: 'stuck', at: this.#now(), note: `“${t.title}” son tarihi geçti (${this.#d.company.nameOf(t.assignee)})`, seq: null });
      } catch {
        // Gone since: nothing to look at.
      }
    }
  }

  /** The clock's look: the heartbeat's quiet time, and a cycle that became due. */
  #tick(): void {
    if (!this.#running) return;
    if (!this.#openWork()) this.#quietAt = this.#now();
    if (this.due()) this.#notify();
  }

  #heartbeatDue(now: number): boolean {
    if (this.#d.budget?.reserveActive()) return false;
    if (!this.#openWork()) return false;
    return now - Math.max(this.#lastStart(), this.#quietAt) >= HEARTBEAT_MS;
  }

  /** An active goal or an open task. */
  #openWork(): boolean {
    return this.#d.company.goals().some((g) => g.status === 'active') || this.#d.tasks.list({ statuses: OPEN_STATUSES, limit: 1 }).length > 0;
  }

  /** Waits for the next cycle; the same thing twice (a hand-in, then its approval) is one trigger. */
  #push(t: CycleTrigger): void {
    const pending = this.#pending();
    if (pending.some((p) => same(p, t)) || pending.length >= MAX_TRIGGERS) return;
    this.#savePending([...pending, t]);
    if (this.due()) this.#notify();
  }

  #notify(): void {
    for (const fn of this.#listeners) {
      try {
        fn();
      } catch {
        // A listener's failure is its own.
      }
    }
  }

  #record(closed: boolean, open: OpenCycle, body: { changes: string[]; reasoning: string; next: string | null }): void {
    this.#d.events.append(this.#d.company.coordinator()?.id ?? null, { type: 'management.cycle', closed, startedAt: open.startedAt, triggers: open.triggers, ...body, costUsd: open.costUsd });
  }

  #lastStart(): number {
    return Number(this.#d.state.get(KEY.lastStart) ?? '0') || 0;
  }

  #pending(): CycleTrigger[] {
    const list = parse<unknown>(this.#d.state.get(KEY.pending), []);
    return Array.isArray(list) ? (list as CycleTrigger[]) : [];
  }

  #savePending(list: CycleTrigger[]): void {
    this.#d.state.set(KEY.pending, list.length ? JSON.stringify(list) : null);
  }

  #open(): OpenCycle | null {
    const open = parse<OpenCycle | null>(this.#d.state.get(KEY.open), null);
    return open && typeof open === 'object' && typeof open.startedAt === 'number' ? open : null;
  }

  #saveOpen(open: OpenCycle | null): void {
    this.#d.state.set(KEY.open, open ? JSON.stringify(open) : null);
  }
}
