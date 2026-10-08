import { statSync } from 'node:fs';
import { relative } from 'node:path';
import type { CompanyProfile, StoredEvent, Onboarding, OnboardingQuestionView, OnboardingRound, OnboardingView, ProfileSection, Constitution, Employee, EmployeeKind, Goal, GoalStatus, HireInput, Lifecycle, ModelAlias, Note, OfficeEvent, Plan, ProfileEntry, Proposal, ProposalKind, Schedule, ScheduleChange, ScheduleStatus, Task, TaskResult } from '@cc/shared';
import { DEFAULT_CONSTITUTION, GOAL_STATUSES, MODEL_ALIASES, OWNER, PROFILE_SPEC, PROPOSAL_KINDS, REVIEW_DECISIONS, SCHEDULE_STATUSES, TASK_DIFFICULTIES, reviewTally, type ReviewDecision, type TaskChange, type TaskDifficulty } from '@cc/shared';
import { deskDir, writeRoleCard } from '../desk.ts';
import { ConflictError, ForbiddenError, ValidationError } from '../errors.ts';
import type { EventStore } from '../event-store.ts';
import type { NewEmployee, Roster } from '../roster.ts';
import { archiveTask } from './archive.ts';
import { briefPath, readBrief, writeBrief } from './brief.ts';
import type { Memory } from './memory.ts';
import type { CompanyStateStore, GoalStore } from './goal-store.ts';
import { checkKpis } from './kpi.ts';
import { mergeProfile, profileSection } from './profile.ts';
import type { ProfileStore } from './profile-store.ts';
import { answerPatches, nextBlock, onboardingView } from './onboarding.ts';
import type { OnboardingStore } from './onboarding-store.ts';
import type { NoticeTopic } from './notices.ts';
import type { ProposalStore } from './proposal-store.ts';
import { REVIEW_ROUNDS, planMethod, reviewBrief, reviewFindings } from './review.ts';
import { roleTemplate, templateRole } from './role-templates.ts';
import { capabilityIds } from './capabilities.ts';
import { COORDINATOR_ROLE } from './roles.ts';
import { DUE_MAX_DAYS, PARK_MAX_DAYS, REPARK_LIMIT } from './scheduling.ts';
import type { NoticeStore, PlanStore, SchedulePatch, ScheduleStore, TaskPatch, TaskStore } from './store.ts';
import { clean, lines } from './text.ts';
import { formatWhen, minIntervalMinutes, nextCron, parseCron, parseUntil, type CronSpec } from './time.ts';

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
const SELF_REVIEW = 'Bir işi yapan kendi işinin inceleyicisi olamaz; başka birini seç.';
const PROPOSAL_TR: Record<ProposalKind, string> = { need: 'ihtiyaç', purchase: 'satın alma', idea: 'fikir', objection: 'itiraz' };
/** What a routine's new status is called in its event. */
const SCHEDULE_CHANGE: Record<ScheduleStatus, ScheduleChange> = { active: 'resumed', paused: 'paused', stopped: 'stopped' };

export interface CompanyDeps {
  roster: Roster;
  events: EventStore;
  tasks: TaskStore;
  plans: PlanStore;
  notices: NoticeStore;
  dataDir: string;
  /** Hires and starts a session (Engine.hire). */
  hire: (input: NewEmployee) => Employee;
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
  /** Goals and the company's own state (stage 2; absent in tests that do not care). */
  goals?: GoalStore;
  state?: CompanyStateStore;
  /** The company profile (B2; absent in tests that do not care). */
  profile?: ProfileStore;
  /** The onboarding dialog (B1; absent in tests that do not care). */
  onboarding?: OnboardingStore;
  /** Routines (stage: scheduler; absent in tests that do not care). */
  schedules?: ScheduleStore;
  /** The office clock: told when a time changed, so it re-arms (absent in tests that do not care). */
  clock?: { touch(): void };
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
  /** Who approves the hand-in before the task closes (spec §5.2): an employee id; never the assignee. */
  reviewer?: string | null;
  /** Not handed out before this time (spec §4.1): `+6h`, `+1d` or a local `2026-10-08T14:55`. */
  startAfter?: string | null;
  /** Should be done by this time (spec §4.3); same forms. */
  dueAt?: string | null;
  /** The routine this task is an instance of (spec §4.4; set by the due-processor only). */
  scheduleId?: string | null;
  /** The capabilities the work needs (B7): ids of the vocabulary. */
  requires?: unknown;
}

/** Recurring work (spec §4.4): each firing opens an ordinary task with these fields. */
export interface ScheduleInput {
  title: string;
  description?: string;
  done?: string[];
  assignee: string;
  /** 5 fields, local time. */
  cron: string;
  reviewer?: string | null;
  planId?: string | null;
  priority?: number;
  difficulty?: TaskDifficulty | null;
  /** Stop after this time: `+30d` or a local time. */
  until?: string | null;
}

/** What scheduleUpdate may change: anything but the plan, and the status. */
export type ScheduleUpdate = Partial<Omit<ScheduleInput, 'planId'>> & { status?: string };

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
  /** How the work is done (spec §5.1): required on a proposal, kept on a revision unless given. */
  method?: unknown;
  /** The active goal it serves (spec §6.1). */
  goalId?: string | null;
}

export interface GoalInput {
  goalId?: string;
  title?: string;
  why?: string;
  done?: string[];
  /** The whole KPI list (replaces it; [] clears it); checked by checkKpis. */
  kpis?: unknown;
  status?: string;
  note?: string;
}

/** onboardingNext's answer: the round asked (or still waiting for the owner), and what to assume. */
export interface OnboardingPlan {
  round: OnboardingRound | null;
  ask: OnboardingQuestionView[];
  assume: OnboardingQuestionView[];
  complete: boolean;
  view: OnboardingView;
  /** The last round has no reply from the owner yet: it is given again, nothing recorded. */
  waiting: boolean;
}

