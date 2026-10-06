import type { Employee, EmployeeKind, HireInput, Lifecycle, ModelAlias, OfficeEvent, Plan, Task, TaskResult } from '@cc/shared';
import { OWNER } from '@cc/shared';
import { deskDir, writeRoleCard } from '../desk.ts';
import { ConflictError, ForbiddenError, ValidationError } from '../errors.ts';
import type { EventStore } from '../event-store.ts';
import type { Roster } from '../roster.ts';
import { readBrief, writeBrief } from './brief.ts';
import { COORDINATOR_ROLE } from './roles.ts';
import type { NoticeStore, PlanStore, TaskStore } from './store.ts';

/** The constitution's loop guards (spec §4.6). */
export const LIMITS = { chainDepth: 5, perDay: 30, perPlanOpen: 60 } as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const BRIEF_MAX = 8000;

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

function clean(value: string | undefined, label: string, max: number, required: boolean): string {
  const text = (value ?? '').trim();
  if (required && !text) throw new ValidationError(`${label} boş olamaz.`);
  if (text.length > max) throw new ValidationError(`${label} en fazla ${max} karakter olabilir.`);
  return text;
}

function lines(items: string[] | undefined, label: string, maxItems: number, itemMax: number): string[] {
  const out = (items ?? []).map((s) => String(s).trim()).filter(Boolean);
  if (out.length > maxItems) throw new ValidationError(`${label} en fazla ${maxItems} madde olabilir.`);
  for (const item of out) if (item.length > itemMax) throw new ValidationError(`${label} maddeleri en fazla ${itemMax} karakter olabilir.`);
  return out;
}

