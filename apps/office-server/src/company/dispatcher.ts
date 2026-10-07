import { DEFAULT_CONSTITUTION, TASK_DIFFICULTY_LABELS, type Constitution, type Employee, type ModelAlias, type Task } from '@cc/shared';
import type { ModelHint, SendOptions } from '../engine.ts';
import type { EventStore } from '../event-store.ts';
import type { Roster } from '../roster.ts';
import type { Company } from './company.ts';
import { NOTHING_FOR_A_SLEEPER, digestText, lastDigestSlot } from './notices.ts';
import type { NoticeStore, PlanStore, TaskStore } from './store.ts';

export interface DispatchEngine {
  ready(id: string): boolean;
  send(id: string, text: string, source: 'system', opts?: SendOptions): void;
  fire(id: string): Promise<void>;
  sleep(id: string): Promise<unknown>;
  wake(id: string): unknown;
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
  /** The owner's reserve and the constitution (absent: no reserve, no idle sleep). */
  budget?: { reserveActive(): boolean; constitution(): Constitution; checkReserve(): void };
  now?: () => number;
  /** How often the reserve is re-checked and everyone swept again (the quota resets on its own clock). */
  tickMs?: number;
}

export const NUDGE_PREFIX = 'Hatırlatma:';
export const NOTICES_PREFIX = 'Ofisten notlar:';

/**
 * Hands work to employees when they are free: the next task in their queue, the notices that need them (a plan was
 * approved, someone is stuck), or one reminder about a task they left open. Notices for the record (a colleague
 * handed in) ride along on those turns, or come together in one digest at the constitution's digest hours; the
 * coordinator's daily report reminder comes with the day's last digest. Never interrupts: it waits for the employee
 * to be idle (v1 rule: only the owner interrupts).
 */
export class Dispatcher {
  readonly #d: DispatcherDeps;
  readonly #defer: (fn: () => void) => void;
  readonly #queued = new Set<string>();
  /** Stalled tasks the coordinator has been told about (once per office run). */
  readonly #escalated = new Set<string>();
  /** Being let go after their hand-over (fire is under way). */
  readonly #leaving = new Set<string>();
  readonly #now: () => number;
  /** When each employee last became idle (for idle sleep). */
  readonly #idleSince = new Map<string, number>();
  #sweepQueued = false;

  constructor(d: DispatcherDeps) {
    this.#d = d;
    this.#defer = d.defer ?? ((fn) => void setImmediate(fn));
    this.#now = d.now ?? Date.now;
  }

