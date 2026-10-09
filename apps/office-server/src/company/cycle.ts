import { DEFAULT_CONSTITUTION, MODEL_ALIASES, OWNER, normalizeConstitution, saysNoChange, type BudgetSummary, type Constitution, type CycleTrigger, type CycleTriggerKind, type ManagementCycleRecord, type ManagementLog, type ModelAlias, type OfficeEvent, type StoredEvent, type Task, type TaskStatus } from '@cc/shared';
import { ConflictError, ForbiddenError, ValidationError } from '../errors.ts';
import type { EventStore } from '../event-store.ts';
import type { Roster } from '../roster.ts';
import type { Board, BoardOptions } from './board.ts';
import { constitutionChanges } from './budget.ts';
import type { Company } from './company.ts';
import type { CompanyStateStore } from './goal-store.ts';
import { CLOCK_LAST_RUN, type DueReport } from './scheduling.ts';
import { OPEN_STATUSES, type TaskStore } from './store.ts';
import { clean, fold, lines } from './text.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
/** Triggers within this long of the first one waiting go into the same cycle (§3.1, “toplama penceresi”). */
export const CYCLE_WINDOW_MS = 2 * MIN;
/**
 * While work is open the office looks this often, events or not (§3.1, “kalp atışı”): within the hour the CLI keeps
 * the coordinator's prompt cache (it writes it for an hour, whatever cacheTtlMinutes says). A look whose board says
 * nothing new is passed by (MAX_SKIPS) and costs nothing; the cycle that opens after skips may find the cache cold
 * (a cold turn writes the whole context anew, ≈ $3, 3fe9707b) — still cheaper than three warm turns that change nothing.
 */
export const HEARTBEAT_MS = 45 * MIN;
/**
 * Heartbeats in a row passed by for a board with nothing new (the next one opens the cycle whatever the board says) — 0,
 * none, as the office runs today: the coordinator's whole conversation lives in one session, so a skipped look makes the
 * next cycle cold (≈ $3 for a 400k context) — dearer than the warm empty turns it saves (≈ $0.25 each). Worth turning on
 * (maxSkips) once its sessions are small. The machinery stays tested with 3.
 */
export const MAX_SKIPS = 0;
/** The management log's length when none is asked for, and the most it gives (§3.3, the owner's Yönetim tab). */
export const LOG_DEFAULT = 50;
export const LOG_MAX = 200;
/** How often the office clock looks whether a cycle is due. */
export const CYCLE_CHECK_MS = 30_000;
/** Triggers listed for one cycle; more are not (the board reads the log either way). */
const MAX_TRIGGERS = 50;

/**
 * What lasts across a restart (company_state): the last start, the triggers waiting, the cycle open, an unclosed one,
 * the end of the last rest already turned into a trigger; the board's shape as the last cycle's turn left it, the
 * heartbeats passed by since, and the last of them.
 */
const KEY = {
  lastStart: 'cycle.lastStartAt', pending: 'cycle.pending', open: 'cycle.open', unclosed: 'cycle.unclosed', restEnded: 'cycle.restEndedAt',
  shape: 'cycle.shape', skips: 'cycle.skips', skippedAt: 'cycle.skippedAt', endSeq: 'cycle.endSeq',
} as const;

const PLAN_TR: Partial<Record<string, string>> = { approved: 'onaylandı', declined: 'onaylanmadı', kept: 'revizyonu onaylanmadı', done: 'bitti', stopped: 'sahibince durduruldu' };

export interface CycleDeps {
  events: Pick<EventStore, 'append' | 'subscribe' | 'since' | 'lastTs'>;
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
  /** Heartbeats in a row a board with nothing new may pass by (default MAX_SKIPS). */
  maxSkips?: number;
  now?: () => number;
}

/** What cycleClose said. */
interface CycleClose {
  changes: string[];
  reasoning: string;
  next: string | null;
}

