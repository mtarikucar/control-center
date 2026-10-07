import { statSync } from 'node:fs';
import { relative } from 'node:path';
import type { Constitution, Employee, EmployeeKind, HireInput, Lifecycle, ModelAlias, OfficeEvent, Plan, Proposal, ProposalKind, Task, TaskResult } from '@cc/shared';
import { DEFAULT_CONSTITUTION, MODEL_ALIASES, OWNER, PROPOSAL_KINDS, TASK_DIFFICULTIES, type TaskDifficulty } from '@cc/shared';
import { deskDir, writeRoleCard } from '../desk.ts';
import { ConflictError, ForbiddenError, ValidationError } from '../errors.ts';
import type { EventStore } from '../event-store.ts';
import type { Roster } from '../roster.ts';
import { archiveTask } from './archive.ts';
import { briefPath, readBrief, writeBrief } from './brief.ts';
import type { Memory } from './memory.ts';
import type { NoticeTopic } from './notices.ts';
import type { ProposalStore } from './proposal-store.ts';
import { COORDINATOR_ROLE } from './roles.ts';
import type { NoticeStore, PlanStore, TaskStore } from './store.ts';
import { clean, lines } from './text.ts';

/** The constitution's loop guards by default (spec §4.6); the owner changes them in the constitution. */
export const LIMITS = {
  chainDepth: DEFAULT_CONSTITUTION.chainDepth,
  perDay: DEFAULT_CONSTITUTION.tasksPerDay,
  perPlanOpen: DEFAULT_CONSTITUTION.openTasksPerPlan,
} as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const BRIEF_MAX = 8000;
const HANDOVER_TITLE = 'Devir: işten ayrılıyorsun';
const HANDOVER_TEXT = `Sahibi seni işten çıkarıyor. Ayrılmadan önce bildiklerini şirkete devret: öğrendiklerini ve yarım kalan işlerin
durumunu yaz, işe yarayacak dosyaları göster. Bu görevi taskFinish ile teslim edince ofis seni işten çıkaracak; açık
görevlerin koordinatöre döner.`;
const HANDOVER_DONE = [
  'Öğrendiklerin ve başkasının bilmesi gerekenler noteWrite ile şirket notlarında',
  'Elindeki işlerin durumu teslim özetinde (açık görevlerin koordinatöre dönecek)',
  'İşe yarayacak dosyalar teslimin outputs listesinde',
];
const PROPOSAL_TR: Record<ProposalKind, string> = { need: 'ihtiyaç', purchase: 'satın alma', idea: 'fikir', objection: 'itiraz' };

export interface CompanyDeps {
  roster: Roster;
  events: EventStore;
  tasks: TaskStore;
  plans: PlanStore;
  notices: NoticeStore;
  dataDir: string;
  /** Hires and starts a session (Engine.hire). */
  hire: (input: HireInput) => Employee;
  /** Character ids from the asset manifest. */
  characters: () => string[];
  /** Restarts a session so it reads a new role card and tool list (Engine.reload); absent in tests that do not care. */
  reload?: (id: string) => void;
  /** The owner's constitution (team size, loop limits); absent: the defaults. */
  constitution?: () => Constitution;
  /** Proposals (absent in tests that do not care). */
  proposals?: ProposalStore;
  /** The company memory: a hand-in's lesson becomes a note (absent in tests that do not care). */
  memory?: Memory;
  now?: () => number;
}

export interface TaskInput {
  assignee: string;
  title: string;
  description?: string;
  done?: string[];
  priority?: number;
  planId?: string | null;
  dependsOn?: string[];
  /** Sets the model the task starts on (the constitution's difficultyModels); none: the assignee's current model. */
  difficulty?: TaskDifficulty | null;
}

export interface PlanDraft {
  title: string;
  goal: string;
  approach: string;
  people?: string;
  steps?: string[];
  quotaPct?: number | null;
  usd?: number | null;
  days?: number | null;
  risks?: string;
}

export interface StatusLine {
  id: string;
  name: string;
  title: string;
  team: string;
  kind: EmployeeKind;
  lifecycle: Lifecycle;
  task: string | null;
}

function amount(value: number | null | undefined, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new ValidationError(`${label} sıfır ya da pozitif bir sayı olmalı.`);
  return value;
}

function difficultyOf(value: unknown): TaskDifficulty | null {
  if (value === undefined || value === null || value === '') return null;
  if (!(TASK_DIFFICULTIES as readonly unknown[]).includes(value)) throw new ValidationError(`Zorluk ${TASK_DIFFICULTIES.join(', ')} değerlerinden biri olmalı.`);
  return value as TaskDifficulty;
}

export class Company {
  readonly #d: CompanyDeps;
  readonly #now: () => number;

  constructor(d: CompanyDeps) {
    this.#d = d;
    this.#now = d.now ?? Date.now;
  }

  // ── people ────────────────────────────────────────────────────────────────

  coordinator(): Employee | null {
    return this.#d.roster.list().find((e) => e.kind === 'coordinator') ?? null;
  }

