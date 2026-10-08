import { AUTONOMY_LEVELS, COORDINATOR_TURNS, DEFAULT_CONSTITUTION, MODEL_ALIASES, TASK_DIFFICULTIES, type Autonomy, type BudgetSummary, type Constitution, type EmployeeUsage, type OfficeEvent, type QuotaState, type QuotaWindow, type ReserveState, type Spend, type Task, type TaskChange, type Usage } from '@cc/shared';
import { ValidationError } from '../errors.ts';
import type { EventStore } from '../event-store.ts';
import type { Roster } from '../roster.ts';
import type { ConstitutionStore, SpendStore } from './budget-store.ts';
import type { NoticeStore, PlanStore, TaskStore } from './store.ts';
import { clean } from './text.ts';

export interface BudgetDeps {
  constitution: ConstitutionStore;
  spend: SpendStore;
  tasks: TaskStore;
  plans: PlanStore;
  roster: Roster;
  events: EventStore;
  notices: NoticeStore;
  quota: { state(): QuotaState | null; usageAll?(ids: string[]): Record<string, EmployeeUsage> };
  /** Desks in the office: the most employees the constitution may allow. */
  deskCount: number;
  now?: () => number;
}

const SWITCHES = { digestEnabled: 'Özet', modelPolicyEnabled: 'Model politikası', difficultyModelsEnabled: 'Zorluk modelleri' } as const;
type SwitchKey = keyof typeof SWITCHES;
type NumberKey = Exclude<keyof Constitution, 'digestHours' | 'coordinatorModels' | 'difficultyModels' | 'autonomy' | SwitchKey>;

const RULES: Record<NumberKey, { label: string; min: number; max: (desks: number) => number; integer: boolean; nullable?: boolean }> = {
  maxEmployees: { label: 'Çalışan sınırı', min: 1, max: (desks) => desks, integer: true },
  ownerReservePct: { label: 'Sahibinin kota payı (%)', min: 0, max: () => 90, integer: true },
  monthlyUsdCap: { label: 'Aylık para sınırı (USD)', min: 0, max: () => 1_000_000, integer: false, nullable: true },
  chainDepth: { label: 'Paslama zinciri', min: 1, max: () => 20, integer: true },
  tasksPerDay: { label: 'Günlük görev sınırı', min: 1, max: () => 500, integer: true },
  openTasksPerPlan: { label: 'Plan başına açık görev', min: 1, max: () => 500, integer: true },
  idleSleepMinutes: { label: 'Boşta uyuma süresi (dk)', min: 0, max: () => 1440, integer: true },
  cacheTtlMinutes: { label: 'Önbellek süresi (dk)', min: 0, max: () => 60, integer: true },
  activeGoals: { label: 'En fazla aktif hedef', min: 1, max: () => 10, integer: true },
  pulseHours: { label: 'Nabız aralığı (saat)', min: 0, max: () => 168, integer: true },
  idleCapacityHours: { label: 'Boşta kapasite uyarısı (saat)', min: 0, max: () => 48, integer: true },
  defaultTaskMinutes: { label: 'Varsayılan görev süresi (dk)', min: 5, max: () => 480, integer: true },
  minScheduleMinutes: { label: 'Rutin aralığı en az (dk)', min: 1, max: () => 1440, integer: true },
  maxSchedules: { label: 'En fazla rutin', min: 0, max: () => 100, integer: true },
};

const MODEL_MAPS = {
  coordinatorModels: { label: 'Koordinatör modelleri', keys: COORDINATOR_TURNS },
  difficultyModels: { label: 'Zorluk modelleri', keys: TASK_DIFFICULTIES },
} as const;

/** A change to one of the model maps: known keys, known models; the keys not given stay as they are. */
function modelMap<T extends Record<string, string>>(key: keyof typeof MODEL_MAPS, value: unknown, current: T): T {
  const { label, keys } = MODEL_MAPS[key];
  const ok =
    typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.entries(value).every(([k, v]) => (keys as readonly string[]).includes(k) && (MODEL_ALIASES as readonly unknown[]).includes(v));
  if (!ok) throw new ValidationError(`Anayasa: ${label} ${keys.join(', ')} için ${MODEL_ALIASES.join(', ')} modellerinden biri olmalı.`);
  return { ...current, ...(value as Partial<T>) };
}