/** The cycle the coordinator is in: from the board's delivery to the end of the turn that carried it. */
interface OpenCycle {
  startedAt: number;
  since: number;
  triggers: CycleTrigger[];
  /** What the turn's results cost so far (null: none yet). */
  costUsd: number | null;
  /** cycleClose's words, kept until the turn ends and the cycle is recorded (null: not closed yet). */
  close: CycleClose | null;
  /** The model the cycle runs on (§3.5): the engine's word at delivery, the old one if the switch failed (absent: kept by an older office). */
  model?: ModelAlias | null;
  /**
   * The board's own turn gave its result with more queued: what follows are the turns of messages written meanwhile (the
   * owner's), not the cycle's — their cost stays out of its record (review K4). The cycle still ends as the engine's turn does.
   */
  ownTurnDone?: boolean;
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
  /** The board's kickoff (no active goal, or none with a running plan): for the model routing. */
  kickoff: boolean;
}

/** The events that may be triggers; any other is passed by (but for the cycle turn's own steps). */
const WATCHED = new Set<OfficeEvent['type']>(['task.changed', 'plan.changed', 'goal.changed', 'company.paused', 'budget.changed']);
/** Lifecycles in which the cycle's turn is gone: it will not go on. */
const TURN_GONE = new Set<string>(['interrupted', 'error', 'stopped', 'archived', 'in_terminal']);
/** What the coordinator's session itself logs while it works: the end of a cycle the stopped office left open is the last of these. */
const SESSION_WORK: OfficeEvent['type'][] = ['message.assistant', 'tool.started', 'tool.finished', 'turn.finished'];
/** Why a board is lost (the engine reports only that no session read it). */
const LOST_REASON = 'Pano koordinatöre ulaşmadı: oturum okuyamadı; tetikleri bir sonraki tura kaldı.';
/** A reason beyond “değişiklik yok” (and “çünkü”) has at least this many letters. */
const REASON_LETTERS = 5;

/** Logged under the coordinator's desk although the owner or the office did it: the owner's plan and goal decisions, a pause, a plan the office finished. */
function onDesk(ev: OfficeEvent): boolean {
  if (ev.type === 'company.paused') return true;
  if (ev.type === 'goal.changed') return ev.change === 'stopped';
  if (ev.type === 'plan.changed') return ev.change === 'declined' || ev.change === 'kept' || ev.change === 'stopped' || ev.change === 'done' || (ev.change === 'approved' && ev.plan.approvedBy === 'owner');
  return false;
}

