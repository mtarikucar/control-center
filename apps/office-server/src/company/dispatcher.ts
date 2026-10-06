import type { Task } from '@cc/shared';
import type { EventStore } from '../event-store.ts';
import type { Roster } from '../roster.ts';
import type { Company } from './company.ts';
import type { NoticeStore, PlanStore, TaskStore } from './store.ts';

export interface DispatchEngine {
  ready(id: string): boolean;
  send(id: string, text: string, source: 'system'): void;
  fire(id: string): Promise<void>;
}

export interface DispatcherDeps {
  events: EventStore;
  roster: Roster;
  tasks: TaskStore;
  notices: NoticeStore;
  plans: PlanStore;
  company: Company;
  engine: DispatchEngine;
  /** Runs work after the current event has been handled (default setImmediate), so sends never nest in an event. */
  defer?: (fn: () => void) => void;
}

export const NUDGE_PREFIX = 'Hatırlatma:';
export const NOTICES_PREFIX = 'Ofisten notlar:';

/**
 * Hands work to employees when they are free: the next task in their queue, the notices waiting for them (a plan
 * was approved, a colleague handed in), or one reminder about a task they left open. Never interrupts: it waits for
 * the employee to be idle (v1 rule: only the owner interrupts).
 */
export class Dispatcher {
  readonly #d: DispatcherDeps;
  readonly #defer: (fn: () => void) => void;
  readonly #queued = new Set<string>();
  /** Stalled tasks the coordinator has been told about (once per office run). */
  readonly #escalated = new Set<string>();
  /** Being let go after their hand-over (fire is under way). */
  readonly #leaving = new Set<string>();
  #sweepQueued = false;

  constructor(d: DispatcherDeps) {
    this.#d = d;
    this.#defer = d.defer ?? ((fn) => void setImmediate(fn));
  }

  start(): () => void {
    const off = this.#d.events.subscribe((stored) => {
      const ev = stored.event;
      if (ev.type === 'lifecycle.changed' && ev.to === 'idle' && stored.employeeId) this.#schedule(stored.employeeId);
      else if (ev.type === 'task.changed' || ev.type === 'plan.changed' || ev.type === 'decision.recorded') this.#scheduleSweep();
    });
    this.#scheduleSweep();
    return off;
  }

  sweep(): void {
    for (const e of this.#d.roster.list()) this.#consider(e.id);
  }

  #schedule(id: string): void {
    if (this.#queued.has(id)) return;
    this.#queued.add(id);
    this.#defer(() => {
      this.#queued.delete(id);
      this.#consider(id);
    });
  }

  #scheduleSweep(): void {
    if (this.#sweepQueued) return;
    this.#sweepQueued = true;
    this.#defer(() => {
      this.#sweepQueued = false;
      this.sweep();
    });
  }

  #consider(id: string): void {
    if (!this.#d.engine.ready(id)) return;
    if (this.#d.company.handedOver(id)) {
      this.#letGo(id);
      return;
    }
    const pending = this.#d.notices.pending(id);
    const current = this.#d.tasks.inProgressOf(id);
    const handover = this.#d.tasks.list({ assignee: id, statuses: ['waiting'] }).find((t) => t.kind === 'handover');
    let body = '';
    let started: Task | null = null;
    if (handover) {
      // Leaving comes first, even with another task open: that task goes back to the coordinator afterwards.
      started = this.#d.company.start(handover.id);
    } else if (current) {
      if (!current.nudged) body = this.#nudge(current);
      else this.#escalate(id, current);
    } else {
      const next = this.#d.tasks.nextFor(id);
      if (next) started = this.#d.company.start(next.id);
    }
    if (started) body = this.#delivery(started);
    if (!body && pending.length === 0) return;
    const text = [pending.length ? `${NOTICES_PREFIX}\n${pending.map((n) => `- ${n.text}`).join('\n')}` : '', body].filter(Boolean).join('\n\n');
    try {
      this.#d.engine.send(id, text, 'system');
    } catch {
      // The session went away between ready() and send(): put the task back; the next idle moment delivers it.
      if (started) this.#d.tasks.update(started.id, { status: 'waiting', startedAt: null });
      return;
    }
    if (!started && current && !current.nudged) this.#d.tasks.update(current.id, { nudged: true });
    this.#d.notices.markDelivered(pending.map((n) => n.id));
  }

  /** The hand-over is in and they are idle: fire them, then their open work goes back to the coordinator. */
  #letGo(id: string): void {
    if (this.#leaving.has(id)) return;
    this.#leaving.add(id);
    void this.#d.engine
      .fire(id)
      .then(() => this.#d.company.releaseTasksOf(id))
      .catch(() => this.#leaving.delete(id));
  }

  /** The brief changed since this employee's previous task started (or since they were hired). */
  #briefChanged(task: Task): boolean {
    const changed = this.#d.company.briefUpdatedAt();
    if (changed === 0) return false;
    const earlier = this.#d.tasks
      .list({ assignee: task.assignee })
      .filter((t) => t.id !== task.id && t.startedAt !== null)
      .map((t) => t.startedAt as number);
    const since = earlier.length ? Math.max(...earlier) : this.#d.roster.get(task.assignee).createdAt;
    return changed >= since;
  }

  #delivery(task: Task): string {
    let plan = '';
    if (task.planId) {
      try {
        plan = `\nPlan: ${this.#d.plans.get(task.planId).title}`;
      } catch {
        plan = '';
      }
    }
    const done = task.done.length ? `\n\nBitti tanımı:\n${task.done.map((d) => `- ${d}`).join('\n')}` : '';
    const deps = task.dependsOn.length ? `\nÖnce bitenler: ${task.dependsOn.join(', ')}` : '';
    const brief = this.#briefChanged(task) ? '\nŞirket özeti değişti; güncelini briefRead ile oku.' : '';
    return `## Görev: ${task.title}
Görev no: ${task.id}${plan}
İsteyen: ${this.#d.company.nameOf(task.requester)} · Öncelik: ${task.priority}${deps}${brief}

${task.description || '(açıklama yok)'}${done}

İş bitince \`taskFinish\` ile teslim et (görev no, kısa özet, ürettiğin dosyalar, öğrendiklerin). Takılırsan \`taskUpdate\` ile "blocked" yap ve nedenini yaz; başka birinin yapması gereken bir parça çıkarsa \`taskPass\` kullan.`;
  }

  /** Still open after the reminder: the queue behind it is stuck, so the coordinator decides (ask, or taskAssign). */
  #escalate(id: string, task: Task): void {
    if (this.#escalated.has(task.id)) return;
    const coordinator = this.#d.company.coordinator();
    if (!coordinator || coordinator.id === id) return;
    this.#escalated.add(task.id);
    this.#d.notices.add(
      coordinator.id,
      `${this.#d.company.nameOf(id)} “${task.title}” görevini (no ${task.id}) hatırlatmaya rağmen teslim etmedi; sırasındaki işler bekliyor. Ona sor ya da taskAssign ile başkasına ver.`,
    );
    this.#schedule(coordinator.id);
  }

  #nudge(task: Task): string {
    return `${NUDGE_PREFIX} “${task.title}” görevi (no ${task.id}) hâlâ açık görünüyor. Bitirdiysen \`taskFinish\` ile teslim et; takıldıysan \`taskUpdate\` ile durumunu yaz.`;
  }
}
