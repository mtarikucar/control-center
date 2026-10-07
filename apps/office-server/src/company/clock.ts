import type { ClockStatus } from '@cc/shared';
import type { EventStore } from '../event-store.ts';
import type { CompanyStateStore } from './goal-store.ts';
import type { DueReport, Scheduling } from './scheduling.ts';

export interface ClockTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface ClockDeps {
  scheduling: Scheduling;
  state: CompanyStateStore;
  events: EventStore;
  /** What is due at a time, in Turkish, for the status line (null: nothing). */
  label?: (now: number) => string | null;
  now?: () => number;
  timers?: ClockTimers;
  /** The clock never sleeps longer than this (the safety tick). */
  safetyMs?: number;
  /** Waking later than this past the armed time counts as a jump. */
  jumpMs?: number;
}

interface Job {
  name: string;
  ms: number;
  fn: () => void;
  nextAt: number;
}

// Unref'd like the dispatcher's old interval: the server keeps the process alive, the clock never does on its own.
const REAL_TIMERS: ClockTimers = { set: (fn, ms) => setTimeout(fn, ms).unref(), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/**
 * The office's one timer (spec §5). It holds no due times of its own: on every arm it asks the scheduling service
 * for the nearest one, sleeps until then (at most `safetyMs`), runs what is due and re-arms. Any change to a time
 * calls `touch()`. A restart catches up at start; a long sleep or a clock change is noted, never a problem.
 */
export class Clock {
  readonly #d: ClockDeps;
  readonly #now: () => number;
  readonly #timers: ClockTimers;
  readonly #safetyMs: number;
  readonly #jumpMs: number;
  readonly #jobs: Job[] = [];
  readonly #listeners: Array<(report: DueReport) => void> = [];
  #handle: unknown = null;
  #armedFor: number | null = null;
  #started = false;

  constructor(d: ClockDeps) {
    this.#d = d;
    this.#now = d.now ?? Date.now;
    this.#timers = d.timers ?? REAL_TIMERS;
    this.#safetyMs = d.safetyMs ?? 60_000;
    this.#jumpMs = d.jumpMs ?? 120_000;
  }

  /** A periodic office job (the dispatcher's tick, the pulse…); runs at start and every `ms` after. */
  every(name: string, ms: number, fn: () => void): void {
    this.#jobs.push({ name, ms, fn, nextAt: 0 });
    if (this.#started) this.#arm();
  }

  onRan(fn: (report: DueReport) => void): void {
    this.#listeners.push(fn);
  }

  start(): () => void {
    this.#started = true;
    this.#run();
    return () => {
      this.#started = false;
      if (this.#handle !== null) this.#timers.clear(this.#handle);
      this.#handle = null;
    };
  }

  /** A time changed: look again now and re-arm. */
  touch(): void {
    if (!this.#started) return;
    this.#arm();
  }

  /** Runs what is due right now (the API's and the tests' hand on the clock). */
  runNow(): DueReport {
    return this.#run();
  }

  status(now: number = this.#now()): ClockStatus {
    const nextDue = this.#d.scheduling.nextDueAt(now);
    return {
      nextDueAt: nextDue,
      nextDueLabel: nextDue === null ? null : (this.#d.label?.(now) ?? null),
      lastRunAt: Number(this.#d.state.get('clock.lastRunAt') ?? '0') || null,
      lastJumpAt: Number(this.#d.state.get('clock.lastJumpAt') ?? '0') || null,
    };
  }

  #run(): DueReport {
    const now = this.#now();
    if (this.#armedFor !== null && now - this.#armedFor > this.#jumpMs) {
      this.#d.state.set('clock.lastJumpAt', String(now));
      this.#d.events.append(null, { type: 'clock.jumped', expectedAt: this.#armedFor, actualAt: now });
    }
    this.#armedFor = null;
    let report: DueReport;
    try {
      report = this.#d.scheduling.runDue(now);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.#d.events.append(null, { type: 'clock.error', job: 'runDue', message: message.slice(0, 500) });
      report = { returned: [], fired: [], skipped: [], overdue: [], errors: [message] };
    }
    for (const job of this.#jobs) {
      if (job.nextAt > now) continue;
      job.nextAt = now + job.ms;
      try {
        job.fn();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.#d.events.append(null, { type: 'clock.error', job: job.name, message: message.slice(0, 500) });
      }
    }
    for (const fn of this.#listeners) {
      try {
        fn(report);
      } catch {
        // A listener's failure is its own.
      }
    }
    this.#arm();
    return report;
  }

  #arm(): void {
    if (!this.#started) return;
    if (this.#handle !== null) this.#timers.clear(this.#handle);
    const now = this.#now();
    const due = this.#d.scheduling.nextDueAt(now);
    const jobAt = this.#jobs.length ? Math.min(...this.#jobs.map((j) => j.nextAt)) : Number.POSITIVE_INFINITY;
    // Never armed for the past (a job added after start is due at 0): what is overdue runs now, and that is no jump.
    const at = Math.max(now, Math.min(due ?? Number.POSITIVE_INFINITY, jobAt, now + this.#safetyMs));
    this.#armedFor = at;
    this.#handle = this.#timers.set(() => this.#run(), at - now);
  }
}