  start(): () => void {
    const off = this.#d.events.subscribe((stored) => {
      const ev = stored.event;
      if (ev.type === 'lifecycle.changed' && stored.employeeId) {
        if (ev.to === 'idle') this.#idleSince.set(stored.employeeId, this.#now());
        else this.#idleSince.delete(stored.employeeId);
        if (ev.to === 'idle') this.#schedule(stored.employeeId);
      } else if (['task.changed', 'plan.changed', 'decision.recorded', 'quota.updated', 'budget.changed'].includes(ev.type)) this.#scheduleSweep();
    });
    const timer = setInterval(() => {
      this.#d.budget?.checkReserve();
      this.#scheduleSweep();
    }, this.#d.tickMs ?? 60_000);
    timer.unref();
    this.#scheduleSweep();
    return () => {
      off();
      clearInterval(timer);
    };
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
    const employee = this.#person(id);
    if (!employee) return;
    if (employee.lifecycle === 'sleeping') {
      if (this.#hasWorkFor(employee)) this.#wake(id);
      return;
    }
    if (!this.#d.engine.ready(id)) return;
    if (this.#d.company.handedOver(id)) {
      this.#letGo(id);
      return;
    }
    const pending = this.#d.notices.pending(id);
    const decisions = pending.filter((n) => n.kind === 'decision');
    const infos = pending.filter((n) => n.kind === 'info');
    // Someone the owner is letting go gets nothing but their hand-over, even while it is blocked.
    const handover = this.#d.tasks.list({ assignee: id, statuses: ['waiting', 'in_progress', 'blocked'] }).find((t) => t.kind === 'handover');
    const focus = handover && handover.status !== 'waiting' ? handover : this.#d.tasks.inProgressOf(id);
    let body = '';
    let started: Task | null = null;
    if (handover?.status === 'waiting') {
      // Leaving comes first, even with another task open: that task goes back to the coordinator afterwards.
      started = this.#d.company.start(handover.id);
    } else if (focus) {
      if (!focus.nudged) body = this.#nudge(focus);
      else this.#escalate(id, focus);
    } else {
      const next = this.#d.tasks.nextFor(id);
      if (next && this.#mayStart(next)) started = this.#d.company.start(next.id);
    }
    const hint = this.#hint(employee, started, Boolean(body) || started !== null || decisions.length > 0);
    if (started) body = this.#delivery(started, hint.model);
    const report = employee.kind === 'coordinator' ? this.#reportDue(employee) : null;
    // Information alone waits for a digest hour it has lived through (never during the owner's reserve); it rides on any turn that goes anyway.
    const digestNow = !this.#reserve() && (report !== null || infos.some((n) => n.createdAt <= lastDigestSlot(this.#now(), this.#digestHours())));
    if (!body && decisions.length === 0 && !digestNow) {
      this.#maybeSleep(employee, focus ?? null);
      return;
    }
    const alone = !body && decisions.length === 0;
    const digest = infos.length > 0 || report !== null ? digestText(infos, { coordinator: employee.kind === 'coordinator', report: report !== null, alone }) : '';
    const text = [decisions.length ? `${NOTICES_PREFIX}\n${decisions.map((n) => `- ${n.text}`).join('\n')}` : '', body, digest].filter(Boolean).join('\n\n');
    // Lost on the way (no session could be started to read it): the task and the notices wait for the next idle moment.
    const onLost = () => {
      this.#d.notices.markUndelivered(pending.map((n) => n.id));
      if (started) this.#putBack(id, started);
      this.#scheduleSweep();
    };
    try {
      this.#d.engine.send(id, text, 'system', { ...hint, onLost });
    } catch {
      // The session went away between ready() and send(): put the task back; the next idle moment delivers it.
      if (started) this.#putBack(id, started);
      return;
    }
    if (!started && focus && !focus.nudged) this.#d.tasks.update(focus.id, { nudged: true });
    this.#d.notices.markDelivered(pending.map((n) => n.id));
    if (report !== null) this.#d.events.append(id, { type: 'report.reminded', slot: report });
  }

  /** A task started for a message that never reached its assignee waits in their queue again. */
  #putBack(id: string, task: Task): void {
    const current = this.#d.tasks.get(task.id);
    if (current.assignee === id && current.status === 'in_progress') this.#d.tasks.update(task.id, { status: 'waiting', startedAt: null });
  }

  #rules(): Constitution {
    return this.#d.budget?.constitution() ?? DEFAULT_CONSTITUTION;
  }

  #digestHours(): number[] {
    return this.#rules().digestHours;
  }

  /**
   * The model a turn should run on (spec §6; the engine switches only as its model policy allows): the coordinator's by
   * what the turn is for — a decision (notices, a task, a reminder) or only a digest; anyone else's by the task it starts:
   * its difficulty's model, or their own (the roster's) without one. A model changes only at a task's start: a reminder
   * in the middle of a task, or notices, keep the session's model.
   */
  #hint(e: Employee, started: Task | null, decision: boolean): ModelHint {
    const rules = this.#rules();
    if (e.kind === 'coordinator') return { model: decision ? rules.coordinatorModels.decision : rules.coordinatorModels.digest };
    return started ? { model: started.difficulty ? rules.difficultyModels[started.difficulty] : e.model, taskStart: true } : {};
  }

  /**
   * Spec §4.5: a short report a day. Due at the day's last digest hour (that hour, or null) when a task was opened,
   * started or finished between the last report and it; once per digest hour (the log keeps it across restarts).
   */
  #reportDue(c: Employee): number | null {
    const hours = this.#digestHours();
    if (hours.length === 0) return null;
    const slot = lastDigestSlot(this.#now(), [Math.max(...hours)]);
    const reminded = this.#d.events.latest(c.id, 'report.reminded')?.event;
    if (reminded?.type === 'report.reminded' && reminded.slot >= slot) return null;
    const last = this.#d.events.latest(c.id, 'company.report')?.ts ?? 0;
    return this.#d.tasks.changedBetween(last, slot) ? slot : null;
  }

  #person(id: string): Employee | null {
    try {
      return this.#d.roster.get(id);
    } catch {
      return null;
    }
  }

  #reserve(): boolean {
    return this.#d.budget?.reserveActive() ?? false;
  }

  /** While the owner's share is kept, only urgent work and hand-overs start. */
  #mayStart(task: Task): boolean {
    return !this.#reserve() || task.priority === 1 || task.kind === 'handover';
  }

  /** A sleeper wakes for a task that may start now, a notice that needs them, or (the coordinator) the daily report. */
  #hasWorkFor(e: Employee): boolean {
    if (this.#d.tasks.list({ assignee: e.id, statuses: ['waiting'] }).some((t) => t.kind === 'handover')) return true;
    const next = this.#d.tasks.nextFor(e.id);
    if (next && this.#mayStart(next)) return true;
    // Information never wakes anyone: it waits for their next turn or a digest they are awake for. During the owner's
    // reserve only the coordinator wakes for a decision; one that asks nothing of a sleeper wakes no one.
    const wakes = this.#d.notices.pending(e.id).some((n) => n.kind === 'decision' && !NOTHING_FOR_A_SLEEPER.has(n.topic));
    if (wakes && (e.kind === 'coordinator' || !this.#reserve())) return true;
    return e.kind === 'coordinator' && !this.#reserve() && this.#reportDue(e) !== null;
  }

  #wake(id: string): void {
    try {
      this.#d.engine.wake(id);
    } catch {
      // Busy with an owner's action: the next sweep tries again.
    }
  }

  /** Nothing to do: in the reserve members sleep at once; otherwise after the constitution's idle minutes. */
  #maybeSleep(e: Employee, focus: Task | null): void {
    if (focus) return;
    if (this.#reserve() && e.kind !== 'coordinator') {
      void this.#d.engine.sleep(e.id).catch(() => undefined);
      return;
    }
    const minutes = this.#d.budget?.constitution().idleSleepMinutes ?? 0;
    if (minutes <= 0) return;
    const since = this.#idleSince.get(e.id);
    if (since === undefined) {
      this.#idleSince.set(e.id, this.#now());
      return;
    }
    if (this.#now() - since >= minutes * 60_000) void this.#d.engine.sleep(e.id).catch(() => undefined);
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
    const since = this.#d.tasks.lastStartedAt(task.assignee, task.id) ?? this.#d.roster.get(task.assignee).createdAt;
    return changed >= since;
  }

  #delivery(task: Task, model?: ModelAlias): string {
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
    const level = task.difficulty ? `\nZorluk: ${TASK_DIFFICULTY_LABELS[task.difficulty]}${model ? ` · Model: ${model}` : ''}` : '';
    return `## Görev: ${task.title}
Görev no: ${task.id}${plan}
İsteyen: ${this.#d.company.nameOf(task.requester)} · Öncelik: ${task.priority}${level}${deps}${brief}

${task.description || '(açıklama yok)'}${done}

İş bitince \`taskFinish\` ile teslim et (görev no, kısa özet, ürettiğin dosyalar, öğrendiklerin). Takılırsan \`taskUpdate\` ile "blocked" yap ve nedenini yaz; başka birinin yapması gereken bir parça çıkarsa \`taskPass\` kullan.`;
  }

  /** Still open after the reminder: the queue behind it is stuck, so the coordinator decides (ask, or taskAssign). */
  #escalate(id: string, task: Task): void {
    if (this.#escalated.has(task.id)) return;
    const coordinator = this.#d.company.coordinator();
    if (!coordinator || coordinator.id === id) return;
    this.#escalated.add(task.id);
    const name = this.#d.company.nameOf(id);
    this.#d.notices.add(
      coordinator.id,
      'task.stalled',
      task.kind === 'handover'
        ? `${name} devir görevini hatırlatmaya rağmen teslim etmedi. Devir başkasına verilemez: ona sor, gerekirse reportToOwner ile sahibine bildir (sahibi Hemen çıkar ile devri atlayabilir).`
        : `${name} “${task.title}” görevini (no ${task.id}) hatırlatmaya rağmen teslim etmedi; sırasındaki işler bekliyor. Ona sor ya da taskAssign ile başkasına ver.`,
    );
    this.#schedule(coordinator.id);
  }

  #nudge(task: Task): string {
    return `${NUDGE_PREFIX} “${task.title}” görevi (no ${task.id}) hâlâ açık görünüyor. Bitirdiysen \`taskFinish\` ile teslim et; takıldıysan \`taskUpdate\` ile durumunu yaz.`;
  }
}
