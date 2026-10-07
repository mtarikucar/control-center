import { DEFAULT_CONSTITUTION, TASK_DIFFICULTY_LABELS, type AgendaEntry, type AgendaReport, type ClockStatus, type Constitution, type Employee, type EmployeeAgenda, type Task } from '@cc/shared';
import type { Roster } from '../roster.ts';
import type { Company } from './company.ts';
import { OPEN_STATUSES, type ScheduleStore, type TaskStore } from './store.ts';
import { cronLabel, formatWhen, nextCron, parseCron } from './time.ts';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const HISTORY = 10;
const OFFICE_HISTORY = 50;
const BY_DIFFICULTY_MIN_SAMPLES = 3;
const REVIEW_DEFAULT_MS = 15 * MIN;
const SCHEDULE_OCCURRENCES = 3;
const NO_CLOCK: ClockStatus = { nextDueAt: null, nextDueLabel: null, lastRunAt: null, lastJumpAt: null };
const LABEL: Record<AgendaEntry['kind'], string> = { now: 'Şimdi', queued: 'Sırada', review_wait: 'İnceleme bekliyor', parked: 'Ertelendi', not_before: 'Başlangıç', scheduled: 'Rutin' };

export interface AgendaDeps {
  roster: Roster;
  /** Only reads (a test counts them through a wrapper). */
  tasks: Pick<TaskStore, 'list' | 'get' | 'durations'>;
  schedules: ScheduleStore;
  company: Company;
  budget?: { reserveActive(): boolean; constitution(): Constitution };
  clock?: { status(now: number): ClockStatus };
  now?: () => number;
  horizonMs?: number;
}

interface Estimate {
  ms: number;
  basis: string;
}

/**
 * One read (a report, one employee, a text). A dependency's end comes from its owner's agenda, which may depend on
 * the first one's again: an employee whose agenda is being worked out is never asked for a second time (R6), and each
 * agenda is worked out once per pass — the first result is kept, so in a cycle what is shown depends on who was asked
 * first (it stays low confidence either way).
 */
interface Pass {
  now: number;
  /** Employees whose agenda is being worked out now. */
  open: Set<string>;
  /** Agendas worked out in this pass. */
  done: Map<string, EmployeeAgenda>;
  /** The roster (archived people left out), read once per pass when first needed. */
  people: Map<string, Employee> | null;
}

/** A queued task and what it waits for. */
interface Waiting {
  task: Task;
  /** The first unfinished dependency (named in the note), if any. */
  first: Task | null;
  /** Its unfinished dependencies that are this employee's own. */
  own: string[];
  /** The latest estimated end of the other employees' tasks it waits for (-Infinity: none, or unknown). */
  after: number;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
};

/**
 * Each employee's agenda, derived from the database (spec §6.1): what runs now, what is queued (with chained
 * estimates), what waits for a reviewer, what is parked or start-timed, which routines are coming. It changes nothing
 * and uses no model.
 */
export class Agenda {
  readonly #d: AgendaDeps;
  readonly #now: () => number;
  readonly #horizon: number;

  constructor(d: AgendaDeps) {
    this.#d = d;
    this.#now = d.now ?? Date.now;
    this.#horizon = d.horizonMs ?? 7 * DAY;
  }

  report(now: number = this.#now()): AgendaReport {
    const people = this.#d.roster.list();
    const pass = this.#pass(now, people);
    const employees = people.map((e) => this.#forEmployee(e, pass));
    return { generatedAt: now, horizonMs: this.#horizon, clock: this.#d.clock?.status(now) ?? NO_CLOCK, employees };
  }

  forEmployee(id: string, now: number = this.#now()): EmployeeAgenda {
    return this.#forEmployee(this.#d.roster.get(id), this.#pass(now));
  }

  /** The agenda as Turkish lines (agendaRead): one employee, or everyone. */
  text(employeeId?: string, now: number = this.#now()): string {
    const people = employeeId ? [this.forEmployee(employeeId, now)] : this.report(now).employees;
    const when = (ms: number) => formatWhen(ms, now).replace(/^bugün /, '');
    const line = (e: AgendaEntry): string => {
      const span =
        e.at === null ? '' : e.kind === 'now' ? `başladı ${when(e.at)} → ~${when(e.until ?? e.at)}` : e.kind === 'queued' ? `~${when(e.at)} → ~${when(e.until ?? e.at)}` : when(e.at);
      // A queued task's span is exactly its estimate; a running one's end moves with now once it runs over.
      const estimate = e.basis === null ? null : e.kind === 'queued' && e.at !== null && e.until !== null ? `~${Math.round((e.until - e.at) / MIN)} dk · ${e.basis}` : e.basis;
      const due = e.overdue ? 'SON TARİH GEÇTİ' : e.dueAt !== null ? `son tarih ${when(e.dueAt)}` : null;
      const extras = [estimate, e.note, due].filter(Boolean).join('; ');
      return `  ${LABEL[e.kind]}: ${e.title}${span ? ` (${span})` : ''}${extras ? ` — ${extras}` : ''}`;
    };
    return people.map((p) => [`${p.name}${p.state ? ` — ${p.state}` : ''}`, ...(p.entries.length ? p.entries.map(line) : ['  (boş)'])].join('\n')).join('\n');
  }

  #pass(now: number, people?: Employee[]): Pass {
    return { now, open: new Set(), done: new Map(), people: people ? new Map(people.map((e) => [e.id, e])) : null };
  }

  /** At most one build per employee per pass, however the dependencies run. */
  #forEmployee(e: Employee, pass: Pass): EmployeeAgenda {
    const known = pass.done.get(e.id);
    if (known) return known;
    pass.open.add(e.id);
    try {
      const agenda = this.#build(e, pass);
      pass.done.set(e.id, agenda);
      return agenda;
    } finally {
      pass.open.delete(e.id);
    }
  }

