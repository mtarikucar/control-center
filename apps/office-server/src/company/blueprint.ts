import {
  COVERAGE_STATUS_LABELS, kpiText, MODEL_ALIASES, TASK_DIFFICULTIES,
  type Blueprint, type BlueprintApplyReport, type BlueprintGoal, type BlueprintOutcome, type BlueprintRole, type BlueprintRoutine, type BlueprintStepResult,
  type BlueprintTask, type BlueprintView, type ClosedModeCheck, type Constitution, type Employee, type Integration, type ModelAlias, type Plan, type TaskDifficulty,
} from '@cc/shared';
import { mcpToolPrefix } from '../claude/normalize.ts';
import { ConflictError, NotFoundError, ValidationError } from '../errors.ts';
import type { Roster } from '../roster.ts';
import type { BlueprintStore } from './blueprint-store.ts';
import { capability, capabilityIds, capabilityVocabulary, coverage } from './capabilities.ts';
import type { Company, PlanDraft } from './company.ts';
import type { IntegrationRegistry } from './integrations.ts';
import { checkKpis } from './kpi.ts';
import type { Memory } from './memory.ts';
import { roleTemplate } from './role-templates.ts';
import type { PlanStore, ScheduleStore, TaskStore } from './store.ts';
import { clean, lines } from './text.ts';
import { cronLabel, minIntervalMinutes, parseCron } from './time.ts';

/**
 * The blueprint (B5; spec 2026-10-08-blueprint-design): the coordinator writes it from the profile; the office checks
 * it, shows it on a plan card, and once approved installs it step by step. A step is done when its record exists or
 * what it would make already exists by its natural key; a done step is never written again.
 */

const KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const COORDINATOR = 'coordinator';
/** A plan card holds at most 40 draft steps. */
const MAX_STEPS = 40;
const FIELDS = ['title', 'summary', 'brief', 'roles', 'playbook', 'goals', 'routines', 'tasks', 'closedMode', 'estimates', 'risks'];
const METHOD = {
  workType: 'operations',
  stages: [
    { name: 'Blueprint', role: 'Koordinatör', review: false },
    { name: 'Onay', role: 'Sahibi', review: true },
    { name: 'Kurulum (blueprintApply)', role: 'Koordinatör', review: false },
    { name: 'Doğrulama (blueprintRead)', role: 'Koordinatör', review: true },
  ],
  checks: ['İkinci çalıştırma hiçbir şey eklemez: her adımın kaydı tutulur.', 'Kapalı kip varsa masaların son oturumunda listeyle doğrulanır; hiçbir araç denenmez.'],
};
const RESULT_TR: Record<BlueprintStepResult, string> = {
  done: 'yapıldı', adopted: 'var olan kullanıldı', skipped: 'zaten yapılmıştı', failed: 'HATA', pending: 'yapılmadı (önceki adım durdu)',
};
const STATE_TR: Record<BlueprintView['steps'][number]['state'], string> = { pending: 'bekliyor', done: 'yapıldı', adopted: 'var olan kullanıldı', removed: "blueprint'te artık yok" };
const CHECK_TR: Record<ClosedModeCheck, string> = {
  verified: 'doğrulandı (oturumun araç listesinde yok)', open: 'TUTMADI (oturumda araçları var)', not_connected: 'sunucu bu masada bağlı değil (aracı yok)',
  no_session: 'henüz oturum yok', unverifiable: 'listeyle doğrulanamaz (çağrı anında reddedilir)',
  unknown: 'tanınmıyor: hiçbir oturumda ya da sözlükte görülmedi, kural bir şey kapatmıyor olabilir',
};

const lower = (s: string) => s.toLocaleLowerCase('tr').trim();
const record = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const fit = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

export interface BlueprintDeps {
  company: Company;
  roster: Roster;
  tasks: TaskStore;
  plans: PlanStore;
  schedules: ScheduleStore;
  memory: Memory;
  store: BlueprintStore;
  constitution: () => Constitution;
  /** The registry (B3): capability status on the card, the closed mode's check. */
  integrations?: IntegrationRegistry;
  now?: () => number;
}

/** One install step: its key, its label, and what it makes (or finds already made). */
interface Step {
  step: string;
  label: string;
  /** What already exists by the step's natural key, if anything. */
  existing: () => string | null;
  make: () => string | null;
}

export class Blueprints {
  readonly #d: BlueprintDeps;

  constructor(d: BlueprintDeps) {
    this.#d = d;
    // The approval notice tells the coordinator an install plan is installed with blueprintApply.
    d.company.attachBlueprints((planId) => d.store.get(planId) !== null);
  }