const closedStatus = (s: TaskStatus) => s === 'done' || s === 'cancelled';
/** A start and a heartbeat (looked at by the clock already) open at once; anything else waits for the window. */
const windowOf = (t: CycleTrigger) => (t.kind === 'start' || t.kind === 'heartbeat' ? 0 : CYCLE_WINDOW_MS);
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
 * plan's or a goal's status, a constraint, a stall), at the latest every HEARTBEAT_MS while work is open — but a
 * heartbeat whose board says what it said when the last cycle's turn ended is passed by and logged, at most MAX_SKIPS
 * in a row —, once when the office starts with work open; with no goal and no open work every pulseHours (0: never), but not while the
 * coordinator rests (restUntil), and once when its rest ends. Triggers close together go into one cycle
 * (CYCLE_WINDOW_MS from the first). Nothing the coordinator does itself is a trigger: what is logged under its desk (but
 * for what the owner or the office logs there) and whatever happens inside its own tool calls (`acting`). Nothing while
 * the company is paused (what waits comes with the resume), no heartbeat in the
 * owner's reserve, nothing without a coordinator. The dispatcher delivers a due cycle and says so (`started`); cycleClose
 * (`close`) gives the cycle its words; when the turn ends (`ended`) the cycle is recorded with the turn's cost — closed,
 * or not closed and the next board warns. What it needs to survive a restart is kept in company_state.
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
  /** The last moment the office had open work (or started): the idle heartbeat counts from it, the last cycle or a rest's end, the latest. */
  #workAt = 0;
  /** The cycle turn's last result came with nothing queued: the coordinator's next step says whether the engine ended the turn. */
  #resultIn = false;
  #running = false;

  constructor(d: CycleDeps) {
    this.#d = d;
    this.#now = d.now ?? Date.now;
  }

  start(): () => void {
    this.#running = true;
    const now = this.#now();
    this.#quietAt = now;
    this.#workAt = now;
    this.#holders.clear();
    for (const t of this.#d.tasks.list({ statuses: OPEN_STATUSES, limit: 100_000 })) this.#holders.set(t.id, { assignee: t.assignee, status: t.status });
    this.#constitution = normalizeConstitution(this.#d.budget?.constitution());
    this.#reserve = this.#d.budget?.reserveActive() ?? false;
    this.#seedRestEnd(now);
    // A cycle the stopped office left open: its turn ended with that run, at the coordinator's last work in it (not now).
    const left = this.#open();
    if (left) {
      const c = this.#d.company.coordinator();
      this.ended(c ? this.#d.events.lastTs(c.id, left.startedAt, SESSION_WORK) : null);
    }
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
    let board: Pick<Board, 'text' | 'kickoff'>;
    try {
      board = this.#d.board({ since, now, unclosedWarning, startAfter: Number(this.#d.state.get(KEY.endSeq) ?? '0') || 0 });
    } catch (err) {
      // The board never stops the office: the cycle goes on, and the coordinator reads the office with its tools.
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      this.#d.events.append(this.#d.company.coordinator()?.id ?? null, { type: 'error', message: `Yönetim panosu hazırlanamadı: ${message}` });
      board = { text: `Yönetim panosu hazırlanamadı (${message}). Ofisi officeStatus, agendaRead, goalsRead ve budgetStatus ile oku.`, kickoff: false };
    }
    return { at: now, since, triggers, unclosedWarning, text: board.text, kickoff: board.kickoff };
  }

  /**
   * The board went to the coordinator, on `model` (the model the engine runs it on): the cycle is open and logged; its
   * triggers are spent, later ones wait for the next.
   */
  started(o: CycleOpening, model: ModelAlias | null = null): void {
    this.#savePending(this.#pending().filter((t) => !o.triggers.some((x) => identical(x, t))));
    this.#d.state.set(KEY.lastStart, String(o.at));
    this.#d.state.set(KEY.unclosed, null);
    this.#saveOpen({ startedAt: o.at, since: o.since, triggers: o.triggers, costUsd: null, close: null, model });
    this.#d.events.append(this.#d.company.coordinator()?.id ?? null, { type: 'management.cycle.started', triggers: o.triggers, since: o.since, unclosedWarning: o.unclosedWarning });
  }

  /** The board never reached the coordinator (no session could read it): its triggers wait again, as if it had not gone. */
  lost(o: CycleOpening): void {
    const open = this.#open();
    if (open && open.startedAt === o.at) {
      this.#saveOpen(null);
      this.#d.state.set(KEY.lastStart, o.since > 0 ? String(o.since) : null);
      if (o.unclosedWarning) this.#d.state.set(KEY.unclosed, 'true');
      // The owner's page shows the cycle going on until it hears it is not.
      this.#d.events.append(this.#d.company.coordinator()?.id ?? null, { type: 'management.cycle.lost', startedAt: o.at, reason: LOST_REASON });
    }
    const kept = this.#pending();
    const back = o.triggers.filter((t) => t.kind !== 'heartbeat' && !kept.some((x) => same(x, t)));
    this.#savePending([...back, ...kept].slice(0, MAX_TRIGGERS));
  }

  /**
   * The turn that carried the board is over: the cycle is recorded — closed with cycleClose's words, or not closed (once;
   * the next board warns) — with what its turn cost and when it ended (`endedAt`: now, unless the caller knows better;
   * null when no one does).
   */
  ended(endedAt: number | null = this.#now()): void {
    const open = this.#open();
    if (!open) return;
    this.#saveOpen(null);
    this.#resultIn = false;
    if (!open.close) this.#d.state.set(KEY.unclosed, 'true');
    // The board as the turn left it (what the coordinator did in it included): the next heartbeat is measured against it.
    this.#d.state.set(KEY.shape, this.#shape(open.startedAt));
    this.#d.state.set(KEY.skips, null);
    const record = this.#d.events.append(this.#d.company.coordinator()?.id ?? null, {
      type: 'management.cycle', closed: open.close !== null, startedAt: open.startedAt, endedAt, triggers: open.triggers, ...(open.close ?? { changes: [], reasoning: '', next: null }), costUsd: open.costUsd,
      model: open.model ?? null,
    });
    // Where the turn ended in the log: what asks for a project start is looked for after it (the board's startAfter).
    this.#d.state.set(KEY.endSeq, String(record.seq));
  }

  /**
   * cycleClose: the coordinator closes the open cycle with what it changed and why — with no change, “değişiklik yok,
   * çünkü …” and the reason. Recorded when its turn ends (with the turn's cost).
   */
  close(by: string, input: { changes?: string[]; reasoning?: string; next?: string }): { changes: string[] } {
    const c = this.#d.company.coordinator();
    if (!c || c.id !== by) throw new ForbiddenError('Yönetim turunu yalnız koordinatör kapatır.');
    const open = this.#open();
    if (!open) throw new ConflictError('Açık bir yönetim turu yok: cycleClose yalnız yönetim panosuyla açılan turu kapatır.');
    if (open.close) throw new ConflictError('Bu yönetim turu zaten kapandı.');
    const changes = lines(input.changes, 'Değişiklikler', 20, 300);
    const reasoning = clean(input.reasoning, 'Gerekçe', 2000, true);
    const next = clean(input.next, 'Sonraki tur', 500, false) || null;
    if (changes.length === 0) {
      const folded = fold(reasoning);
      const why = folded.replace('degisiklik yok', '').replace(/\bcunku\b/g, '').replace(/[^\p{L}\p{N}]/gu, '');
      if (!saysNoChange(reasoning) || why.length < REASON_LETTERS) {
        throw new ValidationError('Değişiklik yoksa gerekçeyi “değişiklik yok, çünkü …” diye yaz ve nedenini söyle (ör. “değişiklik yok, çünkü iki akış da planda yürüyor”).');
      }
    }
    this.#saveOpen({ ...open, close: { changes, reasoning, next } });
    return { changes };
  }

  /**
   * The management log for the owner (§3.3, the Yönetim tab): the cycle open now — the board went out, its turn has not
   * ended — and the last `limit` recorded (management.cycle events), newest first.
   */
  log(limit: number = LOG_DEFAULT): ManagementLog {
    const open = this.#open();
    const cycles = this.#d.events
      .since(0, ['management.cycle'], Math.min(Math.max(1, limit), LOG_MAX))
      .reverse()
      .flatMap((e): ManagementCycleRecord[] => {
        const ev = e.event;
        if (ev.type !== 'management.cycle') return [];
        const { closed, startedAt, triggers, changes, reasoning, next, costUsd, model } = ev;
        // An older office's record has no end of its own: it was logged when its turn ended.
        return [{ seq: e.seq, startedAt, endedAt: ev.endedAt === undefined ? e.ts : ev.endedAt, closed, triggers, changes, reasoning, next, costUsd, model }];
      });
    return {
      generatedAt: this.#now(),
      open: open ? { startedAt: open.startedAt, triggers: open.triggers, model: open.model ?? null, costUsd: open.costUsd, close: open.close } : null,
      cycles,
    };
  }

  /** A trigger the office saw without an event of its own (someone still at a task after the reminder). */
  trigger(kind: CycleTriggerKind, note: string): void {
    if (!this.#d.company.coordinator()) return;
    this.#push({ kind, at: this.#now(), note, seq: null });
  }

  #onEvent(e: StoredEvent): void {
    const ev = e.event;
    // The cycle turn's steps: the coordinator's results, lifecycle and failed model switches while a cycle is open (and whatever follows a last result).
    const step = ev.type === 'turn.finished' || ev.type === 'lifecycle.changed' || ev.type === 'model.switch.failed';
    if ((step || this.#resultIn) && e.employeeId !== null && (this.#resultIn || this.#open())) {
      if (e.employeeId === this.#d.company.coordinator()?.id) this.#turnStep(ev);
    }
    if (!WATCHED.has(ev.type)) return;
    // Kept up to date whoever acted: the next event is judged against it.
    const before = ev.type === 'task.changed' ? this.#track(ev.task) : undefined;
    const constraint = ev.type === 'budget.changed' ? this.#constraintOf(ev.budget) : null;
    const c = this.#d.company.coordinator();
    if (!c) return;
    if (this.#actor === c.id || (e.employeeId === c.id && !onDesk(ev))) return;
    for (const t of this.#triggersOf(e, c.id, before, constraint)) this.#push(t);
  }

  /**
   * One step of the cycle's turn. It ends only as the engine ends a turn — its last result (nothing queued), then idle —
   * or in a lifecycle it does not come back from. A crash (the session starts again, idle, and the work is sent again),
   * a quota pause (limited, then on) or a model retry (the turn runs again on the old model) go on: the cycle stays open,
   * and a failed switch is recorded as the model the turn goes on on.
   */
  #turnStep(ev: OfficeEvent): void {
    const resultIn = this.#resultIn;
    this.#resultIn = false;
    const open = this.#open();
    if (!open) return;
    if (ev.type === 'model.switch.failed') {
      const from = MODEL_ALIASES.find((m) => m === ev.from);
      if (from) this.#saveOpen({ ...open, model: from });
      return;
    }
    if (ev.type === 'turn.finished') {
      const cost = open.ownTurnDone ? open.costUsd : Math.round(((open.costUsd ?? 0) + ev.costUsd) * 1e6) / 1e6;
      this.#saveOpen({ ...open, costUsd: cost, ownTurnDone: open.ownTurnDone || ev.queuedTurns > 0 });
      this.#resultIn = ev.queuedTurns === 0;
      return;
    }
    if (ev.type !== 'lifecycle.changed') return;
    if ((resultIn && ev.from === 'working' && ev.to === 'idle') || TURN_GONE.has(ev.to)) this.ended();
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

  /** What changed in a budget announcement: the constitution (read as today's), the reserve; null when only the money moved. */
  #constraintOf(b: BudgetSummary): string | null {
    const constitution = normalizeConstitution(b.constitution);
    const rules = constitutionChanges(this.#constitution, constitution);
    const reserve = b.reserve.active === this.#reserve ? null : b.reserve.active ? 'sahibinin kota payı devreye girdi' : 'sahibinin kota payı serbest kaldı';
    this.#constitution = constitution;
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

  /** The clock's look: the heartbeats' times, a rest that ended, and a cycle that became due. */
  #tick(): void {
    if (!this.#running) return;
    const now = this.#now();
    if (this.#openWork()) this.#workAt = now;
    else this.#quietAt = now;
    this.#restEnd(now);
    this.#beat(now);
    if (this.due()) this.#notify();
  }

  /**
   * The heartbeat while work is open (§3.1), at the clock's look: HEARTBEAT_MS after the last cycle, the last heartbeat
   * passed by, or the work's start. Its board measured against the one the last cycle's turn left: the same — and that
   * cycle closed — it is passed by and logged (management.cycle.skipped), at most MAX_SKIPS in a row; otherwise it waits
   * as a trigger and the cycle opens. Never in the owner's reserve, while paused, in a cycle, with triggers waiting, or
   * while every open task waits for a later time.
   */
  #beat(now: number): void {
    const c = this.#d.company.coordinator();
    if (!c || this.#d.company.paused() || this.#open() || this.#pending().length > 0) return;
    if (this.#d.budget?.reserveActive() || !this.#openWork() || this.#allWaiting(now)) return;
    const last = Math.max(this.#lastStart(), this.#quietAt, Number(this.#d.state.get(KEY.skippedAt) ?? '0') || 0);
    if (now - last < HEARTBEAT_MS) return;
    const skips = Number(this.#d.state.get(KEY.skips) ?? '0') || 0;
    const shape = this.#d.state.get(KEY.shape);
    if (skips < (this.#d.maxSkips ?? MAX_SKIPS) && shape && this.#d.state.get(KEY.unclosed) !== 'true' && this.#shape(this.#lastStart(), now) === shape) {
      this.#d.state.set(KEY.skippedAt, String(now));
      this.#d.state.set(KEY.skips, String(skips + 1));
      this.#d.events.append(c.id, { type: 'management.cycle.skipped', since: this.#lastStart(), skips: skips + 1 });
      return;
    }
    this.#push({ kind: 'heartbeat', at: now, note: '', seq: null });
  }

  /** The board's shape now, since `since` (null when it cannot be built: nothing is passed by on it). */
  #shape(since: number, now: number = this.#now()): string | null {
    try {
      const { shape } = this.#d.board({ since, now });
      return typeof shape === 'string' ? shape : null;
    } catch {
      return null;
    }
  }

  /**
   * With no goal and no open work, pulseHours after the last cycle (0: never) and never while the coordinator rests;
   * while work is open the clock's look brings the heartbeat (#beat). Never in the owner's reserve.
   */
  #heartbeatDue(now: number): boolean {
    if (this.#d.budget?.reserveActive()) return false;
    if (this.#openWork()) return false;
    const hours = (this.#d.budget?.constitution() ?? DEFAULT_CONSTITUTION).pulseHours;
    const rest = this.#d.state.restUntil();
    if (hours <= 0 || now < rest) return false;
    return now - Math.max(this.#lastStart(), this.#workAt, rest) >= hours * HOUR;
  }

  /**
   * A rest that ended while an office was running — its clock ran after the end (a run before this one, read before
   * this office's clock first runs), or kept no last run — is no news now: an older office kept no marker of it. Marked,
   * so the first tick opens no stale cycle for it. A rest that ended while the office was down still gives its cycle.
   */
  #seedRestEnd(now: number): void {
    const until = this.#d.state.restUntil();
    if (until <= 0 || now < until || this.#d.state.get(KEY.restEnded) === String(until)) return;
    const lastRun = Number(this.#d.state.get(CLOCK_LAST_RUN) ?? '0') || 0;
    if (lastRun === 0 || until <= lastRun) this.#d.state.set(KEY.restEnded, String(until));
  }

  /** The coordinator's rest ran out (a new goal ends it without one): one cycle, once per rest, across restarts too. */
  #restEnd(now: number): void {
    const until = this.#d.state.restUntil();
    if (until <= 0 || now < until || this.#d.state.get(KEY.restEnded) === String(until)) return;
    this.#d.state.set(KEY.restEnded, String(until));
    if (this.#d.company.coordinator()) this.#push({ kind: 'rest', at: now, note: 'dinlenme bitti', seq: null });
  }

  /**
   * Every open task waits for a later time — parked, or not to start before then: nothing can move until the first of
   * them comes back, so no heartbeat looks at it (events still open cycles). False with no open task at all.
   */
  #allWaiting(now: number): boolean {
    const open = this.#d.tasks.list({ statuses: OPEN_STATUSES, limit: 100_000 });
    return open.length > 0 && open.every((t) => t.status === 'parked' || (t.status === 'waiting' && (t.notBefore ?? 0) > now));
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
