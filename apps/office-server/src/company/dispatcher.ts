import { DEFAULT_CONSTITUTION, REVIEW_SEVERITY_LABELS, TASK_DIFFICULTY_LABELS, type Constitution, type Employee, type ModelAlias, type Task } from '@cc/shared';
import type { ModelHint, SendOptions } from '../engine.ts';
import type { EventStore } from '../event-store.ts';
import type { Roster } from '../roster.ts';
import type { Company } from './company.ts';
import { digestText, lastDigestSlot } from './notices.ts';
import type { NoticeStore, PlanStore, TaskStore } from './store.ts';
import { formatWhen } from './time.ts';

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
  /** The project's pulse (spec §6.3), run on each tick. */
  pulse?: { check(): unknown };
  /** KPI measurement (B26), run on each tick after the pulse. */
  kpis?: { measure(): unknown };
  /** The capability precheck (B8): holds a task whose required capability the desk lacks. Absent: none. */
  precheck?: { hold(task: Task): boolean; release(): void };
  /** The office clock (spec §5): the tick becomes one of its jobs and every due run sweeps. Absent: the old interval. */
  clock?: { every(name: string, ms: number, fn: () => void): void; onRan(fn: () => void): void };
  /**
   * The task message's related memory (B12): the section put under the definition of done, '' for none. Absent (the
   * economy scenario, tests that do not care): no section.
   */
  related?: (task: Task) => string;
}

export const NUDGE_PREFIX = 'Hatırlatma:';
export const NOTICES_PREFIX = 'Ofisten notlar:';
export const WORK_CLOSING =
  'İş bitince `taskFinish` ile teslim et: görev no, kısa özet, bitti tanımının her maddesi için bir kanıt (evidence, aynı sırayla), ürettiğin dosyalar, öğrendiklerin. Takılırsan `taskUpdate` ile "blocked" yap ve nedenini yaz; başka birinin yapması gereken bir parça çıkarsa `taskPass` kullan.';
export const REVIEW_CLOSING =
  'Kararını `reviewDecide` ile ver: bu inceleme görevinin no’su, approve ya da changes, bulgular (her biri için severity — critical, important ya da minor — ve somut bir senaryo). Her iddiayı kendin doğrula; düzeltmeyi kendin yapma, yapana bırak. `taskFinish` kullanma.';
const DAY_MS = 24 * 60 * 60 * 1000;
/** An unanswered reminder comes again after this long (a sleep or a restart may have stopped the work it waited for). */
export const RENUDGE_MS = 30 * 60_000;
/** The coordinator hears about the same stalled task again only after this long. */
export const ESCALATE_MS = 2 * 60 * 60_000;

/**
 * Hands work to employees when they are free: the next task in their queue, the notices that need them (a plan was
 * approved, someone is stuck), or a reminder about a task they left open (again every RENUDGE_MS while it stays
 * unanswered, and then the coordinator hears, at most every ESCALATE_MS). Notices for the record (a colleague
 * handed in) ride along on those turns, or come together in one digest at the constitution's digest hours; the
 * coordinator's daily report reminder comes with the day's last digest. Never interrupts: it waits for the employee
 * to be idle (v1 rule: only the owner interrupts).
 */