export interface ProfileInput {
  section: unknown;
  fields: unknown;
  assumed?: unknown;
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

function priorityOf(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 5) throw new ValidationError('Öncelik 1 (en acil) ile 5 arasında bir tam sayı olmalı.');
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
  /** The clock attached after construction (attachClock); else the one in the deps. */
  #clock: { touch(): void } | null = null;
  #isBlueprint: ((planId: string) => boolean) | null = null;
  /** KPI measurement (B26), attached after construction (it asks the company who coordinates). */
  #kpis: { retroTable(goalId: string | null): string | null } | null = null;

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
  /**
   * The owner or the coordinator hires. With a role template (B6) the role text comes from it — the given `role`
   * becomes the company's own part — and so do the title, team and model unless given; the template and its version
   * are recorded. Without one, as before: the role text as given. The capabilities (B7) given replace the template's;
   * none given, the template's (or none).
   */
  hire(by: string, input: HireInput, o: { deny?: string[] } = {}): Employee {
    if (by !== OWNER) this.#assertCoordinator(by);
    const template = input.template === undefined || input.template === null || input.template === '' ? null : roleTemplate(input.template);
    const capabilities = input.capabilities === undefined || input.capabilities === null ? (template?.capabilities ?? []) : capabilityIds(input.capabilities, 'Yetenekler');
    const resolved: NewEmployee = template
      ? {
          ...input,
          role: templateRole(template, typeof input.role === 'string' ? input.role : undefined),
          title: input.title?.trim() ? input.title : template.title,
          team: input.team?.trim() ? input.team : template.team,
          model: input.model ?? template.model,
          templateRef: { id: template.id, version: template.version },
          capabilityIds: capabilities,
        }
      : { ...input, templateRef: null, capabilityIds: capabilities };
    const characters = this.#d.characters();
    const characterId = input.characterId && characters.includes(input.characterId) ? input.characterId : this.#leastUsedCharacter(characters);
    const lead = resolved.team ? this.#d.roster.list().find((e) => e.kind === 'lead' && e.team === resolved.team?.trim()) : undefined;
    this.#assertRoom();
    return this.#d.hire({ ...resolved, kind: 'member', characterId, reportsTo: lead?.id ?? input.reportsTo ?? null, ...(o.deny?.length ? { deskDeny: o.deny } : {}) });
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

  /** `capabilities` (B7), when given, is the whole new list ([] clears it); not given, it stays. */
  editRoleCard(by: string, id: string, patch: { title?: string; team?: string; role?: string; capabilities?: unknown }): Employee {
    this.#assertCoordinator(by);
    const current = this.#d.roster.get(id);
    const next = this.#d.roster.update(id, {
      title: patch.title === undefined ? current.title : clean(patch.title, 'Unvan', 80, false),
      team: patch.team === undefined ? current.team : clean(patch.team, 'Ekip adı', 40, false),
      role: patch.role === undefined ? current.role : clean(patch.role, 'Rol tanımı', 4000, true),
      ...(patch.capabilities === undefined ? {} : { capabilities: capabilityIds(patch.capabilities, 'Yetenekler') }),
    });
    writeRoleCard(this.#d.dataDir, next);
    this.#emit(id, { type: 'role.changed', kind: next.kind, title: next.title, team: next.team });
    // What the session closes follows the capabilities (B9b): a change starts it again (now if idle, else after its turn).
    const sorted = (list: string[] | undefined) => [...(list ?? [])].sort().join(',');
    if (sorted(next.capabilities) !== sorted(current.capabilities)) this.#d.reload?.(id);
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
      if (plan.status === 'stopped') throw new ConflictError(`“${plan.title}” planı durduruldu; gerekiyorsa yeni bir plan öner.`);
      if (plan.status === 'done' && plan.goalId && this.#d.goals) {
        const goal = this.#d.goals.get(plan.goalId);
        if (goal.status !== 'active') throw new ConflictError(`“${plan.title}” planının hedefi (“${goal.title}”) kapalı; bitmiş bu plan yeniden açılamaz. Gerekiyorsa aktif bir hedefe yeni bir plan öner.`);
      }
      if (this.#d.tasks.openInPlan(planId) >= rules.openTasksPerPlan) throw new ConflictError(`Bu planda en fazla ${rules.openTasksPerPlan} açık görev olabilir.`);
    }
    const dependsOn = (input.dependsOn ?? []).filter(Boolean);
    for (const dep of dependsOn) this.#d.tasks.get(dep);
    const requires = input.requires === undefined || input.requires === null ? [] : capabilityIds(input.requires, 'Gereken yetenekler');
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
    const now = this.#now();
    const notBefore = input.startAfter ? parseUntil(input.startAfter, now, { maxDays: DUE_MAX_DAYS, label: 'Başlangıç saati' }) : null;
    const dueAt = input.dueAt ? parseUntil(input.dueAt, now, { maxDays: DUE_MAX_DAYS, label: 'Son tarih' }) : null;
    if (notBefore !== null && dueAt !== null && dueAt < notBefore) throw new ValidationError('Son tarih başlangıç saatinden önce olamaz.');
    const reviewer = this.#reviewerOf(input.reviewer, assignee.id);
    const task = this.#d.tasks.create({
      planId, title, description, done, requester: by, assignee: assignee.id, priority, difficulty: this.#difficultyBy(by, input.difficulty), reviewer, dependsOn, chainDepth: Math.max(0, chainDepth),
      notBefore, dueAt, scheduleId: input.scheduleId ?? null, requires,
    });
    this.#taskEvent('created', task);
    if (notBefore !== null || dueAt !== null) this.#touchClock();
    if (planId !== null) this.#reopenPlan(planId);
    return task;
  }

  /** Gives a task to someone (and, with `difficulty`, says anew how hard it is; with `reviewer`, who checks it). */
  assign(by: string, taskId: string, assignee: string, o: { difficulty?: TaskDifficulty | null; reviewer?: string | null } = {}): Task {
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
    if (task.status === 'review') throw new ConflictError('Bu görev incelemede; inceleme kararı gelmeden başkasına verilemez.');
    const target = this.#d.roster.get(assignee);
    if (target.lifecycle === 'archived') throw new ConflictError(`${target.name} işten çıkarıldı.`);
    let reviewer = task.reviewer ?? null;
    if (task.kind === 'review') {
      if (task.reviewOf && this.#d.tasks.get(task.reviewOf).assignee === target.id) throw new ConflictError(SELF_REVIEW);
    } else {
      if (o.reviewer !== undefined) reviewer = this.#reviewerOf(o.reviewer, target.id);
      if (reviewer === target.id) throw new ConflictError('Bu görevin inceleyicisi ona verilemez: yapan kendi işini onaylayamaz. Önce başka bir inceleyici seç (reviewer).');
    }
    const difficulty = o.difficulty === undefined ? task.difficulty : difficultyOf(o.difficulty);
    const next = this.#d.tasks.update(taskId, { assignee: target.id, status: 'waiting', startedAt: null, nudged: false, difficulty, reviewer, ...this.#leaveParked(task) });
    // Whoever takes over a review also reviews the later rounds.
    if (task.kind === 'review' && task.reviewOf) this.#d.tasks.update(task.reviewOf, { reviewer: target.id });
    if (holder && holder.id !== target.id && holder.lifecycle !== 'archived') {
      // The task leaves no trace with its holder: the pulse counts their idle time from now, not from their last finish.
      this.#d.state?.setTaskLost(holder.id, this.#now());
      const started = task.status === 'in_progress' || task.status === 'blocked';
      this.#d.notices.add(
        holder.id,
        started ? 'task.taken' : 'task.moved',
        `“${task.title}” görevi (no ${task.id}) ${target.name} adlı çalışana verildi; üzerinde çalışmayı bırak.`,
      );
    }
    this.#taskEvent('assigned', next);
    return next;
  }

  /** Someone was fired: their open work waits again and the coordinator hands it out (spec §10); a hand-over is cancelled. */
  releaseTasksOf(id: string): void {
    this.#rerouteProposals(id);
    // Routines they do or review wait for someone new (spec §4.4): the coordinator gives one.
    for (const sch of this.#d.schedules?.list({ statuses: ['active', 'paused'] }) ?? []) {
      const role = sch.assignee === id ? { who: 'atananı', next: 'atanan' } : sch.reviewer === id ? { who: 'inceleyicisi', next: 'inceleyici' } : null;
      if (!role) continue;
      if (sch.status === 'active') this.#applyScheduleStatus(sch, 'paused', id);
      this.#tellCoordinator(id, 'schedule.unassigned', `“${sch.title}” rutininin ${role.who} (${this.nameOf(id)}) işten çıkarıldı; rutin duraklatıldı. scheduleUpdate ile yeni bir ${role.next} ver ve sürdür.`);
    }
    for (const m of this.#d.roster.list()) if (m.reportsTo === id) this.#d.roster.update(m.id, { reportsTo: null });
    const work: Task[] = [];
    for (const task of this.#d.tasks.list({ assignee: id, statuses: ['waiting', 'in_progress', 'blocked', 'parked'] })) {
      if (task.kind === 'handover') {
        this.#taskEvent('updated', this.#d.tasks.update(task.id, { status: 'cancelled', finishedAt: this.#now() }));
        continue;
      }
      work.push(task);
      // A parked task keeps its return time as its start time (spec §4.5).
      if (task.status !== 'waiting') this.#taskEvent('updated', this.#d.tasks.update(task.id, { status: 'waiting', startedAt: null, nudged: false, parkedReason: null }));
    }
    // A task waiting for its review stays in review; if it comes back with changes it needs a new assignee.
    const inReview = this.#d.tasks.list({ assignee: id, statuses: ['review'] });
    if (work.length === 0 && inReview.length === 0) return;
    const name = (t: Task) => `“${t.title}” (no ${t.id})`;
    const open = work.length ? ` açık görevleri sahipsiz bekliyor: ${work.map(name).join(', ')}. taskAssign ile yeniden dağıt.` : '';
    const review = inReview.length ? ` İncelemede olanlar: ${inReview.map(name).join(', ')} — onaylanırsa kapanır; değişiklik istenirse taskAssign ile başkasına ver.` : '';
    this.#tellCoordinator(id, 'task.orphaned', `${this.nameOf(id)} işten çıkarıldı;${open}${review}`);
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

  // ── time (spec §4) ────────────────────────────────────────────────────────

  /**
   * Sets a task aside until a time (spec §4.2): by the one doing it, the coordinator, a lead for their team, or the
   * owner. The task stays open but holds no one's slot; the clock brings it back.
   */
  parkTask(by: string, taskId: string, until: string, reason: string): Task {
    const task = this.#d.tasks.get(taskId);
    if (by !== OWNER && task.assignee !== by) this.#assertManages(by, task.assignee);
    if (task.kind === 'handover') throw new ConflictError('Devir görevi park edilemez.');
    if (task.status === 'done' || task.status === 'cancelled') throw new ConflictError('Bu görev kapandı; park edilemez.');
    if (task.status === 'review') throw new ConflictError('Bu görev incelemede; kararı inceleyici verir, park edilemez.');
    const now = this.#now();
    const notBefore = parseUntil(until, now, { maxDays: PARK_MAX_DAYS, label: 'Dönüş saati' });
    const why = clean(reason, 'Gerekçe', 500, true);
    const wasStarted = task.status === 'in_progress' || task.status === 'blocked';
    const parkCount = (task.parkCount ?? 0) + 1;
    const next = this.#d.tasks.update(taskId, { status: 'parked', notBefore, parkedReason: why, parkCount, startedAt: null, nudged: false });
    this.#taskEvent('parked', next);
    const when = formatWhen(notBefore, now);
    if (wasStarted && by !== task.assignee) {
      this.#d.notices.add(task.assignee, 'task.parked', `“${task.title}” görevi (no ${task.id}) ${by === OWNER ? 'sahibi' : this.nameOf(by)} tarafından ${when} saatine ertelendi (${why}). Üzerinde çalışmayı bırak; saatinde geri gelecek.`);
    }
    if (by === OWNER) this.#tellOwnerChanged(`Sahibi “${task.title}” görevini ${when} saatine erteledi: ${why}.`);
    if (parkCount >= REPARK_LIMIT) {
      // An empty `about`: the brake is heard even when the coordinator is the one parking.
      this.#tellCoordinator('', 'task.reparked', `“${task.title}” görevi (no ${task.id}) ${parkCount}. kez ertelendi (son gerekçe: ${why}). Gerçek bir iş mi, bölünmeli mi, iptal mi — karar ver.`);
    }
    this.#touchClock();
    return next;
  }

  /**
   * A task leaving `parked` by any path but the clock's return or unparkTask forgets its park: a stale return time
   * would otherwise hold it as a start time. (Letting its holder go keeps it on purpose: releaseTasksOf, spec §4.5.)
   */
  #leaveParked(task: Task): TaskPatch {
    return task.status === 'parked' ? { notBefore: null, parkedReason: null } : {};
  }

  /** The time came (the clock): the parked task waits in its queue again — once, and only if still parked and due. */
  returnFromPark(taskId: string, now: number): Task | null {
    if (!this.#d.tasks.returnParked(taskId, now)) return null;
    const next = this.#d.tasks.update(taskId, { parkedReason: null });
    this.#taskEvent('returned', next);
    return next;
  }

  /** Brings a parked or start-timed task back now (coordinator, lead, owner); the owner's release also puts it first. */
  unparkTask(by: string, taskId: string, o: { priority?: number } = {}): Task {
    const task = this.#d.tasks.get(taskId);
    if (by !== OWNER) this.#assertManages(by, task.assignee);
    if (task.status === 'in_progress' || task.status === 'blocked') throw new ConflictError('Bu görev zaten sürüyor; park edilmiş değil.');
    if (task.status !== 'parked' && !(task.status === 'waiting' && task.notBefore !== null && task.notBefore !== undefined)) {
      throw new ConflictError('Bu görev park edilmiş ya da başlangıç saatli değil.');
    }
    if (o.priority !== undefined && (!Number.isInteger(o.priority) || o.priority < 1 || o.priority > 5)) throw new ValidationError('Öncelik 1 ile 5 arasında bir tam sayı olmalı.');
    const next = this.#d.tasks.update(taskId, { status: 'waiting', notBefore: null, parkedReason: null, startedAt: null, nudged: false, ...(o.priority !== undefined ? { priority: o.priority } : {}) });
    this.#taskEvent('returned', next);
    if (by === OWNER) this.#tellOwnerChanged(`Sahibi “${task.title}” görevini şimdi başlattı${o.priority === 1 ? ' (öncelik 1)' : ''}.`);
    this.#touchClock();
    return next;
  }

  /** The owner's "Öne al": priority 1, the time untouched. */
  ownerPrioritize(taskId: string): Task {
    const task = this.#d.tasks.get(taskId);
    if (task.status === 'done' || task.status === 'cancelled') throw new ConflictError('Bu görev kapandı.');
    const next = this.#d.tasks.update(taskId, { priority: 1 });
    this.#taskEvent('reprioritized', next);
    this.#tellOwnerChanged(`Sahibi “${task.title}” görevini öne aldı (öncelik 1).`);
    return next;
  }

  /** The blueprints (B5) are built after the company (they need it): which plans are install plans, attached here. */
  attachBlueprints(isBlueprint: (planId: string) => boolean): void {
    this.#isBlueprint = isBlueprint;
  }

  /** The clock is built after the company (it needs the scheduling service, which needs the company): attached here. */
  attachClock(clock: { touch(): void }): void {
    this.#clock = clock;
  }

  /** KPI measurement (B26) is built after the company: the retro's KPI table comes from it. */
  attachKpis(kpis: { retroTable(goalId: string | null): string | null }): void {
    this.#kpis = kpis;
  }

  /** A time changed: the clock re-arms for the nearest one. */
  #touchClock(): void {
    (this.#clock ?? this.#d.clock)?.touch();
  }

  /** What the owner changed from the sheet: the coordinator hears, for the record. */
  #tellOwnerChanged(text: string): void {
    const c = this.coordinator();
    if (c) this.#d.notices.add(c.id, 'agenda.owner_changed', text);
  }

  // ── routines (spec §4.4) ──────────────────────────────────────────────────

  /** The coordinator, or a lead for their own team, opens recurring work; each firing opens an ordinary task. */
  createSchedule(by: string, input: ScheduleInput): Schedule {
    const store = this.#schedules();
    const assignee = this.#d.roster.get(input.assignee);
    this.#assertManages(by, assignee.id);
    if (assignee.lifecycle === 'archived') throw new ConflictError(`${assignee.name} işten çıkarıldı; ona rutin verilemez.`);
    const max = this.#rules().maxSchedules;
    if (store.activeCount() >= max) throw new ConflictError(`En fazla ${max} rutin olabilir; önce birini durdur (scheduleUpdate: status stopped).`);
    const now = this.#now();
    const spec = this.#cronSpec(input.cron, now);
    const planId = input.planId ?? null;
    if (planId !== null) {
      const plan = this.#d.plans.get(planId);
      if (plan.status === 'done') throw new ConflictError(`“${plan.title}” planı bitti; rutin yalnız süren bir plana bağlanabilir.`);
      if (plan.status !== 'approved') throw new ConflictError(`“${plan.title}” planı sürmüyor; rutin yalnız süren bir plana bağlanabilir.`);
    }
    const schedule = store.create({
      title: clean(input.title, 'Başlık', 120, true),
      description: clean(input.description, 'Açıklama', 4000, false),
      done: lines(input.done, 'Bitti tanımı', 12, 300),
      assignee: assignee.id,
      reviewer: this.#reviewerOf(input.reviewer, assignee.id),
      planId,
      priority: priorityOf(input.priority ?? 3),
      difficulty: this.#difficultyBy(by, input.difficulty),
      cron: spec.expr,
      until: input.until ? parseUntil(input.until, now, { maxDays: DUE_MAX_DAYS, label: 'Bitiş' }) : null,
      createdBy: by,
      nextRunAt: nextCron(spec, now),
    });
    this.#emit(by, { type: 'schedule.changed', change: 'created', schedule });
    this.#touchClock();
    return schedule;
  }

  /** The coordinator, or a lead for their own team, changes a routine; a stopped one stays stopped. */
  updateSchedule(by: string, id: string, patch: ScheduleUpdate): Schedule {
    const store = this.#schedules();
    const current = store.get(id);
    this.#assertManages(by, current.assignee);
    if (current.status === 'stopped') throw new ConflictError('Bu rutin durduruldu; yenisini aç.');
    const now = this.#now();
    const next: SchedulePatch = {};
    if (patch.title !== undefined) next.title = clean(patch.title, 'Başlık', 120, true);
    if (patch.description !== undefined) next.description = clean(patch.description, 'Açıklama', 4000, false);
    if (patch.done !== undefined) next.done = lines(patch.done, 'Bitti tanımı', 12, 300);
    if (patch.priority !== undefined) next.priority = priorityOf(patch.priority);
    if (patch.difficulty !== undefined) next.difficulty = this.#difficultyBy(by, patch.difficulty);
    if (patch.until !== undefined) next.until = patch.until ? parseUntil(patch.until, now, { maxDays: DUE_MAX_DAYS, label: 'Bitiş' }) : null;
    if (patch.assignee !== undefined) {
      const assignee = this.#d.roster.get(patch.assignee);
      this.#assertManages(by, assignee.id);
      if (assignee.lifecycle === 'archived') throw new ConflictError(`${assignee.name} işten çıkarıldı.`);
      next.assignee = assignee.id;
    }
    const doer = next.assignee ?? current.assignee;
    if (patch.reviewer !== undefined) next.reviewer = this.#reviewerOf(patch.reviewer, doer);
    else if (current.reviewer === doer) throw new ConflictError(SELF_REVIEW);
    if (patch.cron !== undefined) {
      const spec = this.#cronSpec(patch.cron, now);
      next.cron = spec.expr;
      next.nextRunAt = nextCron(spec, now);
    }
    let change: ScheduleChange = 'updated';
    if (patch.status !== undefined) {
      if (!(SCHEDULE_STATUSES as readonly string[]).includes(patch.status)) throw new ValidationError('Rutin durumu active, paused ya da stopped olmalı.');
      const status = patch.status as ScheduleStatus;
      if (status !== current.status) {
        next.status = status;
        change = SCHEDULE_CHANGE[status];
        if (status === 'active') Object.assign(next, this.#resumed(next.cron ?? current.cron, doer, next.reviewer !== undefined ? next.reviewer : current.reviewer));
      }
    }
    const schedule = store.update(id, next);
    this.#emit(by, { type: 'schedule.changed', change, schedule });
    this.#touchClock();
    this.#planMayFinish(schedule);
    return schedule;
  }

  /** The owner's routine buttons (spec §6.3); the coordinator hears, for the record. */
  ownerSchedule(id: string, action: 'pause' | 'resume' | 'stop'): Schedule {
    const current = this.#schedules().get(id);
    if (current.status === 'stopped') throw new ConflictError('Bu rutin durduruldu; yeniden açılamaz.');
    const status = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'stopped';
    const next = this.#applyScheduleStatus(current, status, OWNER);
    const verb = action === 'pause' ? 'duraklattı' : action === 'resume' ? 'sürdürdü' : 'durdurdu';
    if (next.status !== current.status) this.#tellOwnerChanged(`Sahibi “${current.title}” rutinini ${verb}.`);
    this.#planMayFinish(next);
    return next;
  }

  /** The clock ends a routine (its until passed, or no run is left within 366 days): stopped, with why; its plan may finish. */
  endSchedule(id: string, note: string): Schedule {
    const current = this.#schedules().get(id);
    if (current.status === 'stopped') return current;
    const schedule = this.#applyScheduleStatus(current, 'stopped', null, { note });
    this.#planMayFinish(schedule);
    return schedule;
  }

  /** Active and paused routines, then the last 10 stopped. */
  schedules(): Schedule[] {
    if (!this.#d.schedules) return [];
    return [...this.#d.schedules.list({ statuses: ['active', 'paused'] }), ...this.#d.schedules.list({ statuses: ['stopped'] }).slice(-10)];
  }

  /** One status change of a routine, with its event; `by` null: the office's own (the clock). */
  #applyScheduleStatus(current: Schedule, status: ScheduleStatus, by: string | null, extra: SchedulePatch = {}): Schedule {
    if (current.status === status) return current;
    const patch: SchedulePatch = status === 'active' ? { ...extra, status, ...this.#resumed(current.cron, current.assignee, current.reviewer) } : { ...extra, status };
    const schedule = this.#schedules().update(current.id, patch);
    this.#emit(by === OWNER ? null : by, { type: 'schedule.changed', change: SCHEDULE_CHANGE[status], schedule });
    this.#touchClock();
    return schedule;
  }

  /**
   * A routine comes back: only with its assignee and reviewer still in the office; its next run is from now, so the
   * missed ones become one catch-up at most, and its failures count afresh.
   */
  #resumed(cron: string, assignee: string, reviewer: string | null): SchedulePatch {
    const gone = (id: string) => {
      const who = this.#person(id);
      return !who || who.lifecycle === 'archived';
    };
    if (gone(assignee)) throw new ConflictError(`${this.nameOf(assignee)} işten çıkarıldı; rutin yeni bir atanan verilene kadar duraklatılmış kalır.`);
    if (reviewer !== null && gone(reviewer)) throw new ConflictError(`${this.nameOf(reviewer)} işten çıkarıldı; rutin yeni bir inceleyici verilene kadar duraklatılmış kalır.`);
    return { nextRunAt: nextCron(parseCron(cron), this.#now()), failCount: 0 };
  }

  /** A routine stopped (not by its plan's own stop): it was open work, so its plan may be finished now — once. */
  #planMayFinish(schedule: Schedule): void {
    if (schedule.status === 'stopped' && schedule.planId) this.#maybeFinishPlan(schedule.planId);
  }

  /** A valid cron no more frequent than the constitution allows (the smallest gap among its next five runs). */
  #cronSpec(expr: string, now: number): CronSpec {
    const spec = parseCron(expr);
    const min = this.#rules().minScheduleMinutes;
    const gap = minIntervalMinutes(spec, now);
    if (gap < min) throw new ValidationError(`Rutin aralığı en az ${min} dk olmalı; bu zamanlama ${Math.round(gap)} dk'da bir tetikleniyor.`);
    return spec;
  }

  #schedules(): ScheduleStore {
    if (!this.#d.schedules) throw new ConflictError('Bu ofiste rutinler açık değil.');
    return this.#d.schedules;
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
    // A closed task stays closed: a stopped plan's cancelled work must not come back through a status note.
    if (task.status === 'done' || task.status === 'cancelled') throw new ConflictError('Bu görev kapandı; durumu değiştirilemez.');
    if (task.status === 'review') throw new ConflictError('Bu görev incelemede; inceleyicinin kararını bekle.');
    // A parked task's status is the clock's: blocked here would leave it neither parked nor held by anyone.
    if (task.status === 'parked' && u.blocked !== undefined) throw new ConflictError('Bu görev ertelendi; saatinde geri gelecek. Not düşebilirsin, durumunu saat değiştirir.');
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
    if (task.kind === 'review') throw new ConflictError('Bu bir inceleme görevi: kararını reviewDecide ile ver (approve ya da changes, bulgular önem dereceleriyle).');
    if (task.status === 'review') throw new ConflictError('Bu görev incelemede; inceleyicinin kararını bekle.');
    const evidence = lines(result.evidence, 'Kanıt', 20, 1000);
    const handed: TaskResult = {
      summary: (result.summary ?? '').trim().slice(0, 4000),
      outputs: (result.outputs ?? []).map((o) => String(o).trim()).filter(Boolean).slice(0, 30),
      learned: (result.learned ?? '').trim().slice(0, 4000),
      ...(evidence.length ? { evidence } : {}),
    };
    if (!handed.summary) throw new ValidationError('Teslim özeti boş olamaz.');
    // A hand-over's items are instructions for leaving, not claims to prove.
    if (task.kind === 'work' && evidence.length < task.done.length) {
      throw new ValidationError(`Bitti tanımında ${task.done.length} madde var; her biri için bir kanıt yaz (evidence, aynı sırayla): ne yaptın ve nasıl doğruladın.`);
    }
    const at = this.#now();
    const archived = this.#archive(task, handed, at);
    const reviewer = task.kind === 'work' && task.reviewer ? this.#reviewerFor(task) : null;
    if (reviewer) {
      const round = (task.round ?? 0) + 1;
      const next = this.#d.tasks.update(taskId, { status: 'review', result: archived, round, ...this.#leaveParked(task) });
      this.#taskEvent('in_review', next);
      const review = this.#d.tasks.create({
        kind: 'review', planId: task.planId, title: `İnceleme: ${task.title} (tur ${round})`, description: reviewBrief(next, this.nameOf(task.assignee), round),
        done: [], requester: task.requester, assignee: reviewer.id, priority: task.priority, difficulty: task.difficulty ?? null, dependsOn: [], chainDepth: 0, reviewOf: task.id,
      });
      this.#taskEvent('created', review);
      return next;
    }
    return this.#complete(task, archived, by, at, undefined, this.#leaveParked(task));
  }

  /**
   * The reviewer decides (spec §5.2): approve closes the reviewed task; changes sends it back to the one who did it,
   * with the findings. Returns the reviewed task.
   */
  reviewDecide(by: string, reviewTaskId: string, d: { decision: unknown; findings?: unknown; note?: string }): Task {
    const review = this.#d.tasks.get(reviewTaskId);
    if (review.kind !== 'review' || !review.reviewOf) throw new ValidationError('Bu bir inceleme görevi değil; reviewDecide yalnız “İnceleme:” görevleri içindir.');
    if (review.status === 'done' || review.status === 'cancelled') throw new ConflictError('Bu inceleme zaten karara bağlandı.');
    const coordinator = this.coordinator();
    const task = this.#d.tasks.get(review.reviewOf);
    if (task.assignee === by) throw new ForbiddenError('Kendi işini inceleyemezsin; inceleme başka birinde olmalı.');
    if (review.assignee !== by && coordinator?.id !== by) throw new ForbiddenError('Bu inceleme sana verilmedi.');
    if (task.status !== 'review') throw new ConflictError('Bu görev artık incelemede değil.');
    if (!(REVIEW_DECISIONS as readonly unknown[]).includes(d.decision)) throw new ValidationError('Karar (decision) approve ya da changes olmalı.');
    const decision = d.decision as ReviewDecision;
    const findings = reviewFindings(d.findings);
    const serious = findings.some((f) => f.severity !== 'minor');
    if (decision === 'approve' && serious) throw new ValidationError('Kritik ya da önemli bir bulgu varken onaylanamaz: changes ile geri gönder (bulgu küçükse minor yaz).');
    if (decision === 'changes' && !serious) {
      throw new ValidationError('Değişiklik istiyorsan en az bir kritik ya da önemli bulgu yaz (somut bir senaryoyla); yalnız küçük bulgular varsa approve et, küçükler kayda geçer.');
    }
    const note = clean(d.note, 'Not', 2000, false);
    const me = this.#d.roster.get(by);
    const at = this.#now();
    const tally = reviewTally(findings);
    const closed = this.#d.tasks.update(review.id, {
      status: 'done',
      finishedAt: at,
      result: { summary: `${decision === 'approve' ? 'Onaylandı' : 'Değişiklik istendi'}${tally ? ` (${tally})` : ''}${note ? `: ${note}` : ''}`, outputs: [], learned: '', review: { decision, findings } },
    });
    this.#taskEvent('reviewed', closed);
    if (decision === 'approve') {
      const minor = findings.length ? `; küçük notlar: ${findings.map((f) => f.text).join(' · ')}` : '.';
      this.#d.notices.add(task.assignee, 'review.approved', `“${task.title}” incelemeden geçti (${me.name} onayladı)${minor}`);
      return this.#complete(task, task.result ?? { summary: '', outputs: [], learned: '' }, by, at, me.name);
    }
    const back = this.#d.tasks.update(task.id, { status: 'waiting', startedAt: null, nudged: false });
    this.#taskEvent('updated', back);
    const round = task.round ?? 1;
    const line = `İnceleme: “${task.title}” için değişiklik istendi (tur ${round}, ${me.name}): ${tally}.`;
    const doer = this.#person(task.assignee);
    if (!doer || doer.lifecycle === 'archived') {
      // Told even when the coordinator is the one deciding: no one else would ever hand this task out again.
      const c = this.coordinator();
      if (c) this.#d.notices.add(c.id, 'task.orphaned', `${line} ${this.nameOf(task.assignee)} işten çıkarıldı; görevi taskAssign ile başkasına ver.`);
    }
    else if (round >= REVIEW_ROUNDS) this.#tellCoordinator(by, 'review.stuck', `${line} Bu iş ${round} turdur geçemiyor: yaklaşımı değiştir (başka kişi, başka model, işi böl) ya da sahibine götür.`);
    else this.#tellCoordinator(by, 'review.changes', line);
    return back;
  }

  /** The hand-in is kept in the archive; the archive never blocks it (the result is in the database either way). */
  #archive(task: Task, handed: TaskResult, at: number): TaskResult {
    try {
      const assignee = this.#d.roster.get(task.assignee);
      const planTitle = task.planId ? this.#d.plans.get(task.planId).title : null;
      const dir = archiveTask({ dataDir: this.#d.dataDir, desk: deskDir(this.#d.dataDir, assignee.slug), task, result: handed, planTitle, by: assignee.name, now: at });
      return { ...handed, archive: relative(this.#d.dataDir, dir) };
    } catch {
      return handed;
    }
  }

  /** The task closes: the requester and the coordinator hear, the lesson becomes a note, the plan may finish. */
  #complete(task: Task, result: TaskResult, by: string, at: number, approvedBy?: string, extra: TaskPatch = {}): Task {
    const next = this.#d.tasks.update(task.id, { status: 'done', result, finishedAt: at, ...extra });
    const coordinator = this.coordinator();
    const line = `Görev bitti: “${task.title}” (${this.nameOf(task.assignee)}${approvedBy ? `; ${approvedBy} onayladı` : ''}): ${result.summary}`;
    if (task.requester !== OWNER && task.requester !== by) {
      // A requester stuck on their own task is likely waiting for this one: they can go on now.
      const waiting = this.#d.tasks.list({ assignee: task.requester, statuses: ['blocked'], limit: 1 }).length > 0;
      this.#d.notices.add(task.requester, waiting ? 'task.awaited' : 'task.finished', line);
    }
    if (coordinator && coordinator.id !== by && coordinator.id !== task.requester) this.#d.notices.add(coordinator.id, 'task.finished', line);
    this.#taskEvent('finished', next);
    this.#d.memory?.learnedFrom(next, result);
    if (task.planId) this.#maybeFinishPlan(task.planId);
    return next;
  }

  /** A reviewer named for a task: someone in the office, not let go, and never the one who does it. */
  #reviewerOf(value: string | null | undefined, assignee: string): string | null {
    if (value === undefined || value === null || value === '') return null;
    const r = this.#d.roster.get(value);
    if (r.lifecycle === 'archived') throw new ConflictError(`${r.name} işten çıkarıldı; inceleyici olamaz.`);
    if (r.id === assignee) throw new ConflictError(SELF_REVIEW);
    return r.id;
  }

  /** Who reviews a hand-in now: its reviewer, or — if they were let go — the coordinator; never the one who did it. */
  #reviewerFor(task: Task): Employee | null {
    const named = task.reviewer ? this.#person(task.reviewer) : null;
    if (named && named.lifecycle !== 'archived' && named.id !== task.assignee) return named;
    const c = this.coordinator();
    return c && c.id !== task.assignee ? c : null;
  }

  // ── plans ─────────────────────────────────────────────────────────────────

  propose(by: string, draft: PlanDraft): Plan {
    this.#assertCoordinator(by);
    const fields = this.#draft(draft);
    const goalId = this.#goalOf(draft.goalId);
    const free = this.#rules().autonomy === 'free';
    const plan = this.#d.plans.create({ ...fields, method: planMethod(draft.method), goalId, proposedBy: by });
    this.#emit(by, { type: 'plan.changed', change: 'proposed', plan });
    // Full autonomy (spec §6.2): the coordinator's plan starts now; the owner sees it and may stop it.
    if (!free) return plan;
    const started = this.#d.plans.update(plan.id, { status: 'approved', approvedAt: this.#now(), approvedBy: 'coordinator' });
    this.#emit(by, { type: 'plan.changed', change: 'approved', plan: started });
    return started;
  }

  revise(by: string, planId: string, draft: Partial<PlanDraft>): Plan {
    this.#assertCoordinator(by);
    const current = this.#d.plans.get(planId);
    if (current.status === 'declined') throw new ConflictError('Bu plandan vazgeçildi; yeni bir plan öner.');
    if (current.status === 'stopped') throw new ConflictError('Bu plan durduruldu; yeni bir plan öner.');
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
    const method = draft.method === undefined ? (current.method ?? null) : planMethod(draft.method);
    const free = this.#rules().autonomy === 'free';
    if (free) {
      // Full autonomy: the revision goes on at once, as the coordinator's.
      // A finished plan stays finished until it gets new work (a task reopens it): an empty "approved" would look running forever.
      const status = current.status === 'done' && this.#d.tasks.openInPlan(planId) === 0 ? 'done' : 'approved';
      const plan = this.#d.plans.update(planId, { ...merged, method, version: current.version + 1, status, approvedAt: current.approvedAt ?? this.#now(), approvedBy: 'coordinator' });
      this.#d.plans.clearApproved(planId);
      this.#emit(by, { type: 'plan.changed', change: 'revised', plan });
      return plan;
    }
    // A revision of an approved (or finished) plan is a new proposal: it waits for the owner again (rule B, big change).
    // Rule B: the approved version is kept until the owner decides on the revision (only the first revision saves it).
    if (current.status === 'approved' || current.status === 'done') this.#d.plans.saveApproved(planId);
    const plan = this.#d.plans.update(planId, { ...merged, method, version: current.version + 1, status: 'draft', approvedAt: null });
    this.#emit(by, { type: 'plan.changed', change: 'revised', plan });
    return plan;
  }

  approve(planId: string): Plan {
    const current = this.#d.plans.get(planId);
    if (current.status !== 'draft') throw new ConflictError('Yalnız taslak bir plan onaylanabilir.');
    const plan = this.#d.plans.update(planId, { status: 'approved', approvedAt: this.#now(), approvedBy: 'owner' });
    this.#d.plans.clearApproved(planId);
    const desk = this.#planDesk(plan);
    const next = this.#isBlueprint?.(plan.id) ? 'Bu bir kurulum planı: blueprintApply ile kur; yarıda kalırsa yeniden çalıştır, yapılmışı atlar.' : 'Görevleri aç ve dağıt.';
    this.#d.notices.add(desk, 'plan.approved', `Plan onaylandı: “${plan.title}” (sürüm ${plan.version}). ${next}`);
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
  /** The coordinator assesses a plan (spec §5.4): a note tagged retro; a method suggestion becomes its own note. */
  retro(by: string, planId: string, r: { wentWell: string; stuck: string; change: string; methodSuggestion?: string }): { retro: Note; suggestion: Note | null; kpiTable: string | null } {
    this.#assertCoordinator(by);
    const plan = this.#d.plans.get(planId);
    if (plan.status === 'draft' || plan.status === 'declined') throw new ConflictError('Bu plan başlamadı; değerlendirilecek bir iş yok.');
    const memory = this.#d.memory;
    if (!memory) throw new ConflictError('Bu ofiste şirket hafızası açık değil.');
    const wentWell = clean(r.wentWell, 'Ne iyi gitti', 3000, true);
    const stuck = clean(r.stuck, 'Ne takıldı', 3000, true);
    const change = clean(r.change, 'Bir dahaki sefere', 3000, true);
    const suggestionText = clean(r.methodSuggestion, 'Yöntem önerisi', 3000, false);
    const type = plan.method?.workType;
    const tags = (first: string) => (type ? [first, type] : [first]);
    // The goal's KPIs (B26), the office's read now: a plan with no goal or no KPIs is assessed as before.
    const kpiTable = this.#kpis?.retroTable(plan.goalId ?? null) ?? null;
    const kpiPart = kpiTable ? ['', "## KPI'lar", '', kpiTable] : [];
    const text = [`Plan: ${plan.title} (sürüm ${plan.version})`, '', '## Ne iyi gitti', '', wentWell, '', '## Ne takıldı', '', stuck, '', '## Bir dahaki sefere', '', change, ...kpiPart].join('\n');
    const retro = memory.writeNote(by, { title: `Değerlendirme: ${plan.title}`, text, tags: tags('retro'), source: `plan:${plan.id}` });
    const suggestion = suggestionText
      ? memory.writeNote(by, { title: `Yöntem önerisi (${type ?? 'general'}): ${plan.title}`, text: suggestionText, tags: tags('yöntem-önerisi'), source: `plan:${plan.id}` })
      : null;
    return { retro, suggestion, kpiTable };
  }

  // ── goals ─────────────────────────────────────────────────────────────────

  /** The coordinator opens, changes or closes a goal (spec §6.1). */
  goalSet(by: string, input: GoalInput): Goal {
    this.#assertCoordinator(by);
    const store = this.#goals();
    if (input.done !== undefined && !(Array.isArray(input.done) && input.done.every((d) => typeof d === 'string'))) {
      throw new ValidationError('Hedefin bitti tanımı (done) metinlerden oluşan bir liste olmalı.');
    }
    if (input.status !== undefined && !(GOAL_STATUSES as readonly string[]).includes(input.status)) throw new ValidationError('Hedef durumu active, done ya da dropped olmalı.');
    const status = input.status as GoalStatus | undefined;
    const kpis = input.kpis === undefined ? undefined : checkKpis(input.kpis);
    if (!input.goalId) {
      this.#assertGoalRoom();
      const goal = store.create({
        title: clean(input.title, 'Hedef başlığı', 160, true),
        why: clean(input.why, 'Neden (misyona bağı)', 2000, true),
        done: this.#goalDone(input.done),
        kpis: kpis ?? [],
        createdBy: by,
      });
      this.#d.state?.setRest(0, '');
      this.#emit(by, { type: 'goal.changed', change: 'set', goal });
      return goal;
    }
    const current = store.get(input.goalId);
    if (status === 'active' && current.status !== 'active') {
      if (this.#d.state?.get(`goal.ownerStopped.${current.id}`)) throw new ConflictError('Bu hedefi sahibi durdurdu; yeniden açılamaz. Gerekiyorsa sahibine sor ya da yeni bir hedef öner.');
      this.#assertGoalRoom();
    }
    const closing = status !== undefined && status !== 'active' && current.status === 'active';
    const goal = store.update(current.id, {
      title: input.title === undefined ? current.title : clean(input.title, 'Hedef başlığı', 160, true),
      why: input.why === undefined ? current.why : clean(input.why, 'Neden (misyona bağı)', 2000, true),
      done: input.done === undefined ? current.done : this.#goalDone(input.done),
      kpis: kpis ?? current.kpis,
      status: status ?? current.status,
      closedAt: closing ? this.#now() : status === 'active' ? null : current.closedAt,
      note: input.note === undefined ? current.note : clean(input.note, 'Not', 2000, false) || null,
    });
    this.#emit(by, { type: 'goal.changed', change: closing ? 'closed' : 'updated', goal });
    return goal;
  }

  /** Active goals first (oldest first), then the last 20 closed. */
  goals(): Goal[] {
    if (!this.#d.goals) return [];
    return [...this.#d.goals.list({ statuses: ['active'] }), ...this.#d.goals.list({ statuses: ['done', 'dropped'] }).slice(-20)];
  }

  #goals(): GoalStore {
    if (!this.#d.goals) throw new ConflictError('Bu ofiste hedefler açık değil.');
    return this.#d.goals;
  }

  #goalDone(done: string[] | undefined): string[] {
    const items = lines(done, 'Hedefin bitti tanımı', 12, 300);
    if (items.length === 0) throw new ValidationError('Hedefin en az bir maddelik bitti tanımı (done) olmalı: neye ulaşınca hedef tamam?');
    return items;
  }

  /** Checked before anything is written: one more active goal must fit the constitution's limit. */
  #assertGoalRoom(): void {
    const max = this.#rules().activeGoals;
    if (this.#goals().activeCount() >= max) throw new ConflictError(`En fazla ${max} aktif hedef olabilir; önce birini kapat (goalSet: status done ya da dropped).`);
  }

  /** The owner stops a running plan (spec §6.4): its open work is cancelled; it never starts again. */
  stopPlan(planId: string, o: { quiet?: boolean } = {}): Plan {
    const plan = this.#d.plans.get(planId);
    if (plan.status === 'stopped') throw new ConflictError('Bu plan zaten durduruldu.');
    if (plan.status !== 'approved' && plan.status !== 'draft') throw new ConflictError('Yalnız süren ya da onay bekleyen bir plan durdurulabilir.');
    const at = this.#now();
    for (const task of this.#d.tasks.list({ planId, statuses: ['waiting', 'in_progress', 'review', 'blocked', 'parked'] })) {
      const holder = this.#person(task.assignee);
      if (holder && holder.lifecycle !== 'archived' && (task.status === 'in_progress' || task.status === 'blocked')) {
        this.#d.notices.add(holder.id, 'task.cancelled', `“${task.title}” görevi (no ${task.id}) iptal edildi: sahibi “${plan.title}” planını durdurdu. Üzerinde çalışmayı bırak.`);
      }
      this.#taskEvent('updated', this.#d.tasks.update(task.id, { status: 'cancelled', finishedAt: at, ...this.#leaveParked(task) }));
    }
    // Its routines stop with it (spec §4.4) — without #planMayFinish: a stopped plan is stopped, never done.
    for (const sch of this.#d.schedules?.list({ planId, statuses: ['active', 'paused'] }) ?? []) this.#applyScheduleStatus(sch, 'stopped', OWNER);
    this.#d.plans.clearApproved(planId);
    const stopped = this.#d.plans.update(planId, { status: 'stopped' });
    const desk = this.#planDesk(stopped);
    if (!o.quiet) {
      this.#d.notices.add(desk, 'plan.stopped', `Sahibi “${plan.title}” planını durdurdu; açık görevleri iptal edildi. Durdurulan plan yeniden başlamaz; gerekiyorsa yeni bir plan öner.`);
    }
    this.#emit(desk, { type: 'plan.changed', change: 'stopped', plan: stopped });
    return stopped;
  }

  /** The owner stops a goal: it is dropped and its running plans stop (one notice for all). */
  stopGoal(goalId: string): Goal {
    const store = this.#goals();
    const current = store.get(goalId);
    if (current.status !== 'active') throw new ConflictError('Bu hedef zaten kapalı.');
    const running = this.#d.plans.list(1000).filter((p) => p.goalId === goalId && (p.status === 'approved' || p.status === 'draft'));
    for (const p of running) this.stopPlan(p.id, { quiet: true });
    const goal = store.update(goalId, { status: 'dropped', closedAt: this.#now(), note: 'Sahibi durdurdu' });
    // The owner's word is final (spec §2): the coordinator cannot reopen this goal.
    this.#d.state?.set(`goal.ownerStopped.${goalId}`, '1');
    const c = this.coordinator();
    const plansLine = running.length ? ` Süren planları da durdu: ${running.map((p) => `“${p.title}”`).join(', ')}.` : '';
    if (c) this.#d.notices.add(c.id, 'goal.stopped', `Sahibi “${goal.title}” hedefini durdurdu.${plansLine} Bu hedef için iş açma; gerekiyorsa sahibine sor.`);
    this.#emit(c?.id ?? goal.createdBy, { type: 'goal.changed', change: 'stopped', goal });
    return goal;
  }

  /** Nothing worth doing now (spec §6.3): the "no goal" pulse waits until then. Returns the time it ends. */
  restUntil(by: string, hours: number, reason: string): number {
    this.#assertCoordinator(by);
    if (!Number.isFinite(hours) || hours < 1 || hours > 168) throw new ValidationError('Dinlenme süresi 1 ile 168 saat arasında olmalı.');
    const why = clean(reason, 'Gerekçe', 1000, true);
    const until = this.#now() + Math.round(hours * 60 * 60_000);
    this.#state().setRest(until, why);
    return until;
  }

  /** The owner pauses the whole company (spec §6.4): nothing is handed out until resume. */
  pause(): void {
    this.#state().setPaused(true);
    this.#emit(this.coordinator()?.id ?? null, { type: 'company.paused', paused: true });
  }

  resume(): void {
    this.#state().setPaused(false);
    this.#emit(this.coordinator()?.id ?? null, { type: 'company.paused', paused: false });
    // The clock re-arms for the nearest time. A routine that fell due while paused is already past, which nextDueAt does
    // not count: it runs at the clock's next run, within the safety tick.
    this.#touchClock();
  }

  paused(): boolean {
    return this.#d.state?.paused() ?? false;
  }

  #state(): CompanyStateStore {
    if (!this.#d.state) throw new ConflictError('Bu ofiste şirket durumu açık değil.');
    return this.#d.state;
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

  // ── profile ───────────────────────────────────────────────────────────────

  /** Each section's current state (spec 2026-10-08-company-profile-design). */
  profile(): CompanyProfile {
    return this.#d.profile?.current() ?? { version: 0, sections: {} };
  }

  profileHistory(section: unknown): ProfileEntry[] {
    return this.#profile().history(profileSection(section));
  }

  /**
   * The coordinator writes one section: the given fields merged into it, under the next version, each marked an
   * assumption or the owner's word as `assumed` says (required: no silent default). Returns the section as it stands;
   * when nothing changes no version is opened and the current entry comes back. The brief is not touched.
   */
  profileUpdate(by: string, input: ProfileInput): ProfileEntry {
    this.#assertCoordinator(by);
    const section = profileSection(input.section);
    if (input.assumed === undefined) throw new ValidationError('assumed gerekli: bu alanlar sahibinden mi (false), varsayım mı (true)?');
    if (typeof input.assumed !== 'boolean') throw new ValidationError('assumed true ya da false olmalı.');
    return this.#writeProfile(by, [[section, input.fields]], input.assumed)[0]!;
  }

  /**
   * Sections written together: every patch merged and checked before any is written. A section whose fields and marks
   * stay as they are opens no version (its current entry comes back).
   */
  #writeProfile(by: string, patches: Array<[ProfileSection, unknown]>, assumed: boolean): ProfileEntry[] {
    const store = this.#profile();
    const now = store.current();
    const merged = patches.map(([section, patch]) => {
      const current = now.sections[section];
      const next = mergeProfile(section, current ?? { fields: {}, assumedFields: [] }, patch, assumed);
      const same = current !== undefined && JSON.stringify([current.fields, current.assumedFields]) === JSON.stringify([next.fields, next.assumedFields]);
      if (!current && Object.keys(next.fields).length === 0) throw new ValidationError(`${PROFILE_SPEC[section].label} bölümü boş; yazacak bir alan ver.`);
      return { section, current, next, same };
    });
    return merged.map(({ section, current, next, same }) => {
      if (same) return current!;
      const entry = store.write(section, next.fields, next.assumedFields, by);
      this.#emit(by === OWNER ? null : by, { type: 'profile.updated', entry });
      return entry;
    });
  }

  #profile(): ProfileStore {
    if (!this.#d.profile) throw new ConflictError('Bu ofiste şirket profili açık değil.');
    return this.#d.profile;
  }

  // ── onboarding ────────────────────────────────────────────────────────────

  /** The running (else the last) onboarding and every question's state from the profile (spec 2026-10-08-onboarding-design). */
  onboarding(): OnboardingView {
    return onboardingView(this.profile(), this.#d.onboarding?.latest() ?? null);
  }

  /** The owner said what the company does: the sentence is their word in the profile, and the dialog opens. */
  onboardingStart(by: string, description: string): Onboarding {
    this.#assertCoordinator(by);
    const store = this.#onboarding();
    if (store.active()) throw new ConflictError('Bir onboarding zaten sürüyor: onboardingNext ile devam et, zorunlular dolunca onboardingFinish.');
    const sentence = clean(description, 'İş tarifi', 1000, true);
    this.#writeProfile(by, [['identity', { summary: sentence }]], false);
    const started = store.create(sentence, by);
    this.#emit(by, { type: 'onboarding.changed', change: 'started', onboarding: started });
    return started;
  }

  /**
   * The next block of questions, recorded as a round, and the questions to fill by assumption. While the last round
   * has no reply from the owner it comes back as it is (`waiting`) and nothing is recorded: showing a block again is
   * not asking it twice (review, Kerem round 1).
   */
  onboardingNext(by: string, o: { optional?: boolean } = {}): OnboardingPlan {
    this.#assertCoordinator(by);
    const active = this.#activeOnboarding();
    const plan = this.#onboardingPlan(active, o.optional === true);
    if (plan.waiting || plan.ask.length === 0) return plan;
    const round: OnboardingRound = { round: active.rounds.length + 1, questions: plan.ask.map((q) => q.id), askedAt: this.#now(), replied: false };
    const announced = this.#emit(by, { type: 'onboarding.changed', change: 'round', onboarding: { ...active, rounds: [...active.rounds, round] }, round });
    this.#onboarding().addRound(active.id, round, announced.seq);
    return { ...plan, round, view: this.onboarding() };
  }

  /** What onboardingNext would give, recording nothing (onboardingRead). */
  onboardingPeek(by: string, o: { optional?: boolean } = {}): OnboardingPlan {
    this.#assertCoordinator(by);
    return this.#onboardingPlan(this.#activeOnboarding(), o.optional === true);
  }

  #onboardingPlan(active: Onboarding, optional: boolean): OnboardingPlan {
    const view = onboardingView(this.profile(), active);
    const block = nextBlock(view, optional);
    const last = active.rounds.at(-1);
    if (last && !last.replied) {
      const ask = view.questions.filter((v) => last.questions.includes(v.id) && v.state !== 'answered');
      if (ask.length > 0) return { round: last, ask, assume: block.assume, complete: view.complete, view, waiting: true };
    }
    return { round: null, ...block, complete: view.complete, view, waiting: false };
  }

  /** The owner answers questions directly (API): every answer checked first, then written as their own word; the coordinator hears. */
  onboardingAnswer(answers: unknown): OnboardingView {
    const active = this.#activeOnboarding();
    const { ids, patches } = answerPatches(answers);
    this.#writeProfile(OWNER, [...patches], false);
    const coordinator = this.coordinator();
    if (coordinator) this.#d.notices.add(coordinator.id, 'onboarding.answered', `Sahibi onboarding sorularını cevapladı: ${ids.join(', ')}. onboardingNext ile devam et.`);
    // This event is the owner's reply to the round asked before it: the view is read after it.
    this.#emit(coordinator?.id ?? null, { type: 'onboarding.changed', change: 'answered', onboarding: active });
    return this.onboarding();
  }

  /** Ends the onboarding once no required question is open (KÖ1's "profile complete" event). */
  onboardingFinish(by: string): OnboardingView {
    this.#assertCoordinator(by);
    const active = this.#activeOnboarding();
    const open = onboardingView(this.profile(), active).questions.filter((v) => v.required && v.state === 'open').map((v) => v.id);
    if (open.length) throw new ValidationError(`Zorunlu sorular cevapsız: ${open.join(', ')}. onboardingNext ile sor ya da varsayımla doldur (profileUpdate, assumed: true).`);
    const done = this.#onboarding().finish(active.id);
    this.#emit(by, { type: 'onboarding.changed', change: 'finished', onboarding: done });
    return onboardingView(this.profile(), done);
  }

  #onboarding(): OnboardingStore {
    if (!this.#d.onboarding) throw new ConflictError('Bu ofiste onboarding açık değil.');
    return this.#d.onboarding;
  }

  #activeOnboarding(): Onboarding {
    const active = this.#onboarding().active();
    if (!active) throw new ConflictError('Sürmekte olan bir onboarding yok: sahibi işini anlatınca onboardingStart ile başla.');
    return active;
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
    // A live routine is open work too: its plan runs while the routine does (spec §4.4).
    if (this.#d.schedules?.list({ planId, statuses: ['active', 'paused'], limit: 1 }).length) return;
    const done = this.#d.plans.update(planId, { status: 'done' });
    const desk = this.#planDesk(done);
    this.#d.notices.add(
      desk,
      'plan.retro',
      `“${plan.title}” planının açık görevi kalmadı. İş bittiyse planRetro ile değerlendir (ne iyi gitti, ne takıldı, ne değişecek; her şirkete yarayacak bir yöntem önerin varsa methodSuggestion), şirkete özgü dersi playbookUpdate ile el kitabına yaz ve reportToOwner ile sahibine kısaca raporla. Sürüyorsa bu plana yeni görev açabilirsin (plan yeniden açılır).`,
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

  /** A plan names an active goal, or none. */
  #goalOf(id: string | null | undefined): string | null {
    if (id === undefined || id === null || id === '') return null;
    const goal = this.#goals().get(id);
    if (goal.status !== 'active') throw new ConflictError(`“${goal.title}” hedefi aktif değil; plana aktif bir hedef ver ya da hedefsiz öner.`);
    return goal.id;
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

  #taskEvent(change: TaskChange, task: Task): void {
    this.#emit(task.assignee, { type: 'task.changed', change, task });
  }

  #emit(employeeId: string | null, event: OfficeEvent): StoredEvent {
    return this.#d.events.append(employeeId, event);
  }
}
