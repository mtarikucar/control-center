import { DEFAULT_CONSTITUTION, type BudgetSummary, type Constitution, type EmployeeUsage, type OfficeEvent, type QuotaState, type QuotaWindow, type ReserveState, type Spend } from '@cc/shared';
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

const RULES: Record<keyof Constitution, { label: string; min: number; max: (desks: number) => number; integer: boolean; nullable?: boolean }> = {
  maxEmployees: { label: 'Çalışan sınırı', min: 1, max: (desks) => desks, integer: true },
  ownerReservePct: { label: 'Sahibinin kota payı (%)', min: 0, max: () => 90, integer: true },
  monthlyUsdCap: { label: 'Aylık para sınırı (USD)', min: 0, max: () => 1_000_000, integer: false, nullable: true },
  chainDepth: { label: 'Paslama zinciri', min: 1, max: () => 20, integer: true },
  tasksPerDay: { label: 'Günlük görev sınırı', min: 1, max: () => 500, integer: true },
  openTasksPerPlan: { label: 'Plan başına açık görev', min: 1, max: () => 500, integer: true },
  idleSleepMinutes: { label: 'Boşta uyuma süresi (dk)', min: 0, max: () => 1440, integer: true },
};

const money = (n: number) => `$${(Math.round(n * 100) / 100).toString()}`;

/** A window whose reset time has passed is a fresh window: 0 %. */
function pctOf(w: QuotaWindow | null, now: number): number | null {
  if (!w) return null;
  return w.resetsAt <= now ? 0 : Math.round(w.utilization * 100);
}

/** The owner's limits and the company's money and quota (spec §6). */
export class Budget {
  readonly #d: BudgetDeps;
  readonly #now: () => number;
  #wasActive = false;

  constructor(d: BudgetDeps) {
    this.#d = d;
    this.#now = d.now ?? Date.now;
  }

  constitution(): Constitution {
    return this.#d.constitution.get();
  }

  /** The owner changes the constitution; every value is checked before anything is written. */
  setConstitution(patch: Record<string, unknown>): Constitution {
    const checked: Partial<Constitution> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (!Object.hasOwn(DEFAULT_CONSTITUTION, key)) throw new ValidationError(`Bilinmeyen anayasa maddesi: ${key}`);
      const rule = RULES[key as keyof Constitution];
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
    if (warnings.length && coordinator && coordinator.id !== by) this.#d.notices.add(coordinator.id, warnings.join(' '));
    this.#announce();
    return { spend, warnings };
  }

  spending(planId?: string): Spend[] {
    return this.#d.spend.list({ planId, limit: 200 });
  }

  /** A finished turn's Claude usage goes to the task the employee is on (nothing when they are on none). */
  chargeTurn(employeeId: string, usd: number, tokens: number): void {
    const task = this.#d.tasks.inProgressOf(employeeId);
    if (task && (usd > 0 || tokens > 0)) this.#d.tasks.charge(task.id, usd, tokens);
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
      if (ev.type === 'turn.finished' && stored.employeeId) {
        const u = ev.usage;
        this.chargeTurn(stored.employeeId, ev.costUsd, u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheCreationTokens);
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