/** One to six whole local hours, kept sorted and without repeats. */
function digestHours(value: unknown): number[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6 || value.some((h) => typeof h !== 'number' || !Number.isInteger(h) || h < 0 || h > 23)) {
    throw new ValidationError('Anayasa: Özet saatleri 0 ile 23 arasında 1–6 tam saat olmalı (ör. 9, 17).');
  }
  return [...new Set(value as number[])].sort((a, b) => a - b);
}

const AUTONOMY_LABELS: Record<Autonomy, string> = { free: 'tam serbest', plans: 'planlar sahibine' };

/** A setting as the coordinator reads it when the owner changes it: its label and value; the owner's share as the office's limit. */
function described(key: keyof Constitution, c: Constitution): [label: string, value: string] {
  if (key === 'ownerReservePct') return ['Ofisin kota sınırı', `%${100 - c.ownerReservePct}`];
  if (key === 'digestHours') return ['Özet saatleri', c.digestHours.join(', ')];
  if (key === 'autonomy') return ['Serbestlik', AUTONOMY_LABELS[c.autonomy]];
  if (key === 'coordinatorModels' || key === 'difficultyModels') {
    const map: Record<string, string> = c[key];
    return [MODEL_MAPS[key].label, MODEL_MAPS[key].keys.map((k) => map[k]).join(' / ')];
  }
  if (Object.hasOwn(SWITCHES, key)) return [SWITCHES[key as SwitchKey], c[key] ? 'açık' : 'kapalı'];
  const value = c[key as NumberKey];
  return [RULES[key as NumberKey].label, value === null ? 'yok' : String(value)];
}

/** What differs between two constitutions, `Label old → new` in the constitution's order (the owner's notice and the board). */
export function constitutionChanges(before: Constitution, after: Constitution): string[] {
  return (Object.keys(DEFAULT_CONSTITUTION) as Array<keyof Constitution>).flatMap((key) => {
    const [label, was] = described(key, before);
    const is = described(key, after)[1];
    return was === is ? [] : [`${label} ${was} → ${is}`];
  });
}

const money = (n: number) => `$${(Math.round(n * 100) / 100).toString()}`;

/** A window whose reset time has passed is a fresh window: 0 %. */
function pctOf(w: QuotaWindow | null, now: number): number | null {
  if (!w) return null;
  return w.resetsAt <= now ? 0 : Math.round(w.utilization * 100);
}

/** A turn's tokens as a task counts them: everything claude read and wrote, cache included. */
export const turnTokens = (u: Usage): number => u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheCreationTokens;

/**
 * The assignee handed this task in: for review, done, or decided (a review). A reviewed task is finished by its
 * reviewer's decision, which is not its doer's turn.
 */
const handedIn = (change: TaskChange, task: Task): boolean =>
  change === 'in_review' || change === 'reviewed' || (change === 'finished' && !task.reviewer);

/**
 * The task each employee's turn is charged to, followed from the event log (the budget live, the cost backfill from
 * the past): the one in progress when the turn started, for every result of that turn, even once it is handed in,
 * decided, parked or blocked; for a turn that started on none, the first task the employee hands in during it; else
 * (none handed in, or the turn's start not seen) the one in progress when the result comes, e.g. unblocked during it.
 */
export class TurnLedger {
  /** Each employee's turn under way and its task (null: none yet). */
  readonly #turns = new Map<string, string | null>();

  started(employeeId: string, running: string | null): void {
    this.#turns.set(employeeId, running);
  }

