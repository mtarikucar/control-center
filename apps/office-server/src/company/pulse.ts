import { DEFAULT_CONSTITUTION, type Constitution } from '@cc/shared';
import type { Company } from './company.ts';
import type { CompanyStateStore, GoalStore } from './goal-store.ts';
import type { NoticeTopic } from './notices.ts';
import type { NoticeStore, PlanStore, TaskStore } from './store.ts';

const HOUR = 60 * 60_000;
const RUNNING = new Set(['draft', 'approved']);

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
    if (!coordinator || this.#d.state.paused() || this.#d.budget?.reserveActive()) return [];
    const left: string[] = [];
    const add = (topic: NoticeTopic, text: string) => {
      this.#d.notices.add(coordinator.id, topic, text);
      left.push(topic);
    };
    const plans = this.#d.plans.list(1000);
    const active = this.#d.goals.list({ statuses: ['active'] });
    for (const goal of active) {
      const own = plans.filter((p) => p.goalId === goal.id);
      if (own.some((p) => RUNNING.has(p.status))) continue;
      // plans.list is newest first: the marker is the latest plan's id (or none) — a plan that later ends re-arms it.
      const marker = own[0]?.id ?? 'none';
      const key = `pulse.goal.${goal.id}`;
      if (this.#d.state.get(key) === marker) continue;
      this.#d.state.set(key, marker);
      add('pulse.goal_idle', `“${goal.title}” hedefinin süren planı yok. Sıradaki planı planPropose ile goalId vererek başlat ya da hedefe ulaşıldıysa / vazgeçtiysen goalSet ile kapat (status: done ya da dropped).`);
    }
    if (active.length > 0 || plans.some((p) => RUNNING.has(p.status))) return left;
    if (this.#d.tasks.list({ statuses: ['waiting', 'in_progress', 'review', 'blocked'], limit: 1 }).length > 0) return left;
    const hours = (this.#d.budget?.constitution() ?? DEFAULT_CONSTITUTION).pulseHours;
    if (hours <= 0) return left;
    const now = this.#now();
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