export class Dispatcher {
  readonly #d: DispatcherDeps;
  readonly #defer: (fn: () => void) => void;
  readonly #queued = new Set<string>();
  /** When the coordinator was last told about each stalled task (again only after ESCALATE_MS; kept per office run). */
  readonly #escalated = new Map<string, number>();
  /** Being let go after their hand-over (fire is under way). */
  readonly #leaving = new Set<string>();
  readonly #now: () => number;
  /** When each employee last became idle (for idle sleep). */
  readonly #idleSince = new Map<string, number>();
  /** When each coordinator was last reminded to report (digest off: the reminder as before the economy plan). */
  readonly #reminded = new Map<string, number>();
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
      } else if (ev.type === 'background.overdue' && stored.employeeId) {
        this.#overdue(stored.employeeId, ev.jobs, ev.limitMs);
      } else if (['task.changed', 'plan.changed', 'decision.recorded', 'quota.updated', 'budget.changed', 'company.paused', 'schedule.changed'].includes(ev.type)) this.#scheduleSweep();
    });
    if (this.#d.clock) {
      // The clock runs the tick at its start and on its interval, and sweeps after every due run (a park came back).
      this.#d.clock.every('dispatcher.tick', this.#d.tickMs ?? 60_000, () => this.tick());
      this.#d.clock.onRan(() => this.#scheduleSweep());
      return off;
    }
    const timer = setInterval(() => this.tick(), this.#d.tickMs ?? 60_000);
    timer.unref();
    this.#pulse();
    this.#scheduleSweep();
    return () => {
      off();
      clearInterval(timer);
    };
  }

  /** One office tick: the reserve, the report reminder (digest off), the pulse, a sweep. */
  tick(): void {
    this.#d.budget?.checkReserve();
    if (!this.#rules().digestEnabled) this.#remindReport();
    this.#pulse();
    this.#measureKpis();
    this.#scheduleSweep();
  }

  /** The KPIs that are due are read or asked for; a failure never stops the office (the next tick tries again). */
  #measureKpis(): void {
    try {
      this.#d.kpis?.measure();
    } catch {
      // As the pulse: the next tick tries again.
    }
  }

  /** The office looks at the project; a failing pulse never stops the office (the next tick looks again). */
  #pulse(): void {
    try {
      this.#d.pulse?.check();
    } catch {
      // A pulse that fails never stops the office; the next tick looks again.
    }
  }

  sweep(): void {
    // B8: a held task whose capabilities are there now (or the switch off) waits in its queue again.
    this.#d.precheck?.release();
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
    // The owner paused the company: nothing is handed out, no one is woken (spec §6.4); the owner's messages go straight to the engine.
    if (this.#d.company.paused()) return;
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
    // With the digest switched off every notice goes at once, as before the economy plan.
    const digestOn = this.#rules().digestEnabled;
    const decisions = digestOn ? pending.filter((n) => n.kind === 'decision') : pending;
    const infos = digestOn ? pending.filter((n) => n.kind === 'info') : [];
    // Someone the owner is letting go gets nothing but their hand-over, even while it is blocked.
    const handover = this.#d.tasks.list({ assignee: id, statuses: ['waiting', 'in_progress', 'blocked'] }).find((t) => t.kind === 'handover');
    const focus = handover && handover.status !== 'waiting' ? handover : this.#d.tasks.inProgressOf(id);
    let body = '';
    let started: Task | null = null;
    let reminded: Task | null = null;
    if (handover?.status === 'waiting') {
      // Leaving comes first, even with another task open: that task goes back to the coordinator afterwards.
      started = this.#d.company.start(handover.id);
    } else if (focus) {
      // A reminder from before its time was kept counts as long ago. Until RENUDGE_MS has passed they work or wait.
      const since = focus.nudged ? this.#now() - (focus.nudgedAt ?? 0) : null;
      if (since === null || since >= RENUDGE_MS) {
        reminded = focus;
        body = this.#nudge(focus, since !== null);
        if (since !== null) this.#escalate(id, focus);
      }
    } else {
      let next = this.#d.tasks.nextFor(id);
      // B8: a task whose required capability this desk lacks is held, and the next one is tried. Each task is held at
      // most once here: a hold that leaves the task waiting must not spin the office.
      const held = new Set<string>();
      while (next && !held.has(next.id) && this.#d.precheck?.hold(next)) {
        held.add(next.id);
        next = this.#d.tasks.nextFor(id);
      }
      if (next && held.has(next.id)) next = null;
      if (next && this.#mayStart(next)) started = this.#d.company.start(next.id);
    }
    const hint = this.#hint(employee, started, Boolean(body) || started !== null || decisions.length > 0);
    if (started) body = this.#delivery(started, hint.model);
    const report = digestOn && employee.kind === 'coordinator' ? this.#reportDue(employee) : null;
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
    if (reminded) this.#d.tasks.update(reminded.id, { nudged: true, nudgedAt: this.#now() });
    this.#d.notices.markDelivered(pending.map((n) => n.id));
    if (report !== null) this.#d.events.append(id, { type: 'report.reminded', slot: report });
  }

  /**
   * Spec §4.5, with the digest off (as before the economy plan): a day after the last report, reminder or hire, if
   * something was done or is open, the coordinator gets a reminder notice.
   */
  #remindReport(): void {
    const c = this.#d.company.coordinator();
    if (!c) return;
    const now = this.#now();
    const last = Math.max(this.#d.events.latest(c.id, 'company.report')?.ts ?? 0, c.createdAt, this.#reminded.get(c.id) ?? 0);
    if (now - last < DAY_MS) return;
    const finished = this.#d.tasks.list({ statuses: ['done'], limit: 100_000 }).some((t) => (t.finishedAt ?? 0) > last);
    const open = this.#d.tasks.list({ statuses: ['waiting', 'in_progress', 'review', 'blocked', 'parked'], limit: 1 }).length > 0;
    if (!finished && !open) return;
    this.#reminded.set(c.id, now);
    this.#d.notices.add(c.id, 'report.reminder', 'Günlük özet zamanı: bugün ne bitti, ne sürüyor, ne takıldı, ne harcandı — reportToOwner ile sahibine kısaca raporla.');
    this.#schedule(c.id);
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
    if (!started) return {};
    return { model: started.difficulty && rules.difficultyModelsEnabled ? rules.difficultyModels[started.difficulty] : e.model, taskStart: true };
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

  /**
   * A sleeper wakes for a task that may start now; the coordinator and a lead also for their notices (they are their
   * work); a member's notices wait for their next waking (spec §3.4, as before the economy plan). With the digest on,
   * information wakes no one, and the coordinator wakes for the daily report.
   */
  #hasWorkFor(e: Employee): boolean {
    if (this.#d.tasks.list({ assignee: e.id, statuses: ['waiting'] }).some((t) => t.kind === 'handover')) return true;
    const next = this.#d.tasks.nextFor(e.id);
    if (next && this.#mayStart(next)) return true;
    if (e.kind !== 'coordinator' && e.kind !== 'lead') return false;
    const digestOn = this.#rules().digestEnabled;
    if (this.#d.notices.pending(e.id).some((n) => !digestOn || n.kind === 'decision')) return true;
    return digestOn && e.kind === 'coordinator' && !this.#reserve() && this.#reportDue(e) !== null;
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
    const requires = task.requires?.length ? `\nGereken yetenekler: ${task.requires.join(', ')} (masandaki karşılığı: capabilitiesRead)` : '';
    const brief = this.#briefChanged(task) ? '\nŞirket özeti değişti; güncelini briefRead ile oku.' : '';
    const reviewer = task.kind === 'work' && task.reviewer ? `\nİnceleyen: ${this.#d.company.nameOf(task.reviewer)} — teslimin onun onayıyla kapanır.` : '';
    const returned = task.kind === 'work' && (task.round ?? 0) > 0 ? this.#returned(task) : '';
    const level = task.difficulty && this.#rules().difficultyModelsEnabled ? `\nZorluk: ${TASK_DIFFICULTY_LABELS[task.difficulty]}${model ? ` · Model: ${model}` : ''}` : '';
    const due = task.dueAt ? `\nSon tarih: ${formatWhen(task.dueAt, this.#now())}` : '';
    const related = this.#related(task);
    return `## Görev: ${task.title}
Görev no: ${task.id}${plan}
İsteyen: ${this.#d.company.nameOf(task.requester)} · Öncelik: ${task.priority}${level}${due}${reviewer}${deps}${requires}${brief}

${task.description || '(açıklama yok)'}${done}${returned}${related}

${task.kind === 'review' ? REVIEW_CLOSING : WORK_CLOSING}`;
  }

  /** What the memory holds for the task (B12); a failing search costs the task nothing. */
  #related(task: Task): string {
    try {
      return this.#d.related?.(task) ?? '';
    } catch {
      return '';
    }
  }

  /** A task sent back by its reviewer: the findings of the last review go with it. */
  #returned(task: Task): string {
    const last = this.#d.tasks.latestReview(task.id);
    const outcome = last?.result?.review;
    if (!last || !outcome || outcome.decision !== 'changes') return '';
    const findings = outcome.findings.map((f) => `- [${REVIEW_SEVERITY_LABELS[f.severity]}] ${f.text}`).join('\n');
    return `\n\n### İnceleme: değişiklik istendi (tur ${task.round}, ${this.#d.company.nameOf(last.assignee)})\n${last.result?.summary ?? ''}\n${findings}\nÖnce kritik ve önemli bulguları kapat; her biri için ne yaptığını teslim özetine yaz.`;
  }

  /** Still open after the reminder: the queue behind it is stuck, so the coordinator decides (ask, or taskAssign). */
  #escalate(id: string, task: Task): void {
    const last = this.#escalated.get(task.id);
    if (last !== undefined && this.#now() - last < ESCALATE_MS) return;
    const coordinator = this.#d.company.coordinator();
    if (!coordinator || coordinator.id === id) return;
    this.#escalated.set(task.id, this.#now());
    const name = this.#d.company.nameOf(id);
    this.#d.notices.add(
      coordinator.id,
      'task.stalled',
      task.kind === 'handover'
        ? `${name} devir görevini hatırlatmaya rağmen teslim etmedi. Devir başkasına verilemez: ona sor, gerekirse reportToOwner ile sahibine bildir (sahibi Hemen çıkar ile devri atlayabilir).`
        : `${name} “${task.title}” ${task.kind === 'review' ? 'incelemesini' : 'görevini'} (no ${task.id}) hatırlatmaya rağmen ${task.kind === 'review' ? 'karara bağlamadı' : 'teslim etmedi'}; sırasındaki işler bekliyor. Ona sor ya da taskAssign ile başkasına ver.`,
    );
    this.#schedule(coordinator.id);
  }

  /** A job held someone alone past the cap: the engine freed them, the coordinator decides about the job. */
  #overdue(id: string, jobs: string[], limitMs: number): void {
    const coordinator = this.#d.company.coordinator();
    if (!coordinator || coordinator.id === id) return;
    const name = this.#d.company.nameOf(id);
    const span = limitMs % 3_600_000 === 0 ? `${limitMs / 3_600_000} saattir` : `${Math.round(limitMs / 60_000)} dakikadır`;
    this.#d.notices.add(
      coordinator.id,
      'background.overdue',
      `${name} adlı çalışanın arka plan işi (${jobs.join(', ') || 'adı yok'}) ${span} tek başına sürüyor. Süreç öldürülmedi, iş sürüyor; ${name} yeniden görev alabilir. İşi sormak ya da durdurmasını istemek (askColleague), görevini başkasına vermek (taskAssign) ya da sürmesine izin vermek senin kararın.`,
    );
    this.#schedule(coordinator.id);
  }

  /** `again`: the last reminder went unanswered — the work may have stopped under them (a sleep, a restart). */
  #nudge(task: Task, again: boolean): string {
    if (!again) {
      if (task.kind === 'review') return `${NUDGE_PREFIX} “${task.title}” (no ${task.id}) hâlâ açık. Kararını \`reviewDecide\` ile ver.`;
      return `${NUDGE_PREFIX} “${task.title}” görevi (no ${task.id}) hâlâ açık görünüyor. Bitirdiysen \`taskFinish\` ile teslim et; takıldıysan \`taskUpdate\` ile durumunu yaz.`;
    }
    const stopped = 'Uyutulduysan ya da ofis yeniden başladıysa arka planda çalışan işin durmuş olabilir: kaldığın yerden devam et.';
    if (task.kind === 'review') return `${NUDGE_PREFIX} “${task.title}” (no ${task.id}) hâlâ sende ve bir süredir karara bağlanmadı. ${stopped} Kararını \`reviewDecide\` ile ver.`;
    // A hand-over cannot be parked.
    const ways =
      task.kind === 'handover'
        ? 'Bitirdiysen `taskFinish` ile teslim et; takıldıysan `taskUpdate` ile yaz.'
        : 'Bir şey bekliyorsan görevi `taskPark` ile park et; bitirdiysen `taskFinish` ile teslim et; takıldıysan `taskUpdate` ile yaz.';
    return `${NUDGE_PREFIX} “${task.title}” görevi (no ${task.id}) hâlâ sende ve bir süredir ilerlemiyor. ${stopped} ${ways}`;
  }
}