  changed(employeeId: string, change: TaskChange, task: Task): void {
    if (this.#turns.get(employeeId) === null && handedIn(change, task)) this.#turns.set(employeeId, task.id);
  }

  /** The task a result is charged to; `running` (the task in progress now) when the turn has none of its own. */
  taskOf(employeeId: string, running: () => string | null): string | null {
    return this.#turns.get(employeeId) ?? running();
  }

  /** A result was charged: with no queued replies left in claude, the turn is over. */
  finished(employeeId: string, queuedTurns: number): void {
    if (queuedTurns === 0) this.#turns.delete(employeeId);
  }
}

/** The owner's limits and the company's money and quota (spec §6). */
export class Budget {
  readonly #d: BudgetDeps;
  readonly #now: () => number;
  #wasActive = false;
  readonly #turns = new TurnLedger();

  constructor(d: BudgetDeps) {
    this.#d = d;
    this.#now = d.now ?? Date.now;
  }

  constitution(): Constitution {
    return this.#d.constitution.get();
  }

  /**
   * A change to the constitution; every value is checked before anything is written. The owner's changes come through
   * ownerSetConstitution, which also tells the coordinator.
   */
  setConstitution(patch: Record<string, unknown>): Constitution {
    const checked: Partial<Constitution> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (!Object.hasOwn(DEFAULT_CONSTITUTION, key)) throw new ValidationError(`Bilinmeyen anayasa maddesi: ${key}`);
      if (key === 'digestHours') {
        checked.digestHours = digestHours(value);
        continue;
      }
      if (key === 'autonomy') {
        if (!(AUTONOMY_LEVELS as readonly unknown[]).includes(value)) throw new ValidationError('Anayasa: Serbestlik free (tam serbest) ya da plans (planlar sahibine) olmalı.');
        checked.autonomy = value as Autonomy;
        continue;
      }
      if (Object.hasOwn(SWITCHES, key)) {
        if (typeof value !== 'boolean') throw new ValidationError(`Anayasa: ${SWITCHES[key as SwitchKey]} anahtarı açık ya da kapalı (true/false) olmalı.`);
        (checked as Record<string, unknown>)[key] = value;
        continue;
      }
      if (key === 'coordinatorModels' || key === 'difficultyModels') {
        (checked as Record<string, unknown>)[key] = modelMap(key, value, this.constitution()[key]);
        continue;
      }
      const rule = RULES[key as NumberKey];
      if (value === null && rule.nullable) {
        (checked as Record<string, unknown>)[key] = null;
        continue;
      }
      const max = rule.max(this.#d.deskCount);
      if (typeof value !== 'number' || !Number.isFinite(value) || (rule.integer && !Number.isInteger(value)) || value < rule.min || value > max) {
        throw new ValidationError(`Anayasa: ${rule.label} ${rule.min} ile ${max} arasında ${rule.integer ? 'bir tam sayı' : 'bir sayı'} olmalı${rule.nullable ? ' (ya da boş)' : ''}.`);
      }
      (checked as Record<string, unknown>)[key] = value;
    }
    const next = this.#d.constitution.set(checked);
    this.#announce();
    this.checkReserve();
    return next;
  }

  /**
   * The owner changes the constitution (the screen's form, which sends every field): the coordinator hears what really
   * changed, old → new, in one decision notice, so it can re-plan its running work. Nothing changed, or no coordinator:
   * no notice.
   */
  ownerSetConstitution(patch: Record<string, unknown>): Constitution {
    const before = this.constitution();
    const next = this.setConstitution(patch);
    const changes = constitutionChanges(before, next);
    const coordinator = this.#d.roster.list().find((e) => e.kind === 'coordinator');
    if (coordinator && changes.length) {
      this.#d.notices.add(coordinator.id, 'constitution.changed', `Sahibi anayasayı değiştirdi: ${changes.join('; ')}. Süren planlarını yeni sınırlara göre gözden geçir.`);
    }
    return next;
  }