function amount(value: number | null | undefined, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new ValidationError(`${label} sıfır ya da pozitif bir sayı olmalı.`);
  return value;
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
    return this.#d.hire({ ...input, kind: 'member', characterId });
  }

  /** Fable by default: planning and judgement are the hardest work in the company. */
  hireCoordinator(model: ModelAlias = 'fable'): Employee {
    if (this.coordinator()) throw new ConflictError('Ofiste zaten bir koordinatör var.');
    const characters = this.#d.characters();
    const characterId = characters.includes('manager') ? 'manager' : this.#leastUsedCharacter(characters);
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
    }
    const next = this.#d.roster.update(id, { kind: 'coordinator', reportsTo: null });
    writeRoleCard(this.#d.dataDir, next);
    this.#emit(next.id, { type: 'role.changed', kind: next.kind, title: next.title, team: next.team });
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

  // ── tasks ─────────────────────────────────────────────────────────────────

  createTask(by: string, input: TaskInput): Task {
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
      if (plan.status !== 'approved') throw new ConflictError(`“${plan.title}” planı henüz onaylanmadı; görevleri onaydan sonra aç.`);
      if (this.#d.tasks.openInPlan(planId) >= LIMITS.perPlanOpen) throw new ConflictError(`Bu planda en fazla ${LIMITS.perPlanOpen} açık görev olabilir.`);
    }
    const dependsOn = (input.dependsOn ?? []).filter(Boolean);
    for (const dep of dependsOn) this.#d.tasks.get(dep);
    const chainDepth = by === OWNER ? 0 : (this.#d.tasks.inProgressOf(by)?.chainDepth ?? -1) + 1;
    if (chainDepth > LIMITS.chainDepth) {
      this.#tellCoordinator(by, `${this.nameOf(by)} “${title}” görevini paslayamadı: görev zinciri ${LIMITS.chainDepth} halkayı geçti. Zinciri sen çöz.`);
      throw new ConflictError(`Görev zinciri en fazla ${LIMITS.chainDepth} halka olabilir; bu işi koordinatöre bırak.`);
    }
    const isCoordinator = by !== OWNER && this.#d.roster.get(by).kind === 'coordinator';
    if (by !== OWNER && !isCoordinator && this.#d.tasks.createdSince(by, this.#now() - DAY_MS) >= LIMITS.perDay) {
      this.#tellCoordinator(by, `${this.nameOf(by)} bugün ${LIMITS.perDay} görev açtı ve sınıra geldi.`);
      throw new ConflictError(`Bir çalışan günde en fazla ${LIMITS.perDay} görev açabilir.`);
    }
    const task = this.#d.tasks.create({ planId, title, description, done, requester: by, assignee: assignee.id, priority, dependsOn, chainDepth: Math.max(0, chainDepth) });
    this.#taskEvent('created', task);
    return task;
  }

  assign(by: string, taskId: string, assignee: string): Task {
    this.#assertCoordinator(by);
    const task = this.#d.tasks.get(taskId);
    if (task.status === 'in_progress') throw new ConflictError('Bu görev şu an sürüyor; bitmeden başkasına verilemez.');
    if (task.status === 'done' || task.status === 'cancelled') throw new ConflictError('Bu görev kapandı.');
    const target = this.#d.roster.get(assignee);
    if (target.lifecycle === 'archived') throw new ConflictError(`${target.name} işten çıkarıldı.`);
    const next = this.#d.tasks.update(taskId, { assignee: target.id, status: 'waiting', nudged: false });
    this.#taskEvent('assigned', next);
    return next;
  }

  reprioritize(by: string, taskId: string, priority: number): Task {
    this.#assertCoordinator(by);
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
      this.#tellCoordinator(by, `${this.nameOf(by)} “${task.title}” görevinde takıldı${note ? `: ${note}` : '.'}`);
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
    const next = this.#d.tasks.update(taskId, { status: 'done', result: handed, finishedAt: this.#now() });
    const line = `Görev bitti: “${task.title}” (${this.nameOf(task.assignee)}): ${handed.summary}`;
    if (task.requester !== OWNER && task.requester !== by) this.#d.notices.add(task.requester, line);
    if (coordinator && coordinator.id !== by && coordinator.id !== task.requester) this.#d.notices.add(coordinator.id, line);
    this.#taskEvent('finished', next);
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
    if (current.status === 'done' || current.status === 'declined') throw new ConflictError('Bu plan kapandı; yeni bir plan öner.');
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
    // A revision of an approved plan is a new proposal: it waits for the owner again (rule B, big change).
    const plan = this.#d.plans.update(planId, { ...merged, version: current.version + 1, status: 'draft', approvedAt: null });
    this.#emit(by, { type: 'plan.changed', change: 'revised', plan });
    return plan;
  }

  approve(planId: string): Plan {
    const current = this.#d.plans.get(planId);
    if (current.status !== 'draft') throw new ConflictError('Yalnız taslak bir plan onaylanabilir.');
    const plan = this.#d.plans.update(planId, { status: 'approved', approvedAt: this.#now() });
    this.#d.notices.add(current.proposedBy, `Plan onaylandı: “${plan.title}” (sürüm ${plan.version}). Görevleri aç ve dağıt.`);
    this.#emit(current.proposedBy, { type: 'plan.changed', change: 'approved', plan });
    return plan;
  }

  decline(planId: string): Plan {
    const current = this.#d.plans.get(planId);
    if (current.status !== 'draft') throw new ConflictError('Yalnız taslak bir plan reddedilebilir.');
    const plan = this.#d.plans.update(planId, { status: 'declined' });
    this.#d.notices.add(current.proposedBy, `Sahibi planı onaylamadı: “${plan.title}”. Ne istediğini sor, gerekirse yeni bir plan öner.`);
    this.#emit(current.proposedBy, { type: 'plan.changed', change: 'declined', plan });
    return plan;
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
    this.#d.notices.add(plan.proposedBy, `“${plan.title}” planının bütün görevleri bitti. Sonucu reportToOwner ile sahibine raporla.`);
    this.#emit(plan.proposedBy, { type: 'plan.changed', change: 'done', plan: done });
  }

  #leastUsedCharacter(characters: string[]): string {
    if (characters.length === 0) return 'voxel';
    const counts = new Map(characters.map((c) => [c, 0]));
    for (const e of this.#d.roster.list()) if (counts.has(e.characterId)) counts.set(e.characterId, (counts.get(e.characterId) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[1] - b[1] || characters.indexOf(a[0]) - characters.indexOf(b[0]))[0]![0];
  }

  #assertCoordinator(by: string): void {
    if (this.#d.roster.get(by).kind !== 'coordinator') throw new ForbiddenError('Yalnız koordinatör bunu yapabilir.');
  }

  #tellCoordinator(about: string, text: string): void {
    const c = this.coordinator();
    if (c && c.id !== about) this.#d.notices.add(c.id, text);
  }

  #taskEvent(change: 'created' | 'assigned' | 'started' | 'updated' | 'finished' | 'reprioritized', task: Task): void {
    this.#emit(task.assignee, { type: 'task.changed', change, task });
  }

  #emit(employeeId: string, event: OfficeEvent): void {
    this.#d.events.append(employeeId, event);
  }
}