  /** Checks the blueprint and shows it to the owner as a plan card (with planId: as that plan's revision). */
  propose(by: string, input: unknown, o: { planId?: string; goalId?: string } = {}): { plan: Plan; blueprint: Blueprint } {
    const view = this.#d.company.onboarding();
    if (!view.complete) {
      const open = view.questions.filter((q) => q.required && q.state === 'open').map((q) => q.text);
      throw new ConflictError(`Önce şirketin işini öğren (onboardingStart, onboardingNext): blueprint şirket profiline dayanır; zorunlu sorular açık: ${open.join(' ')}`);
    }
    const blueprint = parseBlueprint(input);
    checkRoutines(blueprint, this.#d.constitution(), (this.#d.now ?? Date.now)());
    if (o.planId !== undefined && !this.#d.store.get(o.planId)) throw new ConflictError("Bu planın blueprint'i yok; blueprintPropose ile yeni bir kurulum planı öner.");
    this.#assertRoom(blueprint, o.planId ?? null);
    const card = this.#card(blueprint, o.planId ?? null);
    const plan = o.planId === undefined ? this.#d.company.propose(by, { ...card, goalId: o.goalId ?? null }) : this.#d.company.revise(by, o.planId, card);
    this.#d.store.put(plan.id, blueprint, this.#d.company.profile().version, by);
    return { plan, blueprint };
  }

  /** Installs an approved plan's blueprint, step by step; stops at the first failure; a done step is skipped. */
  apply(by: string, planId: string): BlueprintApplyReport {
    const plan = this.#d.plans.get(planId);
    const stored = this.#d.store.get(planId);
    if (!stored) throw new NotFoundError(`“${plan.title}” planının blueprint'i yok.`);
    if (plan.status !== 'approved' && plan.status !== 'done') throw new ConflictError('Plan onaylı değil: kurulum sahibinin onayından (ya da tam serbestlikten) sonra yapılır.');
    const records = new Map(this.#d.store.steps(planId).map((r) => [r.step, r]));
    const refs = new Map<string, string>();
    const report: BlueprintApplyReport = { planId, title: plan.title, finished: true, steps: [] };
    let failed = false;
    for (const s of this.#steps(by, plan, stored.blueprint, refs)) {
      const known = records.get(s.step);
      if (failed) {
        report.steps.push({ step: s.step, label: s.label, result: 'pending', ref: null, error: null, note: null });
        continue;
      }
      if (known) {
        this.#remember(s.step, known.ref, refs);
        // A role's employee let go since: not hired back (spec §3); steps that would give it new work say what to do.
        const gone = s.step.startsWith('role:') && known.ref ? this.#d.roster.get(known.ref) : null;
        const note = gone?.lifecycle === 'archived' ? `çalışanı işten çıkarıldı (${gone.name})` : null;
        report.steps.push({ step: s.step, label: s.label, result: 'skipped', ref: known.ref, error: null, note });
        continue;
      }
      try {
        const found = s.existing();
        const outcome: BlueprintOutcome = found !== null ? 'adopted' : 'done';
        const ref = found ?? s.make();
        this.#d.store.record(planId, s.step, ref, outcome);
        this.#remember(s.step, ref, refs);
        report.steps.push({ step: s.step, label: s.label, result: outcome, ref, error: null, note: null });
      } catch (err) {
        failed = true;
        report.finished = false;
        report.steps.push({ step: s.step, label: s.label, result: 'failed', ref: null, error: err instanceof Error ? err.message : String(err), note: null });
      }
    }
    return report;
  }

  /** The blueprint, how far its install went, and its closed mode as each desk's latest session shows it (read only). */
  read(planId: string): BlueprintView {
    const plan = this.#d.plans.get(planId);
    const stored = this.#d.store.get(planId);
    if (!stored) throw new NotFoundError(`“${plan.title}” planının blueprint'i yok.`);
    const { blueprint } = stored;
    const records = new Map(this.#d.store.steps(planId).map((r) => [r.step, r]));
    const planned = stepKeys(blueprint);
    const steps: BlueprintView['steps'] = [
      ...planned.map(({ step, label }) => ({ step, label, state: records.get(step)?.outcome ?? ('pending' as const), ref: records.get(step)?.ref ?? null })),
      ...[...records.values()].filter((r) => !planned.some((p) => p.step === r.step)).map((r) => ({ step: r.step, label: labelOf(r.step), state: 'removed' as const, ref: r.ref })),
    ];
    const registry = this.#d.integrations?.list() ?? [];
    const closedMode: BlueprintView['closedMode'] = [];
    if (blueprint.closedMode) {
      for (const role of blueprint.roles) {
        const rec = records.get(`role:${role.key}`);
        if (!rec?.ref) continue;
        const employee = this.#d.roster.get(rec.ref);
        closedMode.push({
          key: role.key, employeeId: employee.id, name: employee.name, applied: rec.outcome === 'done',
          rules: blueprint.closedMode.deny.map((rule) => ({ rule, check: closedCheck(registry, employee.id, rule) })),
        });
      }
    }
    return { planId, blueprint, profileVersion: stored.profileVersion, profileNow: this.#d.company.profile().version, steps, closedMode };
  }

  /** In install order: brief, playbook, roles, goals, routines, tasks (spec §3). */
  #steps(by: string, plan: Plan, b: Blueprint, refs: Map<string, string>): Step[] {
    const company = this.#d.company;
    const who = (key: string): string => {
      if (key === COORDINATOR) {
        const c = company.coordinator();
        if (!c) throw new ConflictError('Ofiste koordinatör yok.');
        return c.id;
      }
      const id = refs.get(key);
      if (!id) throw new ConflictError(`“${key}” rolünün çalışanı yok.`);
      const e = this.#d.roster.get(id);
      if (e.lifecycle === 'archived') {
        throw new ConflictError(`“${key}” rolünün çalışanı ${e.name} işten çıkarıldı; kurulum işten çıkarılanı geri almaz: revizyonda bu role yeni bir anahtar ver (yeni biri işe alınır) ya da adımı başka bir role bağla.`);
      }
      return id;
    };
    const keys = stepKeys(b);
    const label = (step: string) => keys.find((k) => k.step === step)!.label;
    const steps: Step[] = [];
    const brief = b.brief;
    if (brief !== null) {
      steps.push({ step: 'brief', label: label('brief'), existing: () => (company.brief().trim() === brief.trim() ? 'brief' : null), make: () => (company.updateBrief(by, brief), 'brief') });
    }
    for (const p of b.playbook) {
      const step = `playbook:${p.topic}`;
      steps.push({
        step, label: label(step),
        existing: () => this.#d.memory.playbookTopics().find((x) => lower(x.topic) === lower(p.topic))?.topic ?? null,
        make: () => this.#d.memory.updatePlaybook(by, { topic: p.topic, text: p.text, reason: `Blueprint: ${plan.title}` }).topic,
      });
    }
    for (const r of b.roles) {
      const step = `role:${r.key}`;
      steps.push({
        step, label: label(step),
        existing: () => this.#employeeNamed(r.name)?.id ?? null,
        make: () =>
          company.hire(by, { name: r.name, template: r.template, role: r.role ?? '', title: r.title, team: r.team, model: r.model, capabilities: r.capabilities }, { deny: b.closedMode?.deny }).id,
      });
    }
    for (const g of b.goals) {
      const step = `goal:${g.key}`;
      steps.push({
        step, label: label(step),
        existing: () => company.goals().find((x) => x.status === 'active' && lower(x.title) === lower(g.title))?.id ?? null,
        make: () => company.goalSet(by, { title: g.title, why: g.why, done: g.done, kpis: g.kpis }).id,
      });
    }
    for (const r of b.routines) {
      const step = `routine:${r.key}`;
      steps.push({
        step, label: label(step),
        existing: () => this.#d.schedules.list({ planId: plan.id, statuses: ['active', 'paused'] }).find((x) => lower(x.title) === lower(r.title) && x.assignee === who(r.role))?.id ?? null,
        make: () =>
          company.createSchedule(by, {
            title: r.title, description: r.description, done: r.done, assignee: who(r.role), reviewer: r.reviewer === null ? null : who(r.reviewer), cron: r.cron, planId: plan.id, difficulty: r.difficulty,
          }).id,
      });
    }
    for (const t of b.tasks) {
      const step = `task:${t.key}`;
      steps.push({
        step, label: label(step),
        existing: () => this.#d.tasks.list({ planId: plan.id }).find((x) => lower(x.title) === lower(t.title))?.id ?? null,
        make: () =>
          company.createTask(by, {
            assignee: who(t.role), title: t.title, description: t.description, done: t.done, planId: plan.id, reviewer: t.reviewer === null ? null : who(t.reviewer),
            requires: t.requires, difficulty: t.difficulty, priority: t.priority,
          }).id,
      });
    }
    return steps;
  }

  #remember(step: string, ref: string | null, refs: Map<string, string>): void {
    if (step.startsWith('role:') && ref) refs.set(step.slice('role:'.length), ref);
  }

  /** A current employee by name (case and Turkish dotted/dotless i insensitive). */
  #employeeNamed(name: string): Employee | undefined {
    return this.#d.roster.list().find((e) => lower(e.name) === lower(name));
  }

  /** The constitution's limits, counting only what the install would make (what exists is adopted). */
  #assertRoom(b: Blueprint, planId: string | null): void {
    const rules = this.#d.constitution();
    const hires = b.roles.filter((r) => !this.#employeeNamed(r.name)).length;
    const free = rules.maxEmployees - this.#d.roster.list().length;
    if (hires > free) throw new ConflictError(`Kurulum ${hires} kişi işe alacak; ofiste ${Math.max(0, free)} boş yer var (anayasa en fazla ${rules.maxEmployees} çalışan). Rolleri azalt ya da sahibine getir.`);
    const goals = this.#d.company.goals();
    const newGoals = b.goals.filter((g) => !goals.some((x) => x.status === 'active' && lower(x.title) === lower(g.title))).length;
    const activeGoals = goals.filter((g) => g.status === 'active').length;
    if (activeGoals + newGoals > rules.activeGoals) throw new ConflictError(`Kurulum ${newGoals} hedef açacak; aktif hedef sınırına ${Math.max(0, rules.activeGoals - activeGoals)} yer var.`);
    // A revision: what the install already made (recorded, or there by its natural key) is not counted again.
    const done = new Set(planId ? this.#d.store.steps(planId).map((r) => r.step) : []);
    const inPlan = planId ? this.#d.schedules.list({ planId, statuses: ['active', 'paused'] }) : [];
    const newRoutines = b.routines.filter((r) => !done.has(`routine:${r.key}`) && !inPlan.some((x) => lower(x.title) === lower(r.title))).length;
    const active = this.#d.schedules.list({ statuses: ['active', 'paused'] }).length;
    if (active + newRoutines > rules.maxSchedules) throw new ConflictError(`Kurulum ${newRoutines} rutin açacak; rutin sınırına ${Math.max(0, rules.maxSchedules - active)} yer var.`);
    const tasks = planId ? this.#d.tasks.list({ planId }) : [];
    const newTasks = b.tasks.filter((t) => !done.has(`task:${t.key}`) && !tasks.some((x) => lower(x.title) === lower(t.title))).length;
    const open = planId ? this.#d.tasks.openInPlan(planId) : 0;
    if (open + newTasks > rules.openTasksPerPlan) throw new ConflictError(`Kurulum ${newTasks} görev açacak; plan başına en fazla ${rules.openTasksPerPlan} açık görev olabilir.`);
  }

  /** The plan card the owner sees: the blueprint's own words, and what the office reads from B3, B6 and B7. */
  #card(b: Blueprint, planId: string | null): PlanDraft {
    const registry = this.#d.integrations?.list() ?? [];
    const name = (key: string) => (key === COORDINATOR ? 'Koordinatör' : b.roles.find((r) => r.key === key)!.name);
    const titleOf = (r: BlueprintRole) => r.title ?? (r.template ? roleTemplate(r.template).title : '');
    const modelOf = (r: BlueprintRole) => r.model ?? (r.template ? roleTemplate(r.template).model : 'sonnet');
    const capsOf = (r: BlueprintRole) => r.capabilities ?? (r.template ? roleTemplate(r.template).capabilities : []);
    const people = b.roles.map((r) => `${r.name}${titleOf(r) ? ` — ${titleOf(r)}` : ''} (${r.template ? `şablon ${r.template}, ` : ''}${modelOf(r)})`);
    const steps = stepKeys(b).map(({ step, label }) => {
      const [kind, key] = [step.slice(0, step.indexOf(':')), step.slice(step.indexOf(':') + 1)];
      if (step === 'brief') return `${label}: yazılır (${b.brief!.length} karakter)`;
      if (kind === 'role') {
        const r = b.roles.find((x) => x.key === key)!;
        const caps = coverage(registry, capsOf(r));
        const detail = `${people[b.roles.indexOf(r)]!.slice(r.name.length)}${caps.length ? `; yetenekler: ${caps.map((c) => `${c.id} [${COVERAGE_STATUS_LABELS[c.status]}]`).join(', ')}` : ''}`;
        return fit(`${label}${detail}`, 300);
      }
      if (kind === 'goal') {
        const g = b.goals.find((x) => x.key === key)!;
        return fit(`${label}${g.kpis.length ? ` — KPI: ${g.kpis.map(kpiText).join('; ')}` : ''}`, 300);
      }
      if (kind === 'routine') {
        const r = b.routines.find((x) => x.key === key)!;
        return fit(`${label} → ${name(r.role)}${r.reviewer ? `, inceleyen ${name(r.reviewer)}` : ''} (${cronLabel(parseCron(r.cron))})`, 300);
      }
      if (kind === 'task') {
        const t = b.tasks.find((x) => x.key === key)!;
        return fit(`${label} → ${name(t.role)}${t.reviewer ? `, inceleyen ${name(t.reviewer)}` : ''}${t.requires.length ? `; gereken: ${t.requires.join(', ')}` : ''}`, 300);
      }
      return fit(label, 300);
    });
    // What the owner should see before approving: what exists already, what is not open, what goes outward.
    const lacking = b.roles.flatMap((r) => coverage(registry, capsOf(r)).filter((c) => c.status === 'shut' || c.status === 'missing').map((c) => `${c.id} (${r.name})`));
    const outward = b.roles.flatMap((r) => capsOf(r).filter((c) => capability(c).outward).map((c) => `${c} (${r.name})`));
    const unknownRules = (b.closedMode?.deny ?? []).filter((rule) => !knownRule(registry, rule));
    const records = planId ? this.#d.store.steps(planId) : [];
    const gone = records.flatMap((r) => {
      if (!r.step.startsWith('role:') || !r.ref) return [];
      const e = this.#d.roster.get(r.ref);
      return e.lifecycle === 'archived' ? [`${r.step.slice('role:'.length)} (${e.name})`] : [];
    });
    const adopted = [
      ...b.roles.filter((r) => this.#employeeNamed(r.name) && !records.some((x) => x.step === `role:${r.key}`)).map((r) => `${r.name} (çalışan)`),
      ...b.playbook.filter((p) => this.#d.memory.playbookTopics().some((x) => lower(x.topic) === lower(p.topic))).map((p) => `“${p.topic}” (el kitabı)`),
      ...b.goals.filter((g) => this.#d.company.goals().some((x) => x.status === 'active' && lower(x.title) === lower(g.title))).map((g) => `“${g.title}” (hedef)`),
    ];
    const risks = [
      b.risks,
      adopted.length ? `Var olan kullanılacak: ${adopted.join(', ')}` : '',
      lacking.length ? `Açık olmayan yetenekler: ${lacking.join(', ')}` : '',
      outward.length ? `Dışa dönük yetenekler (B9’a kadar yalnız metinle korunur): ${outward.join(', ')}` : '',
      b.closedMode ? `Kapalı kip: ${b.closedMode.deny.length} kural, her yeni masaya ilk oturumdan önce yazılır; B9’a kadar çalışan kendi masasındaki kuralı kaldırabilir, blueprintRead bunu bir sonraki oturumda “TUTMADI” diye gösterir` : '',
      unknownRules.length ? `Kapalı kipte tanınmayan ad: ${unknownRules.join(', ')} — hiçbir oturumda ya da sözlükte görülmedi; kural bir şey kapatmıyor olabilir, adı denetle` : '',
      gone.length ? `Çalışanı işten çıkarılmış rol: ${gone.join(', ')} — kurulum onu geri almaz; ona yeni iş verecek adımlar kurulamaz, rolü yeni bir anahtarla yaz` : '',
    ].filter(Boolean);
    const counts = `${b.roles.length} rol, ${b.playbook.length} el kitabı konusu, ${b.goals.length} hedef, ${b.routines.length} rutin, ${b.tasks.length} görev${b.closedMode ? `; kapalı kip: ${b.closedMode.deny.length} kural` : ''}`;
    return {
      title: b.title,
      goal: b.summary,
      approach: `Kurulum planı (blueprint): ${counts}. Onaydan sonra koordinatör blueprintApply ile kurar; her adımın kaydı tutulur, yarıda kalırsa yeniden çalıştırılır ve yapılmışı atlar. Dayanak: şirket profili sürüm ${this.#d.company.profile().version}${planId ? ' (revizyon)' : ''}.`,
      people: people.join('\n'),
      steps,
      quotaPct: b.estimates.quotaPct,
      usd: b.estimates.usd,
      days: b.estimates.days,
      risks: fit(risks.join('\n'), 2000),
      method: METHOD,
    };
  }
}

/** Every step's key and label, in install order. */
function stepKeys(b: Blueprint): Array<{ step: string; label: string }> {
  return [
    ...(b.brief !== null ? [{ step: 'brief', label: 'Şirket özeti' }] : []),
    ...b.playbook.map((p) => ({ step: `playbook:${p.topic}`, label: `El kitabı: ${p.topic}` })),
    ...b.roles.map((r) => ({ step: `role:${r.key}`, label: `İşe al: ${r.name}` })),
    ...b.goals.map((g) => ({ step: `goal:${g.key}`, label: `Hedef: ${g.title}` })),
    ...b.routines.map((r) => ({ step: `routine:${r.key}`, label: `Rutin: ${r.title}` })),
    ...b.tasks.map((t) => ({ step: `task:${t.key}`, label: `Görev: ${t.title}` })),
  ];
}

/** A recorded step the blueprint no longer has: a label from its key alone. */
function labelOf(step: string): string {
  const [kind, key] = [step.slice(0, step.indexOf(':')), step.slice(step.indexOf(':') + 1)];
  const tr: Record<string, string> = { playbook: 'El kitabı', role: 'Rol', goal: 'Hedef', routine: 'Rutin', task: 'Görev' };
  return step === 'brief' ? 'Şirket özeti' : `${tr[kind] ?? kind}: ${key}`;
}

/**
 * A connector rule names something the office has seen: a server some session reported or the vocabulary names, and
 * — for a tool rule — a tool some current desk's session listed or the vocabulary names (review round 1).
 */
function knownRule(registry: Integration[], rule: string): boolean {
  const m = /^mcp__([A-Za-z0-9_-]+?)(?:__(.+))?$/.exec(rule);
  if (!m) return true;
  const prefix = `mcp__${m[1]}__`;
  const vocabulary = capabilityVocabulary().capabilities.flatMap((c) => c.tools);
  if (m[2] === undefined) return registry.some((i) => mcpToolPrefix(i.name) === prefix) || vocabulary.some((t) => t.startsWith(prefix));
  return vocabulary.includes(rule) || registry.some((i) => i.desks.some((d) => d.toolNames?.includes(rule)));
}

/** One deny rule on one desk, from its latest session as the registry reads it (spec §4). */
function closedCheck(registry: Integration[], employeeId: string, rule: string): ClosedModeCheck {
  const m = /^mcp__([A-Za-z0-9_-]+?)(?:__(.+))?$/.exec(rule);
  if (!m) return 'unverifiable';
  if (!knownRule(registry, rule)) return 'unknown';
  if (!registry.some((i) => i.desks.some((d) => d.employeeId === employeeId))) return 'no_session';
  const prefix = `mcp__${m[1]}__`;
  const desk = registry.find((i) => mcpToolPrefix(i.name) === prefix)?.desks.find((d) => d.employeeId === employeeId);
  if (!desk) return 'not_connected';
  if (desk.status === 'denied') return 'verified';
  if (desk.status !== 'connected') return 'not_connected';
  if (m[2] === undefined) return 'open';
  return desk.toolNames !== null && !desk.toolNames.includes(rule) ? 'verified' : 'open';
}

/** The blueprint as given, checked (spec §2): every refusal says what is wrong and writes nothing. */
export function parseBlueprint(value: unknown): Blueprint {
  const fail = (why: string) => new ValidationError(`Blueprint: ${why}`);
  const v = record(value);
  if (!v) throw fail('bir nesne olmalı: title, summary, roles, playbook, goals, routines, tasks (ve isteğe bağlı brief, closedMode, estimates, risks).');
  const extra = Object.keys(v).find((k) => !FIELDS.includes(k));
  if (extra) throw fail(`“${extra}” bilinmeyen alan.`);
  const list = (key: string): Record<string, unknown>[] => {
    const raw = v[key] ?? [];
    if (!Array.isArray(raw) || raw.some((x) => !record(x))) throw fail(`${key} nesnelerden oluşan bir liste olmalı.`);
    return raw as Record<string, unknown>[];
  };
  const str = (x: unknown) => (typeof x === 'string' ? x : x === undefined || x === null ? undefined : String(x));
  const keyOf = (x: Record<string, unknown>, what: string, seen: Set<string>): string => {
    const key = str(x.key) ?? '';
    if (!KEY.test(key)) throw fail(`anahtar “${key}”: küçük harf, rakam ve tire olmalı.`);
    if (seen.has(key)) throw fail(`${what} anahtarı “${key}” iki kez geçiyor.`);
    seen.add(key);
    return key;
  };

  const roleKeys = new Set<string>();
  const names = new Set<string>();
  const roles = list('roles').map((r): BlueprintRole => {
    const key = keyOf(r, 'rol', roleKeys);
    if (key === COORDINATOR) throw fail('“coordinator” bir rol anahtarı olamaz: koordinatörü gösterir.');
    const name = clean(str(r.name), `rol “${key}”: ad`, 60, true);
    if (names.has(lower(name))) throw fail(`“${name}” adı iki rolde geçiyor.`);
    names.add(lower(name));
    const template = str(r.template);
    if (template !== undefined) {
      try {
        roleTemplate(template);
      } catch (err) {
        throw fail(`rol “${key}”: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const model = str(r.model);
    if (model !== undefined && !(MODEL_ALIASES as readonly string[]).includes(model)) throw fail(`rol “${key}”: model ${MODEL_ALIASES.join(', ')} olmalı.`);
    const role = str(r.role);
    if (template === undefined && (!role?.trim() || model === undefined)) throw fail(`rol “${key}”: şablonsuz rolde role ve model gerekli.`);
    return {
      key, name, ...(template !== undefined ? { template } : {}), ...(role !== undefined ? { role } : {}), ...(str(r.title) !== undefined ? { title: str(r.title)! } : {}),
      ...(str(r.team) !== undefined ? { team: str(r.team)! } : {}), ...(model !== undefined ? { model: model as ModelAlias } : {}),
      ...(r.capabilities !== undefined ? { capabilities: roleCapabilities(r.capabilities, key) } : {}),
    };
  });
  if (roles.length === 0) throw fail('en az bir rol olmalı.');
  const ref = (x: unknown, where: string, label: string): string => {
    const key = str(x) ?? '';
    if (key !== COORDINATOR && !roleKeys.has(key)) throw fail(`${where}: ${label} “${key}” blueprint'te yok.`);
    return key;
  };
  const difficulty = (x: unknown, where: string): TaskDifficulty | null => {
    if (x === undefined || x === null) return null;
    if (!(TASK_DIFFICULTIES as readonly unknown[]).includes(x)) throw fail(`${where}: zorluk ${TASK_DIFFICULTIES.join(', ')} olmalı.`);
    return x as TaskDifficulty;
  };

  const topics = new Set<string>();
  const playbook = list('playbook').map((p) => {
    const topic = clean(str(p.topic), 'El kitabı konusu', 60, true);
    if (topics.has(lower(topic))) throw fail(`el kitabı konusu “${topic}” iki kez geçiyor.`);
    topics.add(lower(topic));
    return { topic, text: clean(str(p.text), `“${topic}” metni`, 20000, true) };
  });

  const goalKeys = new Set<string>();
  const goals = list('goals').map((g): BlueprintGoal => {
    const key = keyOf(g, 'hedef', goalKeys);
    let kpis;
    try {
      kpis = g.kpis === undefined ? [] : checkKpis(g.kpis);
    } catch (err) {
      throw fail(`hedef “${key}”: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { key, title: clean(str(g.title), `hedef “${key}”: başlık`, 160, true), why: clean(str(g.why), `hedef “${key}”: neden`, 2000, true), done: required(g.done, `hedef “${key}”: bitti tanımı`), kpis };
  });

  const routineKeys = new Set<string>();
  const routines = list('routines').map((r): BlueprintRoutine => {
    const key = keyOf(r, 'rutin', routineKeys);
    const where = `rutin “${key}”`;
    const role = ref(r.role, where, 'rol');
    const reviewer = r.reviewer === undefined || r.reviewer === null ? null : ref(r.reviewer, where, 'inceleyen');
    if (reviewer === role) throw fail(`${where}: inceleyen yapanla aynı olamaz.`);
    const cron = str(r.cron) ?? '';
    return { key, title: clean(str(r.title), `${where}: başlık`, 120, true), description: clean(str(r.description), `${where}: açıklama`, 4000, false), done: lines(r.done as string[] | undefined, `${where}: bitti tanımı`, 12, 300), role, reviewer, cron, difficulty: difficulty(r.difficulty, where) };
  });

  const taskKeys = new Set<string>();
  const tasks = list('tasks').map((t): BlueprintTask => {
    const key = keyOf(t, 'görev', taskKeys);
    const where = `görev “${key}”`;
    const role = ref(t.role, where, 'rol');
    const reviewer = t.reviewer === undefined || t.reviewer === null ? null : ref(t.reviewer, where, 'inceleyen');
    if (reviewer === role) throw fail(`${where}: inceleyen yapanla aynı olamaz.`);
    const priority = t.priority === undefined ? 3 : t.priority;
    if (!Number.isInteger(priority) || (priority as number) < 1 || (priority as number) > 5) throw fail(`${where}: öncelik 1 ile 5 arasında bir tam sayı olmalı.`);
    return {
      key, title: clean(str(t.title), `${where}: başlık`, 120, true), description: clean(str(t.description), `${where}: açıklama`, 4000, false), done: lines(t.done as string[] | undefined, `${where}: bitti tanımı`, 12, 300),
      role, reviewer, requires: t.requires === undefined ? [] : capabilityIds(t.requires, `${where}: gereken yetenekler`), difficulty: difficulty(t.difficulty, where), priority: priority as number,
    };
  });

  let closedMode: Blueprint['closedMode'] = null;
  if (v.closedMode !== undefined && v.closedMode !== null) {
    const deny = record(v.closedMode)?.deny;
    if (!Array.isArray(deny) || deny.some((x) => typeof x !== 'string')) throw fail('kapalı kip (closedMode) { deny: [kurallar] } olmalı.');
    const rules = (deny as string[]).map((x) => x.trim());
    if (rules.some((x) => !x)) throw fail('kapalı kip: boş kural.');
    if (rules.some((x) => x.length > 200)) throw fail('kapalı kip: bir kural en fazla 200 karakter olabilir.');
    closedMode = { deny: [...new Set(rules)] };
  }
  const est = record(v.estimates) ?? {};
  const amount = (x: unknown, label: string): number | null => {
    if (x === undefined || x === null) return null;
    if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) throw fail(`${label} sıfır ya da pozitif bir sayı olmalı.`);
    return x;
  };
  const blueprint: Blueprint = {
    title: clean(str(v.title), 'başlık', 120, true),
    summary: clean(str(v.summary), 'özet (iş tarifi)', 2000, true),
    brief: v.brief === undefined || v.brief === null ? null : clean(str(v.brief), 'şirket özeti', 8000, true),
    roles, playbook, goals, routines, tasks, closedMode,
    estimates: { quotaPct: amount(est.quotaPct, 'kota payı'), usd: amount(est.usd, 'para'), days: amount(est.days, 'süre') },
    risks: clean(str(v.risks), 'riskler', 1000, false),
  };
  const count = stepKeys(blueprint).length;
  if (count > MAX_STEPS) throw fail(`en fazla ${MAX_STEPS} adım olabilir (şimdi ${count}): plan kartı bu kadarını gösterir. İlk görevleri azalt; gerisini kurulumdan sonra aç.`);
  return blueprint;
}

/** A routine's cron, against the constitution's shortest interval: checked at proposal, not first at install. */
export function checkRoutines(b: Blueprint, rules: Constitution, now: number): void {
  for (const r of b.routines) {
    let gap: number;
    try {
      gap = minIntervalMinutes(parseCron(r.cron), now);
    } catch (err) {
      throw new ValidationError(`Blueprint: rutin “${r.key}”: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (gap < rules.minScheduleMinutes) throw new ValidationError(`Blueprint: rutin “${r.key}”: iki çalışma arası en az ${rules.minScheduleMinutes} dakika olmalı; bu zamanlama ${Math.round(gap)} dakikada bir.`);
  }
}

/** A role's capabilities, checked at the blueprint (the error says which role). */
function roleCapabilities(x: unknown, key: string): string[] {
  try {
    return capabilityIds(x, 'yetenekler');
  } catch (err) {
    throw new ValidationError(`Blueprint: rol “${key}”: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function required(x: unknown, label: string): string[] {
  const items = lines(x as string[] | undefined, label, 12, 300);
  if (items.length === 0) throw new ValidationError(`Blueprint: ${label} en az bir madde olmalı.`);
  return items;
}

/** What blueprintApply says: the count, then each step with what happened. */
export function applyText(r: BlueprintApplyReport): string {
  const n = r.steps.length;
  const count = (x: BlueprintStepResult) => r.steps.filter((s) => s.result === x).length;
  const linesOut = r.steps.map((s) => `• ${s.label} — ${RESULT_TR[s.result]}${s.note ? ` (${s.note})` : ''}${s.error ? `: ${s.error}` : ''}`);
  if (!r.finished) {
    const at = r.steps.findIndex((s) => s.result === 'failed');
    return [`Kurulum durdu: “${r.title}” — ${at + 1}. adımda (${r.steps[at]!.label}): ${r.steps[at]!.error}. Yapılanlar kayıtlı; sorunu çözüp blueprintApply'ı yeniden çalıştır, kaldığı yerden sürer.`, ...linesOut].join('\n');
  }
  if (count('skipped') === n) return `Kurulum: “${r.title}” — ${n} adım: hepsi zaten yapılmıştı; hiçbir şey eklenmedi.`;
  const parts = [count('done') ? `${count('done')} yapıldı` : '', count('adopted') ? `${count('adopted')} var olan kullanıldı` : '', count('skipped') ? `${count('skipped')} zaten yapılmıştı` : ''].filter(Boolean);
  return [`Kurulum: “${r.title}” — ${n} adım: ${parts.join(', ')}.`, ...linesOut].join('\n');
}

/** What blueprintRead says. */
export function blueprintText(view: BlueprintView, plan: Plan): string {
  const changed = view.profileNow !== view.profileVersion ? `; profil o günden beri değişti (şimdi sürüm ${view.profileNow}): yeniden onboarding farkı gerekebilir` : '';
  const count = (s: string) => view.steps.filter((x) => x.state === s).length;
  const out = [
    `# Blueprint: ${view.blueprint.title} (plan ${plan.id}, ${plan.status})`,
    `Dayanak: şirket profili sürüm ${view.profileVersion}${changed}.`,
    '',
    `## Adımlar (${view.steps.length}: ${count('done')} yapıldı, ${count('adopted')} var olan kullanıldı, ${count('pending')} bekliyor${count('removed') ? `, ${count('removed')} blueprint'te artık yok` : ''})`,
    ...view.steps.map((s) => `• ${s.label} — ${STATE_TR[s.state]}`),
  ];
  if (view.blueprint.closedMode) {
    out.push('', '## Kapalı kip (yalnız liste, salt okunur; hiçbir araç çağrılmadı)');
    if (view.closedMode.length === 0) out.push('Henüz kurulan masa yok.');
    for (const d of view.closedMode) {
      out.push(`• ${d.name}${d.applied ? '' : ' (kurulum dokunmadı: var olan çalışan)'}: ${d.rules.map((r) => `${r.rule} ${CHECK_TR[r.check]}`).join('; ')}`);
    }
  }
  return out.join('\n');
}