  reserve(): ReserveState {
    const c = this.constitution();
    const limitPct = 100 - c.ownerReservePct;
    const q = this.#d.quota.state();
    const now = this.#now();
    const fiveHourPct = pctOf(q?.fiveHour ?? null, now);
    const sevenDayPct = pctOf(q?.sevenDay ?? null, now);
    const active = c.ownerReservePct > 0 && [fiveHourPct, sevenDayPct].some((p) => p !== null && p >= limitPct);
    return { active, limitPct, fiveHourPct, sevenDayPct };
  }

  reserveActive(): boolean {
    return this.reserve().active;
  }

  /** When the reserve starts or ends: the coordinator is told once, and the screen hears. */
  checkReserve(): void {
    const r = this.reserve();
    if (r.active === this.#wasActive) return;
    this.#wasActive = r.active;
    const coordinator = this.#d.roster.list().find((e) => e.kind === 'coordinator');
    if (coordinator) {
      const used = Math.max(r.fiveHourPct ?? 0, r.sevenDayPct ?? 0);
      this.#d.notices.add(
        coordinator.id,
        'reserve.changed',
        r.active
          ? `Sahibinin kota payı devrede: kullanım %${used}, sınır %${r.limitPct}. Ofis yalnız öncelik 1 görevleri başlatıyor, boştakiler uyuyor; pencere açılınca kendiliğinden döner. Gerekirse öncelikleri yeniden sırala.`
          : 'Sahibinin kota payı serbest kaldı: ofis normal çalışmaya döndü.',
      );
    }
    this.#announce();
  }

