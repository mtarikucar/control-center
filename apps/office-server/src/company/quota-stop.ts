import type { Constitution, Employee, QuotaState } from '@cc/shared';
import type { CompanyStateStore } from './goal-store.ts';
import type { NoticeStore } from './store.ts';

/** The weekly window the office last stopped itself in (its reset time): one stop per window, across restarts. */
const KEY = 'quota.weeklyStop';

export interface QuotaStopDeps {
  quota: { state(): QuotaState | null };
  constitution: () => Constitution;
  company: { paused(): boolean; pause(reason?: string): void; coordinator(): Employee | null };
  state: Pick<CompanyStateStore, 'get' | 'set'>;
  notices: Pick<NoticeStore, 'add'>;
  now?: () => number;
}

/**
 * The owner's weekly line (constitution weeklyStopPct, 0: off): when the account's 7-day Claude quota reaches it, the
 * office pauses itself — once per weekly window, so the owner resuming above the line is the owner's word for that
 * week; a new window can stop it again. The coordinator hears it as a note (no turn of its own is opened for it).
 */
export class QuotaStop {
  readonly #d: QuotaStopDeps;
  readonly #now: () => number;

  constructor(d: QuotaStopDeps) {
    this.#d = d;
    this.#now = d.now ?? Date.now;
  }

  /** Looks at the week's use; true when it paused the company now. */
  check(): boolean {
    const limit = this.#d.constitution().weeklyStopPct;
    // The account's 7-day window as the quota tracker reads it (claude/normalize.ts; without unified windows it may be the
    // busiest model's weekly window — still the week the owner shares).
    const week = this.#d.quota.state()?.sevenDay ?? null;
    const now = this.#now();
    if (limit <= 0 || !week || week.resetsAt <= now) return false;
    const pct = Math.round(week.utilization * 100);
    if (pct < limit) return false;
    const window = String(week.resetsAt);
    if (this.#d.state.get(KEY) === window) return false;
    // Paused already (the owner's own pause): the line is marked as met, so their resume in this window is not undone.
    if (this.#d.company.paused()) {
      this.#d.state.set(KEY, window);
      return false;
    }
    this.#d.company.pause(`Haftalık Claude kotası %${pct} (sınır %${limit}): ofis kendini duraklattı; sürdürmek sahibinde.`);
    // Marked once the pause took: a pause that failed is tried again at the next look.
    this.#d.state.set(KEY, window);
    const c = this.#d.company.coordinator();
    if (c) {
      this.#d.notices.add(c.id, 'quota.weekly_stop', `Haftalık Claude kotası %${pct} oldu (sınır %${limit}): şirket duraklatıldı. Sahibi sürdürünce devam et; o zamana kadar kota harcayan iş açma.`);
    }
    return true;
  }
}