  nameOf(id: string): string {
    if (id === OWNER) return 'sahibi';
    try {
      return this.#d.roster.get(id).name;
    } catch {
      return id;
    }
  }

  status(): StatusLine[] {
    return this.#d.roster.list().map((e) => ({
      id: e.id,
      name: e.name,
      title: e.title,
      team: e.team,
      kind: e.kind,
      lifecycle: e.lifecycle,
      task: this.#d.tasks.inProgressOf(e.id)?.title ?? null,
    }));
  }

  /** The owner or the coordinator hires a member; the character is the given one if the manifest has it, else the least used. */
  hire(by: string, input: HireInput): Employee {
    if (by !== OWNER) this.#assertCoordinator(by);
    const characters = this.#d.characters();
    const characterId = input.characterId && characters.includes(input.characterId) ? input.characterId : this.#leastUsedCharacter(characters);
    const lead = input.team ? this.#d.roster.list().find((e) => e.kind === 'lead' && e.team === input.team?.trim()) : undefined;
    this.#assertRoom();
    return this.#d.hire({ ...input, kind: 'member', characterId, reportsTo: lead?.id ?? input.reportsTo ?? null });
  }

  /** Fable by default: planning and judgement are the hardest work in the company. */
  hireCoordinator(model: ModelAlias = 'fable'): Employee {
    if (this.coordinator()) throw new ConflictError('Ofiste zaten bir koordinatör var.');
    const characters = this.#d.characters();
    const characterId = characters.includes('manager') ? 'manager' : this.#leastUsedCharacter(characters);
    this.#assertRoom();
    const hired = this.#d.hire({ name: 'Koordinatör', role: COORDINATOR_ROLE, model, title: 'Koordinatör', kind: 'coordinator', characterId });
    this.#emit(hired.id, { type: 'role.changed', kind: hired.kind, title: hired.title, team: hired.team });
    return hired;
  }

  appointCoordinator(id: string): Employee {
    const target = this.#d.roster.get(id);
    if (target.lifecycle === 'archived') throw new ConflictError('Bu çalışan işten çıkarıldı.');
    const previous = this.coordinator();
    if (previous && previous.id !== id) {
      const demoted = this.#d.roster.update(previous.id, { kind: 'member' });
      writeRoleCard(this.#d.dataDir, demoted);
      this.#emit(demoted.id, { type: 'role.changed', kind: demoted.kind, title: demoted.title, team: demoted.team });
      this.#d.notices.add(demoted.id, 'role.changed', `Koordinatörlük ${target.name} adlı çalışana geçti; artık ekipte çalışansın. Rol kartın yenilendi.`);
      this.#d.reload?.(demoted.id);
    }
    const next = this.#d.roster.update(id, { kind: 'coordinator', reportsTo: null });
    writeRoleCard(this.#d.dataDir, next);
    this.#emit(next.id, { type: 'role.changed', kind: next.kind, title: next.title, team: next.team });
    if (previous && previous.id !== id) this.#rerouteProposals(previous.id);
    if (previous?.id !== id) {
      this.#d.notices.add(
        id,
        'role.coordinator',
        'Artık şirketin koordinatörüsün. Rol kartın ve araçların yenilendi (planPropose, hire, taskCreate, taskAssign…); durumu officeStatus, myTasks ve briefRead ile öğren.',
      );
      // A session reads its card and tool list only at start: without this the new coordinator has no coordinator tools.
      this.#d.reload?.(id);
    }
    return next;
  }

  editRoleCard(by: string, id: string, patch: { title?: string; team?: string; role?: string }): Employee {
    this.#assertCoordinator(by);
    const current = this.#d.roster.get(id);
    const next = this.#d.roster.update(id, {
      title: patch.title === undefined ? current.title : clean(patch.title, 'Unvan', 80, false),
      team: patch.team === undefined ? current.team : clean(patch.team, 'Ekip adı', 40, false),
      role: patch.role === undefined ? current.role : clean(patch.role, 'Rol tanımı', 4000, true),
    });
    writeRoleCard(this.#d.dataDir, next);
    this.#emit(id, { type: 'role.changed', kind: next.kind, title: next.title, team: next.team });
    return next;
  }
  /** The coordinator (or the owner) moves someone to another model; their session goes on with it, memory kept. */
  setModel(by: string, id: string, model: ModelAlias): Employee {
    if (by !== OWNER) this.#assertCoordinator(by);
    if (!(MODEL_ALIASES as readonly string[]).includes(model)) throw new ValidationError(`Bilinmeyen model: ${String(model)}. Seçenekler: ${MODEL_ALIASES.join(', ')}.`);
    const current = this.#d.roster.get(id);
    if (current.lifecycle === 'archived') throw new ConflictError(`${current.name} işten çıkarıldı.`);
    if (current.model === model) return current;
    const next = this.#d.roster.update(id, { model });
    this.#emit(id, { type: 'model.changed', model });
    this.#d.reload?.(id);
    return next;
  }


  // ── tasks ─────────────────────────────────────────────────────────────────

  createTask(by: string, input: TaskInput): Task {
    const rules = this.#rules();
    const assignee = this.#d.roster.get(input.assignee);
    if (assignee.lifecycle === 'archived') throw new ConflictError(`${assignee.name} işten çıkarıldı; ona görev verilemez.`);
    const title = clean(input.title, 'Başlık', 120, true);
    const description = clean(input.description, 'Açıklama', 4000, false);
    const done = lines(input.done, 'Bitti tanımı', 12, 300);
    const priority = input.priority ?? 3;
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) throw new ValidationError('Öncelik 1 (en acil) ile 5 arasında bir tam sayı olmalı.');
    const planId = input.planId ?? null;
    if (planId !== null) {
      const plan = this.#d.plans.get(planId);
      if (plan.status === 'draft') throw new ConflictError(`“${plan.title}” planı henüz onaylanmadı; görevleri onaydan sonra aç.`);
      if (plan.status === 'declined') throw new ConflictError(`“${plan.title}” planından vazgeçildi; gerekiyorsa yeni bir plan öner.`);
      if (this.#d.tasks.openInPlan(planId) >= rules.openTasksPerPlan) throw new ConflictError(`Bu planda en fazla ${rules.openTasksPerPlan} açık görev olabilir.`);
    }
    const dependsOn = (input.dependsOn ?? []).filter(Boolean);
    for (const dep of dependsOn) this.#d.tasks.get(dep);
    const chainDepth = by === OWNER ? 0 : (this.#d.tasks.inProgressOf(by)?.chainDepth ?? -1) + 1;
    if (chainDepth > rules.chainDepth) {
      this.#tellCoordinator(by, 'limit.chain', `${this.nameOf(by)} “${title}” görevini paslayamadı: görev zinciri ${rules.chainDepth} halkayı geçti. Zinciri sen çöz.`);
      throw new ConflictError(`Görev zinciri en fazla ${rules.chainDepth} halka olabilir; bu işi koordinatöre bırak.`);
    }
    const isCoordinator = by !== OWNER && this.#d.roster.get(by).kind === 'coordinator';
    if (by !== OWNER && !isCoordinator && this.#d.tasks.createdSince(by, this.#now() - DAY_MS) >= rules.tasksPerDay) {
      this.#tellCoordinator(by, 'limit.tasks_per_day', `${this.nameOf(by)} bugün ${rules.tasksPerDay} görev açtı ve sınıra geldi.`);
      throw new ConflictError(`Bir çalışan günde en fazla ${rules.tasksPerDay} görev açabilir.`);
    }
    const task = this.#d.tasks.create({
      planId, title, description, done, requester: by, assignee: assignee.id, priority, difficulty: this.#difficultyBy(by, input.difficulty), dependsOn, chainDepth: Math.max(0, chainDepth),
    });
    this.#taskEvent('created', task);
    if (planId !== null) this.#reopenPlan(planId);
    return task;
  }

  /** Gives a task to someone (and, with `difficulty`, says anew how hard it is). */
  assign(by: string, taskId: string, assignee: string, o: { difficulty?: TaskDifficulty | null } = {}): Task {
    this.#assertManages(by, this.#d.tasks.get(taskId).assignee, assignee);
    const task = this.#d.tasks.get(taskId);
    // Finishing a hand-over lets its holder go: moving it would fire someone the owner never chose.
    if (task.kind === 'handover') throw new ConflictError('Devir görevi başkasına verilemez; sahibi beklemek istemezse Hemen çıkar ile devri atlayabilir.');
    const holder = this.#person(task.assignee);
    // A running task stays with its assignee — unless they were fired or left it open after the office's reminder.
    if (task.status === 'in_progress' && !task.nudged && holder !== null && holder.lifecycle !== 'archived') {
      throw new ConflictError('Bu görev şu an sürüyor; bitmeden başkasına verilemez.');
    }
    if (task.status === 'done' || task.status === 'cancelled') throw new ConflictError('Bu görev kapandı.');
    const target = this.#d.roster.get(assignee);
    if (target.lifecycle === 'archived') throw new ConflictError(`${target.name} işten çıkarıldı.`);
    const difficulty = o.difficulty === undefined ? task.difficulty : difficultyOf(o.difficulty);
    const next = this.#d.tasks.update(taskId, { assignee: target.id, status: 'waiting', startedAt: null, nudged: false, difficulty });
    if (holder && holder.id !== target.id && holder.lifecycle !== 'archived') {
      const started = task.status === 'in_progress' || task.status === 'blocked';
      this.#d.notices.add(
        holder.id,
        started ? 'task.taken' : 'task.moved',
        `“${task.title}” görevi (no ${task.id}) ${target.name} adlı çalışana verildi${started ? '; üzerinde çalışmayı bırak.' : '.'}`,
      );
    }
    this.#taskEvent('assigned', next);
    return next;
  }

  /** Someone was fired: their open work waits again and the coordinator hands it out (spec §10); a hand-over is cancelled. */
  releaseTasksOf(id: string): void {
    this.#rerouteProposals(id);
    for (const m of this.#d.roster.list()) if (m.reportsTo === id) this.#d.roster.update(m.id, { reportsTo: null });
    const work: Task[] = [];
    for (const task of this.#d.tasks.list({ assignee: id, statuses: ['waiting', 'in_progress', 'blocked'] })) {
      if (task.kind === 'handover') {
        this.#taskEvent('updated', this.#d.tasks.update(task.id, { status: 'cancelled', finishedAt: this.#now() }));
        continue;
      }
      work.push(task);
      if (task.status !== 'waiting') this.#taskEvent('updated', this.#d.tasks.update(task.id, { status: 'waiting', startedAt: null, nudged: false }));
    }
    if (work.length === 0) return;
    const list = work.map((t) => `“${t.title}” (no ${t.id})`).join(', ');
    this.#tellCoordinator(id, 'task.orphaned', `${this.nameOf(id)} işten çıkarıldı; açık görevleri sahipsiz bekliyor: ${list}. taskAssign ile yeniden dağıt.`);
  }

  /**
   * The owner's "İşten çıkar": first a hand-over task (write down what you know), delivered before anything else; the
   * Dispatcher lets the person go once it is handed in (spec §3.4). Asking again returns the same task.
   */
  beginHandover(id: string): Task {
    const employee = this.#d.roster.get(id);
    if (employee.lifecycle === 'archived') throw new ConflictError(`${employee.name} zaten işten çıkarıldı.`);
    const open = this.#d.tasks.list({ assignee: id, statuses: ['waiting', 'in_progress', 'blocked'] }).find((t) => t.kind === 'handover');
    if (open) return open;
    const task = this.#d.tasks.create({
      kind: 'handover', planId: null, title: HANDOVER_TITLE, description: HANDOVER_TEXT, done: HANDOVER_DONE,
      requester: OWNER, assignee: id, priority: 1, dependsOn: [], chainDepth: 0,
    });
    this.#taskEvent('created', task);
    this.#tellCoordinator(id, 'employee.leaving', `${employee.name} işten çıkarılıyor; önce devir notlarını yazıyor. Açık görevleri sonra sana dönecek.`);
    return task;
  }

  /** The hand-over is in: the office may let them go. */
  handedOver(id: string): boolean {
    return this.#d.tasks.handoverDone(id);
  }

  /** When the company brief last changed (0 = never written). */
  briefUpdatedAt(): number {
    try {
      return statSync(briefPath(this.#d.dataDir)).mtimeMs;
    } catch {
      return 0;
    }
  }


  reprioritize(by: string, taskId: string, priority: number): Task {
    this.#assertManages(by, this.#d.tasks.get(taskId).assignee);
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) throw new ValidationError('Öncelik 1 (en acil) ile 5 arasında bir tam sayı olmalı.');
    const next = this.#d.tasks.update(taskId, { priority });
    this.#taskEvent('reprioritized', next);
    return next;
  }

  /** The office hands the task to its assignee (Dispatcher). */
  start(taskId: string): Task {
    const next = this.#d.tasks.update(taskId, { status: 'in_progress', startedAt: this.#now(), nudged: false });
    this.#taskEvent('started', next);
    return next;
  }

  update(by: string, taskId: string, u: { note?: string; blocked?: boolean }): Task {
    const task = this.#d.tasks.get(taskId);
    if (task.assignee !== by) throw new ForbiddenError('Yalnız görevi üstlenen durumunu güncelleyebilir.');
    const note = u.note === undefined ? task.note : clean(u.note, 'Not', 2000, false) || null;
    let status = task.status;
    if (u.blocked === true) status = 'blocked';
    if (u.blocked === false && task.status === 'blocked') status = 'in_progress';
    const next = this.#d.tasks.update(taskId, { note, status });
    if (status === 'blocked' && task.status !== 'blocked') {
      this.#tellCoordinator(by, 'task.blocked', `${this.nameOf(by)} “${task.title}” görevinde takıldı${note ? `: ${note}` : '.'}`);
    }
    this.#taskEvent('updated', next);
    return next;
  }

  finish(by: string, taskId: string, result: TaskResult): Task {
    const task = this.#d.tasks.get(taskId);
    const coordinator = this.coordinator();
    if (task.assignee !== by && coordinator?.id !== by) throw new ForbiddenError('Yalnız görevi üstlenen ya da koordinatör teslim edebilir.');
    if (task.status === 'done' || task.status === 'cancelled') throw new ConflictError('Bu görev zaten kapandı.');
    const handed: TaskResult = {
      summary: (result.summary ?? '').trim().slice(0, 4000),
      outputs: (result.outputs ?? []).map((o) => String(o).trim()).filter(Boolean).slice(0, 30),
      learned: (result.learned ?? '').trim().slice(0, 4000),
    };
    if (!handed.summary) throw new ValidationError('Teslim özeti boş olamaz.');
    const finishedAt = this.#now();
    let archived: TaskResult = handed;
    try {
      const assignee = this.#d.roster.get(task.assignee);
      const planTitle = task.planId ? this.#d.plans.get(task.planId).title : null;
      const dir = archiveTask({ dataDir: this.#d.dataDir, desk: deskDir(this.#d.dataDir, assignee.slug), task, result: handed, planTitle, by: assignee.name, now: finishedAt });
      archived = { ...handed, archive: relative(this.#d.dataDir, dir) };
    } catch {
      // The archive never blocks a hand-in: the result is kept in the database either way.
    }
    const next = this.#d.tasks.update(taskId, { status: 'done', result: archived, finishedAt });
    const line = `“${task.title}” (${this.nameOf(task.assignee)}): ${handed.summary}`;
    if (task.requester !== OWNER && task.requester !== by) {
      // A requester stuck on their own task is likely waiting for this one: they can go on now.
      const waiting = this.#d.tasks.list({ assignee: task.requester, statuses: ['blocked'], limit: 1 }).length > 0;
      this.#d.notices.add(task.requester, waiting ? 'task.awaited' : 'task.finished', line);
    }
    if (coordinator && coordinator.id !== by && coordinator.id !== task.requester) this.#d.notices.add(coordinator.id, 'task.finished', line);
    this.#taskEvent('finished', next);
    this.#d.memory?.learnedFrom(next, handed);
    if (task.planId) this.#maybeFinishPlan(task.planId);
    return next;
  }

  // ── plans ─────────────────────────────────────────────────────────────────

  propose(by: string, draft: PlanDraft): Plan {
    this.#assertCoordinator(by);
    const plan = this.#d.plans.create({ ...this.#draft(draft), proposedBy: by });
    this.#emit(by, { type: 'plan.changed', change: 'proposed', plan });
    return plan;
  }

  revise(by: string, planId: string, draft: Partial<PlanDraft>): Plan {
    this.#assertCoordinator(by);
    const current = this.#d.plans.get(planId);
    if (current.status === 'declined') throw new ConflictError('Bu plandan vazgeçildi; yeni bir plan öner.');
    const merged = this.#draft({
      title: draft.title ?? current.title,
      goal: draft.goal ?? current.goal,
      approach: draft.approach ?? current.approach,
      people: draft.people ?? current.people,
      steps: draft.steps ?? current.steps,
      quotaPct: draft.quotaPct === undefined ? current.quotaPct : draft.quotaPct,
      usd: draft.usd === undefined ? current.usd : draft.usd,
      days: draft.days === undefined ? current.days : draft.days,
      risks: draft.risks ?? current.risks,
    });
    // A revision of an approved (or finished) plan is a new proposal: it waits for the owner again (rule B, big change).
    // Rule B: the approved version is kept until the owner decides on the revision (only the first revision saves it).
    if (current.status === 'approved' || current.status === 'done') this.#d.plans.saveApproved(planId);
    const plan = this.#d.plans.update(planId, { ...merged, version: current.version + 1, status: 'draft', approvedAt: null });
    this.#emit(by, { type: 'plan.changed', change: 'revised', plan });
    return plan;
  }

  approve(planId: string): Plan {
    const current = this.#d.plans.get(planId);
    if (current.status !== 'draft') throw new ConflictError('Yalnız taslak bir plan onaylanabilir.');
    const plan = this.#d.plans.update(planId, { status: 'approved', approvedAt: this.#now() });
    this.#d.plans.clearApproved(planId);
    const desk = this.#planDesk(plan);
    this.#d.notices.add(desk, 'plan.approved', `Plan onaylandı: “${plan.title}” (sürüm ${plan.version}). Görevleri aç ve dağıt.`);
    this.#emit(desk, { type: 'plan.changed', change: 'approved', plan });
    return plan;
  }

  decline(planId: string): Plan {
    const current = this.#d.plans.get(planId);
    if (current.status !== 'draft') throw new ConflictError('Yalnız taslak bir plan reddedilebilir.');
    if (this.#d.plans.approvedSnapshot(planId)) {
      const kept = this.#d.plans.restoreApproved(planId);
      const desk = this.#planDesk(kept);
      this.#d.notices.add(desk, 'plan.revision_declined', `Sahibi “${current.title}” revizyonunu onaylamadı; plan onaylı sürümüyle (sürüm ${kept.version}) sürüyor.`);
      this.#emit(desk, { type: 'plan.changed', change: 'kept', plan: kept });
      return kept;
    }
    const plan = this.#d.plans.update(planId, { status: 'declined' });
    const desk = this.#planDesk(plan);
    this.#d.notices.add(desk, 'plan.declined', `Sahibi planı onaylamadı: “${plan.title}”. Ne istediğini sor, gerekirse yeni bir plan öner.`);
    this.#emit(desk, { type: 'plan.changed', change: 'declined', plan });
    return plan;
  }
  // ── proposals ─────────────────────────────────────────────────────────────

  /**
   * Someone carries a need, an idea, an objection or a purchase upwards (spec §4.4): to their lead, else the
   * coordinator. A purchase always goes to the owner (the coordinator is told), as does anything the coordinator raises.
   */
  openProposal(by: string, p: { kind: string; title: string; text: string; usd?: number | null; planId?: string | null }): Proposal {
    const who = this.#d.roster.get(by);
    if (!(PROPOSAL_KINDS as readonly string[]).includes(p.kind)) {
      throw new ValidationError(`Bilinmeyen öneri türü: ${p.kind}. Türler: need (ihtiyaç), purchase (satın alma), idea (fikir), objection (itiraz).`);
    }
    const kind = p.kind as ProposalKind;
    const planId = p.planId ?? null;
    if (planId !== null) this.#d.plans.get(planId);
    const coordinator = this.coordinator();
    const lead = who.reportsTo ? this.#person(who.reportsTo) : null;
    const decider = lead && lead.kind === 'lead' && lead.lifecycle !== 'archived' ? lead : coordinator;
    const toOwner = kind === 'purchase' || !decider || decider.id === by;
    const proposal = this.#store().create({
      by,
      kind,
      title: clean(p.title, 'Başlık', 160, true),
      text: clean(p.text, 'Açıklama', 4000, true),
      usd: amount(p.usd, 'Tutar'),
      planId,
      status: toOwner ? 'owner' : 'open',
      routedTo: toOwner ? null : decider!.id,
    });
    const label = PROPOSAL_TR[kind];
    if (toOwner) {
      if (coordinator && coordinator.id !== by) {
        this.#d.notices.add(coordinator.id, 'proposal.to_owner', `${who.name} sahibine bir ${label} talebi açtı: “${proposal.title}”${proposal.usd !== null ? ` ($${proposal.usd})` : ''}. Sahibi karar verince haber gelecek.`);
      }
    } else {
      this.#d.notices.add(decider!.id, 'proposal.opened', `${who.name} bir ${label} açtı: “${proposal.title}” (no ${proposal.id}). proposalDecide ile karara bağla: accept, decline ya da büyükse escalate.`);
    }
    this.#emit(toOwner ? (coordinator?.id ?? by) : decider!.id, { type: 'proposal.changed', change: toOwner ? 'escalated' : 'opened', proposal });
    return proposal;
  }

  decideProposal(by: string, id: string, d: { decision: string; note?: string }): Proposal {
    const p = this.#store().get(id);
    if (p.status === 'owner') throw new ConflictError('Bu öneri sahibinin kararını bekliyor.');
    if (p.status !== 'open') throw new ConflictError('Bu öneri artık açık değil.');
    const me = this.#d.roster.get(by);
    if (p.routedTo !== by && me.kind !== 'coordinator') throw new ForbiddenError('Bu öneri sana gelmedi.');
    if (!['accept', 'decline', 'escalate'].includes(d.decision)) throw new ValidationError('Karar accept, decline ya da escalate olmalı.');
    const note = clean(d.note, 'Not', 2000, false) || null;
    if (d.decision === 'escalate') {
      const coordinator = this.coordinator();
      const toOwner = me.kind === 'coordinator' || !coordinator;
      const next = this.#store().update(id, toOwner ? { status: 'owner', routedTo: null, note } : { routedTo: coordinator!.id, note });
      if (!toOwner) this.#d.notices.add(coordinator!.id, 'proposal.escalated', `${me.name} bir öneriyi sana getirdi: “${p.title}” (no ${id})${note ? `: ${note}` : '.'} proposalDecide ile karara bağla.`);
      this.#emit(toOwner ? by : coordinator!.id, { type: 'proposal.changed', change: 'escalated', proposal: next });
      return next;
    }
    const accepted = d.decision === 'accept';
    const next = this.#store().update(id, { status: accepted ? 'accepted' : 'declined', decidedBy: by, note, decidedAt: this.#now() });
    this.#d.memory?.recordDecision(by, {
      title: `Öneri: ${p.title}`,
      chosen: accepted ? 'Kabul edildi' : 'Reddedildi',
      reason: note ?? (accepted ? 'Kabul edildi.' : 'Reddedildi.'),
      planId: p.planId,
    });
    if (p.by !== by) this.#d.notices.add(p.by, 'proposal.decided', `“${p.title}” önerin ${accepted ? 'kabul edildi' : 'reddedildi'}${note ? `: ${note}` : '.'}`);
    this.#emit(by, { type: 'proposal.changed', change: accepted ? 'accepted' : 'declined', proposal: next });
    return next;
  }

  /** The owner settles what waits for them: every purchase, and what was escalated. */
  ownerDecideProposal(id: string, approve: boolean, note?: string): Proposal {
    const p = this.#store().get(id);
    if (p.status !== 'owner') throw new ConflictError('Bu öneri sahibinin kararını beklemiyor.');
    const why = clean(note, 'Not', 2000, false) || null;
    const next = this.#store().update(id, { status: approve ? 'accepted' : 'declined', decidedBy: OWNER, note: why, decidedAt: this.#now() });
    const label = PROPOSAL_TR[p.kind];
    this.#d.memory?.recordOwnerDecision({
      title: `${label[0]!.toLocaleUpperCase('tr')}${label.slice(1)}: ${p.title}`,
      chosen: approve ? 'Onaylandı' : 'Reddedildi',
      reason: why ?? (approve ? 'Sahibi onayladı.' : 'Sahibi onaylamadı.'),
      planId: p.planId,
    });
    const line = approve
      ? p.kind === 'purchase'
        ? `Sahibi “${p.title}” satın alımını onayladı; satın alıp kuracak, hazır olunca haber verecek.`
        : `Sahibi “${p.title}” önerisini onayladı${why ? `: ${why}` : '.'}`
      : `Sahibi “${p.title}” ${label} talebini onaylamadı${why ? `: ${why}` : '.'}`;
    const coordinator = this.coordinator();
    this.#d.notices.add(p.by, 'proposal.owner_decided', line);
    if (coordinator && coordinator.id !== p.by) this.#d.notices.add(coordinator.id, 'proposal.owner_decided', line);
    this.#emit(coordinator?.id ?? p.by, { type: 'proposal.changed', change: approve ? 'accepted' : 'declined', proposal: next });
    return next;
  }

  /** Open proposals this person decides now (the coordinator also sees those with nobody). */
  proposalsFor(id: string): Proposal[] {
    const me = this.#d.roster.get(id);
    return this.#store()
      .list({ statuses: ['open'] })
      .filter((p) => p.routedTo === id || (me.kind === 'coordinator' && p.routedTo === null));
  }

  /** Their decider is gone (demoted, fired, replaced): open proposals go to today's coordinator, or wait for the next. */
  #rerouteProposals(fromId: string): void {
    if (!this.#d.proposals) return;
    const open = this.#d.proposals.list({ statuses: ['open'], routedTo: fromId });
    if (open.length === 0) return;
    const coordinator = this.coordinator();
    const to = coordinator && coordinator.id !== fromId ? coordinator.id : null;
    for (const p of open) {
      const next = this.#d.proposals.update(p.id, { routedTo: to });
      this.#emit(to ?? p.by, { type: 'proposal.changed', change: 'escalated', proposal: next });
    }
    if (to) {
      this.#d.notices.add(to, 'proposal.rerouted', `${this.nameOf(fromId)} artık karar vermiyor; açık önerileri sana geçti: ${open.map((p) => `“${p.title}” (no ${p.id})`).join(', ')}. proposalDecide ile karara bağla.`);
    }
  }

  #store(): ProposalStore {
    if (!this.#d.proposals) throw new ConflictError('Bu ofiste öneriler açık değil.');
    return this.#d.proposals;
  }

  // ── leads ─────────────────────────────────────────────────────────────────

  /** The coordinator makes someone lead of a team (or ends it): the team's members report to them (spec §3.1). */
  appointLead(by: string, id: string, o: { team?: string; lead?: boolean } = {}): Employee {
    this.#assertCoordinator(by);
    const target = this.#d.roster.get(id);
    if (target.lifecycle === 'archived') throw new ConflictError(`${target.name} işten çıkarıldı.`);
    if (target.kind === 'coordinator') throw new ConflictError('Koordinatör ekip lideri yapılamaz.');
    const makeLead = o.lead ?? true;
    const team = o.team === undefined ? target.team : clean(o.team, 'Ekip adı', 40, false);
    if (makeLead && !team) throw new ValidationError('Ekip liderinin bir ekibi olmalı (team).');
    const next = this.#d.roster.update(id, { kind: makeLead ? 'lead' : 'member', team, reportsTo: null });
    for (const m of this.#d.roster.list()) {
      if (m.id === id || m.kind !== 'member') continue;
      if (makeLead && m.team === team && m.reportsTo !== id) {
        this.#d.roster.update(m.id, { reportsTo: id });
        this.#d.notices.add(m.id, 'role.changed', `${next.name} artık ${team} ekibinin lideri; önerilerin önce ona gider.`);
      } else if (!makeLead && m.reportsTo === id) this.#d.roster.update(m.id, { reportsTo: null });
    }
    if (!makeLead) this.#rerouteProposals(id);
    writeRoleCard(this.#d.dataDir, next);
    this.#emit(id, { type: 'role.changed', kind: next.kind, title: next.title, team: next.team });
    this.#d.notices.add(
      id,
      'role.changed',
      makeLead
        ? `Artık ${team} ekibinin liderisin: ekibine taskCreate ile iş açar, taskAssign ve taskReprioritize ile dağıtır, önerilerini proposalDecide ile karara bağlarsın. Rol kartın ve araçların yenilendi.`
        : 'Ekip liderliğin bitti; ekipte çalışansın.',
    );
    this.#d.reload?.(id);
    return next;
  }


  report(by: string, text: string): void {
    this.#assertCoordinator(by);
    this.#emit(by, { type: 'company.report', text: clean(text, 'Rapor', 6000, true) });
  }

  // ── brief ─────────────────────────────────────────────────────────────────

  brief(): string {
    return readBrief(this.#d.dataDir);
  }

  updateBrief(by: string, text: string): void {
    this.#assertCoordinator(by);
    const body = clean(text, 'Şirket özeti', BRIEF_MAX, true);
    writeBrief(this.#d.dataDir, `${body}\n`, this.#d.roster.list().map((e) => deskDir(this.#d.dataDir, e.slug)));
    this.#emit(by, { type: 'brief.updated' });
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  #draft(d: PlanDraft): Omit<Plan, 'id' | 'status' | 'version' | 'proposedBy' | 'createdAt' | 'updatedAt' | 'approvedAt'> {
    return {
      title: clean(d.title, 'Plan başlığı', 120, true),
      goal: clean(d.goal, 'Hedef', 2000, true),
      approach: clean(d.approach, 'Yaklaşım', 6000, true),
      people: clean(d.people, 'Kimler', 2000, false),
      steps: lines(d.steps, 'Görev taslağı', 40, 300),
      quotaPct: amount(d.quotaPct, 'Kota payı'),
      usd: amount(d.usd, 'Para'),
      days: amount(d.days, 'Süre'),
      risks: clean(d.risks, 'Riskler', 2000, false),
    };
  }

  #maybeFinishPlan(planId: string): void {
    const plan = this.#d.plans.get(planId);
    if (plan.status !== 'approved' || this.#d.tasks.openInPlan(planId) > 0) return;
    const done = this.#d.plans.update(planId, { status: 'done' });
    const desk = this.#planDesk(done);
    this.#d.notices.add(
      desk,
      'plan.done',
      `“${plan.title}” planının açık görevi kalmadı. İş bittiyse sonucu reportToOwner ile sahibine raporla; sürüyorsa bu plana yeni görev açabilirsin (plan yeniden açılır).`,
    );
    this.#emit(desk, { type: 'plan.changed', change: 'done', plan: done });
  }

  /** The coordinator opens a plan's tasks as the work unfolds: a new task on a plan whose tasks had all finished. */
  #reopenPlan(planId: string): void {
    const plan = this.#d.plans.get(planId);
    if (plan.status !== 'done') return;
    const reopened = this.#d.plans.update(planId, { status: 'approved' });
    this.#emit(this.#planDesk(reopened), { type: 'plan.changed', change: 'reopened', plan: reopened });
  }

  /** Where plan news goes: today's coordinator (the one who proposed it may since have been replaced). */
  #planDesk(plan: Plan): string {
    return this.coordinator()?.id ?? plan.proposedBy;
  }

  #person(id: string): Employee | null {
    try {
      return this.#d.roster.get(id);
    } catch {
      return null;
    }
  }

  #leastUsedCharacter(characters: string[]): string {
    if (characters.length === 0) return 'voxel';
    const counts = new Map(characters.map((c) => [c, 0]));
    for (const e of this.#d.roster.list()) if (counts.has(e.characterId)) counts.set(e.characterId, (counts.get(e.characterId) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[1] - b[1] || characters.indexOf(a[0]) - characters.indexOf(b[0]))[0]![0];
  }

  #rules(): Constitution {
    return this.#d.constitution?.() ?? DEFAULT_CONSTITUTION;
  }

  #assertRoom(): void {
    const max = this.#rules().maxEmployees;
    if (this.#d.roster.list().length >= max) throw new ConflictError(`Anayasa en fazla ${max} çalışan diyor; yeni biri için sahibine getir.`);
  }

  /** The coordinator manages everyone; a lead their own team (spec §3.1). */
  #assertManages(by: string, ...ids: string[]): void {
    const me = this.#d.roster.get(by);
    if (me.kind === 'coordinator') return;
    if (me.kind === 'lead' && me.team && ids.every((id) => id === by || this.#person(id)?.team === me.team)) return;
    throw new ForbiddenError(me.kind === 'lead' ? 'Ekip lideri yalnız kendi ekibindeki işleri dağıtır.' : 'Yalnız koordinatör bunu yapabilir.');
  }

  #assertCoordinator(by: string): void {
    if (this.#d.roster.get(by).kind !== 'coordinator') throw new ForbiddenError('Yalnız koordinatör bunu yapabilir.');
  }

  /** A critical task runs on the strongest model: only the owner, the coordinator and leads ask for it; anyone else's counts as hard. */
  #difficultyBy(by: string, value: unknown): TaskDifficulty | null {
    const difficulty = difficultyOf(value);
    if (difficulty !== 'critical' || by === OWNER || this.#d.roster.get(by).kind !== 'member') return difficulty;
    return 'hard';
  }

  #tellCoordinator(about: string, topic: NoticeTopic, text: string): void {
    const c = this.coordinator();
    if (c && c.id !== about) this.#d.notices.add(c.id, topic, text);
  }

  #taskEvent(change: 'created' | 'assigned' | 'started' | 'updated' | 'finished' | 'reprioritized', task: Task): void {
    this.#emit(task.assignee, { type: 'task.changed', change, task });
  }

  #emit(employeeId: string, event: OfficeEvent): void {
    this.#d.events.append(employeeId, event);
  }
}
