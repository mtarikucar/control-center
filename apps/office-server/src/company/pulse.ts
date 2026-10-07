import { DEFAULT_CONSTITUTION, type Constitution } from '@cc/shared';
import type { Company } from './company.ts';
import type { CompanyStateStore, GoalStore } from './goal-store.ts';
import type { NoticeTopic } from './notices.ts';
import type { NoticeStore, PlanStore, TaskStore } from './store.ts';

const HOUR = 60 * 60_000;
/** An approved plan that has not had a single task this long after it started is not running: it stalled. */
const EMPTY_PLAN_GRACE_MS = 10 * 60_000;

export interface PulseDeps {
  company: Company;
  goals: GoalStore;
  state: CompanyStateStore;
  plans: PlanStore;
  tasks: TaskStore;
  notices: NoticeStore;
  budget?: { reserveActive(): boolean; constitution(): Constitution };
  now?: () => number;
}

/**
 * The office watches the project so the coordinator does not have to (spec §6.3): code, no model. It leaves the
 * coordinator a decision notice only when one is due — a goal with no running plan, or neither goals nor work — and
 * never twice for the same state (markers in the database survive a restart). The dispatcher delivers the notices by
 * its own rules: never interrupting, waking a sleeping coordinator.
 */
export class Pulse {
  readonly #d: PulseDeps;
  readonly #now: () => number;

  constructor(d: PulseDeps) {
    this.#d = d;
    this.#now = d.now ?? Date.now;
  }

  /** One look at the project; returns the topics of the notices it left. */
  check(): string[] {
    const coordinator = this.#d.company.coordinator();
    // While the coordinator works it may be starting that very plan: look again on a later tick, on fresh state.
    if (!coordinator || coordinator.lifecycle === 'working' || this.#d.state.paused() || this.#d.budget?.reserveActive()) return [];
    const left: string[] = [];
    const add = (topic: NoticeTopic, text: string) => {
      this.#d.notices.add(coordinator.id, topic, text);
      left.push(topic);
    };
    const plans = this.#d.plans.list(1000);
    const now = this.#now();
    const hasTasks = (id: string) => this.#d.tasks.list({ planId: id, limit: 1 }).length > 0;
    const running = (p: (typeof plans)[number]) =>
      p.status === 'draft' || (p.status === 'approved' && (hasTasks(p.id) || now - (p.approvedAt ?? p.updatedAt) < EMPTY_PLAN_GRACE_MS));
    const active = this.#d.goals.list({ statuses: ['active'] });
    for (const goal of active) {
      const own = plans.filter((p) => p.goalId === goal.id);
      if (own.some(running)) continue;
      // plans.list is newest first: the marker is the latest plan's id (or none) — a plan that later ends re-arms it.
      const marker = own[0]?.id ?? 'none';
      const key = `pulse.goal.${goal.id}`;
      if (this.#d.state.get(key) === marker) continue;
      this.#d.state.set(key, marker);
      const stalled = own.find((p) => p.status === 'approved');
      const why = stalled ? ` (“${stalled.title}” onaylı ama hiç görevi açılmadı: ya görevlerini taskCreate ile aç ya da yerine yenisini öner)` : '';
      add('pulse.goal_idle', `“${goal.title}” hedefinin süren planı yok${why}. Sıradaki planı planPropose ile goalId vererek başlat ya da hedefe ulaşıldıysa / vazgeçtiysen goalSet ile kapat (status: done ya da dropped).`);
    }
    if (active.length > 0 || plans.some(running)) return left;
    if (this.#d.tasks.list({ statuses: ['waiting', 'in_progress', 'review', 'blocked', 'parked'], limit: 1 }).length > 0) return left;
    const hours = (this.#d.budget?.constitution() ?? DEFAULT_CONSTITUTION).pulseHours;
    if (hours <= 0) return left;
    if (now < this.#d.state.restUntil()) return left;
    const last = Number(this.#d.state.get('pulse.noGoalAt') ?? '0') || 0;
    if (last > 0 && now - last < hours * HOUR) return left;
    this.#d.state.set('pulse.noGoalAt', String(now));
    add(
      'pulse.no_goal',
      'Aktif hedef yok ve açık iş yok. Şirket özetindeki misyona göre yeni bir hedef koy (goalSet: neden ve ölçülebilir bitti tanımıyla) ve ilk planını başlat; şimdilik değerli iş yoksa iş icat etme — restUntil ile ne zamana kadar ve neden dinlendiğini yaz.',
    );
    return left;
  }
}