  recordSpend(by: string, s: { service: string; usd: number; purpose: string; planId?: string | null }): { spend: Spend; warnings: string[] } {
    this.#d.roster.get(by);
    if (typeof s.usd !== 'number' || !Number.isFinite(s.usd) || s.usd <= 0 || s.usd > 1_000_000) throw new ValidationError('Tutar sıfırdan büyük bir sayı olmalı (USD).');
    const planId = s.planId ?? null;
    const plan = planId !== null ? this.#d.plans.get(planId) : null;
    const spend = this.#d.spend.create({
      by,
      service: clean(s.service, 'Servis', 80, true),
      usd: Math.round(s.usd * 100) / 100,
      purpose: clean(s.purpose, 'Ne için', 500, true),
      planId,
    });
    this.#emit(by, { type: 'spend.recorded', spend });
    const warnings: string[] = [];
    const c = this.constitution();
    const month = this.#d.spend.total({ since: this.#monthStart() });
    if (c.monthlyUsdCap !== null && month > c.monthlyUsdCap) {
      warnings.push(`Bu ayın harcaması ${money(month)} ile aylık sınırı (${money(c.monthlyUsdCap)}) aştı; koordinatör sahibine getirmeli.`);
    }
    if (plan && plan.usd !== null) {
      const spent = this.#d.spend.total({ planId: plan.id });
      if (spent > plan.usd) warnings.push(`“${plan.title}” planının harcaması ${money(spent)} ile onaylanan ${money(plan.usd)} bütçeyi aştı: bu büyük bir değişiklik, planRevise ile sahibine getirilmeli.`);
    }
    const coordinator = this.#d.roster.list().find((e) => e.kind === 'coordinator');
    if (warnings.length && coordinator && coordinator.id !== by) this.#d.notices.add(coordinator.id, 'spend.over', warnings.join(' '));
    this.#announce();
    return { spend, warnings };
  }

  spending(planId?: string): Spend[] {
    return this.#d.spend.list({ planId, limit: 200 });
  }

  /**
   * A finished turn's Claude usage goes to the task the turn was about (TurnLedger): the one in progress when the turn
   * started, even if handed in before it ended; else the first one handed in during it; else the one in progress now
   * (also when the turn's start was not seen). Nothing when there is none.
   */
  chargeTurn(employeeId: string, usd: number, tokens: number): void {
    const taskId = this.#turns.taskOf(employeeId, () => this.#d.tasks.inProgressOf(employeeId)?.id ?? null);
    if (taskId && (usd > 0 || tokens > 0)) this.#d.tasks.charge(taskId, usd, tokens);
  }

  summary(): BudgetSummary {
    const spent = this.#d.spend.byPlan();
    const claude = this.#d.tasks.costByPlan();
    const plans: BudgetSummary['plans'] = {};
    for (const id of new Set([...Object.keys(spent), ...Object.keys(claude)])) plans[id] = { spentUsd: spent[id] ?? 0, claudeUsd: claude[id] ?? 0 };
    return { constitution: this.constitution(), reserve: this.reserve(), month: { key: this.#monthKey(), usd: this.#d.spend.total({ since: this.#monthStart() }) }, plans };
  }

  /** What the coordinator reads with budgetStatus. */
  status(): string {
    const r = this.reserve();
    const c = this.constitution();
    const s = this.summary();
    const pct = (p: number | null) => (p === null ? '—' : `%${p}`);
    const lines = [
      `Kota: 5 saat ${pct(r.fiveHourPct)}, 7 gün ${pct(r.sevenDayPct)} (sahibinin payı %${c.ownerReservePct} → sınır %${r.limitPct})${r.active ? '. PAY DEVREDE: yalnız öncelik 1 görevler başlıyor.' : '.'}`,
      `Bu ay harcanan: ${money(s.month.usd)}${c.monthlyUsdCap !== null ? ` / sınır ${money(c.monthlyUsdCap)}` : ''}.`,
    ];
    const running = this.#d.plans.list().filter((p) => p.status === 'approved');
    if (running.length) {
      lines.push('Süren planlar:');
      for (const p of running) {
        const b = s.plans[p.id] ?? { spentUsd: 0, claudeUsd: 0 };
        lines.push(
          `• “${p.title}”: para ${money(b.spentUsd)}${p.usd !== null ? ` / ${money(p.usd)}` : ''} · Claude kullanımı ~${money(b.claudeUsd)}${p.quotaPct !== null ? ` · tahmini kota %${p.quotaPct}` : ''}`,
        );
      }
    }
    const people = this.#d.roster.list();
    const usage = this.#d.quota.usageAll?.(people.map((e) => e.id)) ?? {};
    const top = people
      .map((e) => ({ name: e.name, usd: usage[e.id]?.today.costUsd ?? 0, turns: usage[e.id]?.today.turns ?? 0, side: usage[e.id]?.today.sideAnswers ?? 0 }))
      .filter((x) => x.usd > 0 || x.turns > 0 || x.side > 0)
      .sort((a, b) => b.usd - a.usd || b.turns - a.turns)
      .slice(0, 5);
    const used = (x: (typeof top)[number]) => `${x.name} ~${money(x.usd)}, ${x.turns} tur${x.side ? ` + ${x.side} yan cevap` : ''}`;
    if (top.length) lines.push(`Bugün en çok kullananlar: ${top.map(used).join('; ')}.`);
    return lines.join('\n');
  }

  /** Charges finished turns and re-checks the reserve when a new quota reading arrives. */
  watch(): () => void {
    return this.#d.events.subscribe((stored) => {
      const ev = stored.event;
      const id = stored.employeeId;
      if (ev.type === 'turn.started' && id) this.#turns.started(id, this.#d.tasks.inProgressOf(id)?.id ?? null);
      else if (ev.type === 'task.changed' && id) this.#turns.changed(id, ev.change, ev.task);
      else if (ev.type === 'turn.finished' && id) {
        this.chargeTurn(id, ev.costUsd, turnTokens(ev.usage));
        // claude still holds queued messages: the same turn goes on and its next result is this task's too.
        this.#turns.finished(id, ev.queuedTurns);
      } else if (ev.type === 'quota.updated') this.checkReserve();
    });
  }

  #monthStart(): number {
    const d = new Date(this.#now());
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  }

  #monthKey(): string {
    const d = new Date(this.#now());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  #announce(): void {
    this.#emit(null, { type: 'budget.changed', budget: this.summary() });
  }

  #emit(employeeId: string | null, event: OfficeEvent): void {
    this.#d.events.append(employeeId, event);
  }
}