  #build(e: Employee, pass: Pass): EmployeeAgenda {
    const now = pass.now;
    const entries: AgendaEntry[] = [];
    const open = this.#d.tasks.list({ assignee: e.id, statuses: OPEN_STATUSES });
    /** The estimated end of each of this employee's tasks placed so far. */
    const ends = new Map<string, number>();
    let cursor = now;
    // Every started task, a stuck one too: the dispatcher hands out the next task while one is blocked, so both can be open.
    const running = open.filter((t) => t.status === 'in_progress' || t.status === 'blocked').sort((a, b) => (a.startedAt ?? now) - (b.startedAt ?? now));
    for (const t of running) {
      const est = this.#estimate(t);
      const started = t.startedAt ?? now;
      const until = Math.max(started + est.ms, now);
      const note = [t.status === 'blocked' ? 'takıldı' : null, started + est.ms < now ? 'uzuyor' : null].filter(Boolean).join(' · ') || null;
      entries.push(this.#entry('now', t, started, until, est.basis, note, false, now));
      ends.set(t.id, until);
      cursor = Math.max(cursor, until);
    }
    // Handed out as the dispatcher does: the first task in delivery order that may start; while none may, the soonest.
    const queue: Waiting[] = this.#deliveryOrder(open.filter((t) => t.status === 'waiting' && (t.notBefore ?? now) <= now)).map((task) => {
      const deps = this.#pendingDependencies(task);
      let after = Number.NEGATIVE_INFINITY;
      for (const dep of deps) if (dep.assignee !== e.id) after = Math.max(after, this.#estimatedEnd(dep, pass) ?? Number.NEGATIVE_INFINITY);
      return { task, first: deps[0] ?? null, own: deps.filter((d) => d.assignee === e.id).map((d) => d.id), after };
    });
    while (queue.length > 0) {
      // When each may start: +Infinity while it waits for an own task not yet placed; an unknown end does not hold it.
      const ready = queue.map((w) => (w.own.some((id) => queue.some((x) => x.task.id === id)) ? Number.POSITIVE_INFINITY : Math.max(w.after, ...w.own.map((id) => ends.get(id) ?? Number.NEGATIVE_INFINITY))));
      let i = ready.findIndex((r) => r <= cursor);
      if (i === -1) {
        const soonest = Math.min(...ready);
        // Only own tasks waiting on each other: take them in delivery order.
        i = Number.isFinite(soonest) ? ready.indexOf(soonest) : 0;
      }
      const { task, first } = queue.splice(i, 1)[0]!;
      const at = Number.isFinite(ready[i]) ? Math.max(cursor, ready[i]!) : cursor;
      const est = this.#estimate(task);
      entries.push(this.#entry('queued', task, at, at + est.ms, est.basis, first ? `“${first.title}” bitince` : null, first !== null, now));
      ends.set(task.id, at + est.ms);
      cursor = at + est.ms;
    }
    for (const t of open.filter((x) => x.status === 'review')) {
      const reviewer = t.reviewer ? this.#d.company.nameOf(t.reviewer) : 'inceleyici';
      // `round` counts the hand-ins: the first is round 1.
      entries.push(this.#entry('review_wait', t, null, null, null, `inceleyici: ${reviewer}, tur ${Math.max(1, t.round ?? 0)}`, false, now));
    }
    // A parked task past its return that the clock has not brought back yet shows at its return time: due now.
    for (const t of open.filter((x) => x.status === 'parked')) entries.push(this.#entry('parked', t, t.notBefore ?? now, null, null, t.parkedReason ?? null, false, now));
    for (const t of open.filter((x) => x.status === 'waiting' && (x.notBefore ?? now) > now)) entries.push(this.#entry('not_before', t, t.notBefore!, null, null, null, false, now));
    for (const sch of this.#d.schedules.list({ assignee: e.id, statuses: ['active'] })) {
      if (sch.nextRunAt === null) continue;
      try {
        const spec = parseCron(sch.cron);
        let at = sch.nextRunAt;
        // The clock fires a routine only before its end (`until`).
        for (let i = 0; i < SCHEDULE_OCCURRENCES && at <= now + this.#horizon && (sch.until === null || at < sch.until); i += 1) {
          entries.push({ kind: 'scheduled', taskId: null, scheduleId: sch.id, title: sch.title, at, until: null, basis: null, note: cronLabel(spec), priority: sch.priority, dueAt: null, overdue: false, lowConfidence: false });
          at = nextCron(spec, at);
        }
      } catch {
        // A routine with no run ahead shows what it has: the agenda never fails on one.
      }
    }
    // The horizon trims what is worked out (queued chains, routine runs); a park or a start time is a date someone set,
    // shown however far ahead it is (up to 30 or 365 days).
    const within = entries.filter((x) => x.at === null || x.kind === 'parked' || x.kind === 'not_before' || x.at <= now + this.#horizon);
    within.sort((a, b) => (a.at ?? Number.POSITIVE_INFINITY) - (b.at ?? Number.POSITIVE_INFINITY));
    return { id: e.id, name: e.name, state: this.#state(e, now), entries: within };
  }

  #entry(kind: AgendaEntry['kind'], t: Task, at: number | null, until: number | null, basis: string | null, note: string | null, low: boolean, now: number): AgendaEntry {
    return { kind, taskId: t.id, scheduleId: t.scheduleId ?? null, title: t.title, at, until, basis, note, priority: t.priority, dueAt: t.dueAt ?? null, overdue: (t.dueAt ?? Number.POSITIVE_INFINITY) <= now, lowConfidence: low };
  }

  /** The dispatcher's order (TaskStore.nextFor): priority, nearer due date, oldest. */
  #deliveryOrder(tasks: Task[]): Task[] {
    return [...tasks].sort((a, b) => a.priority - b.priority || (a.dueAt ?? Number.POSITIVE_INFINITY) - (b.dueAt ?? Number.POSITIVE_INFINITY) || a.createdAt - b.createdAt);
  }

  #pendingDependencies(t: Task): Task[] {
    const pending: Task[] = [];
    for (const id of t.dependsOn) {
      try {
        const dep = this.#d.tasks.get(id);
        if (dep.status !== 'done' && dep.status !== 'cancelled') pending.push(dep);
      } catch {
        // A dependency that no longer exists does not hold the task (nextFor treats it the same).
      }
    }
    return pending;
  }

  /** When another employee's task is expected to end: its `until` in their agenda; null when it has none or cannot be known. */
  #estimatedEnd(dep: Task, pass: Pass): number | null {
    if (pass.open.has(dep.assignee)) return null;
    pass.people ??= new Map(this.#d.roster.list().map((e) => [e.id, e]));
    const owner = pass.people.get(dep.assignee);
    if (!owner) return null;
    return this.#forEmployee(owner, pass).entries.find((x) => x.taskId === dep.id)?.until ?? null;
  }

  #estimate(t: Task): Estimate {
    const tasks = this.#d.tasks;
    if (t.kind === 'review') {
      const xs = tasks.durations({ assignee: t.assignee, kind: 'review', limit: HISTORY });
      return xs.length ? { ms: median(xs), basis: `inceleme, ${xs.length} iş` } : { ms: REVIEW_DEFAULT_MS, basis: 'inceleme, varsayılan' };
    }
    if (t.difficulty) {
      const xs = tasks.durations({ assignee: t.assignee, kind: 'work', difficulty: t.difficulty, limit: HISTORY });
      if (xs.length >= BY_DIFFICULTY_MIN_SAMPLES) return { ms: median(xs), basis: `zorluk: ${TASK_DIFFICULTY_LABELS[t.difficulty]}, ${xs.length} iş` };
    }
    const own = tasks.durations({ assignee: t.assignee, kind: 'work', limit: HISTORY });
    if (own.length) return { ms: median(own), basis: `son ${own.length} iş` };
    const office = tasks.durations({ kind: 'work', limit: OFFICE_HISTORY });
    if (office.length) return { ms: median(office), basis: 'ofis geneli' };
    return { ms: this.#rules().defaultTaskMinutes * MIN, basis: 'varsayılan' };
  }

  #state(e: Employee, now: number): string | null {
    const parts: string[] = [];
    if (this.#d.company.paused()) parts.push('şirket duraklatıldı');
    if (e.lifecycle === 'sleeping') parts.push('uyuyor');
    if (e.lifecycle === 'limited') parts.push(e.limitResetsAt ? `limit doldu, açılış ${formatWhen(e.limitResetsAt, now)}` : 'limit doldu');
    if (e.lifecycle === 'stopped') parts.push('durduruldu');
    if (this.#d.budget?.reserveActive()) parts.push('kota payı devrede (yalnız öncelik 1)');
    return parts.length ? parts.join(' · ') : null;
  }

  #rules(): Constitution {
    return this.#d.budget?.constitution() ?? DEFAULT_CONSTITUTION;
  }
}
