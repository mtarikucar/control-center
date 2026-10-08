import { KPI_CADENCE_TR, KPI_OFFICE_METRICS, type Employee, type Goal, type Kpi, type KpiCadence, type KpiDirection, type KpiSource } from '@cc/shared';
import type { Db } from '../db.ts';
import { ConflictError, ValidationError } from '../errors.ts';
import type { PerformanceReport } from '../performance.ts';
import type { CompanyStateStore, GoalStore } from './goal-store.ts';
import type { NoticeStore, PlanStore } from './store.ts';
import { clean, fold } from './text.ts';
import { formatStamp } from './time.ts';

const DAY = 86_400_000;
/** How far back a KPI is read and how often it is due (spec 2026-10-08-kpi-readings-design §4–5). */
export const KPI_PERIOD_MS: Record<KpiCadence, number> = { daily: DAY, weekly: 7 * DAY, monthly: 30 * DAY };

/** One reading of a goal's KPI, kept with the target, direction and unit it was measured against. */
export interface KpiReading {
  id: number;
  goalId: string;
  kpi: string;
  /** null: the office found nothing to measure in the window. */
  value: number | null;
  unit: string;
  target: number;
  direction: KpiDirection;
  source: KpiSource;
  /** An office reading's window start; null for one read by hand. */
  periodStart: number | null;
  recordedAt: number;
  /** The coordinator's id, or 'office'. */
  recordedBy: string;
  note: string | null;
}

interface Row {
  id: number;
  goal_id: string;
  kpi: string;
  value: number | null;
  unit: string;
  target: number;
  direction: string;
  source: string;
  period_start: number | null;
  recorded_at: number;
  recorded_by: string;
  note: string | null;
}

const fromRow = (r: Row): KpiReading => ({
  id: r.id, goalId: r.goal_id, kpi: r.kpi, value: r.value, unit: r.unit, target: r.target, direction: r.direction as KpiDirection, source: r.source as KpiSource,
  periodStart: r.period_start, recordedAt: r.recorded_at, recordedBy: r.recorded_by, note: r.note,
});

const number = (n: number) => String(Math.round(n * 10) / 10);
const amount = (n: number, unit: string) => (unit === '%' ? `%${number(n)}` : `${number(n)} ${unit}`);
const targetText = (k: Kpi) => `${k.direction === 'atLeast' ? '≥' : '≤'} ${amount(k.target, k.unit)}`;
const valueText = (r: KpiReading) => (r.value === null ? 'veri yok' : amount(r.value, r.unit));
/** Met is judged against the KPI's target today (the retro shows that target). */
const met = (k: Kpi, value: number) => (k.direction === 'atLeast' ? value >= k.target : value <= k.target);
const cell = (text: string) => text.replace(/\|/g, '\\|');

export interface KpiReadingsDeps {
  db: Db;
  goals: GoalStore;
  plans: PlanStore;
  notices: NoticeStore;
  state: CompanyStateStore;
  /** Who records by hand and hears what is due (Company.coordinator). */
  coordinator: () => Employee | null;
  /** B4's report over the goals asked for (performanceReport with its goals scope). */
  performance: (o: { since: number; now: number; goals: Array<{ id: string; planIds: string[] }> }) => PerformanceReport;
  now?: () => number;
}

/**
 * KPI measurement (B26): readings by hand (kpiRecord), the office's own KPIs read from its metrics (B4), the routine
 * that reads them when due and tells the coordinator what to read by hand, and the retro's KPI table.
 */
export class KpiReadings {
  readonly #d: KpiReadingsDeps;
  readonly #now: () => number;

  constructor(d: KpiReadingsDeps) {
    this.#d = d;
    this.#now = d.now ?? Date.now;
  }

  /** kpiRecord: the coordinator writes a reading of a KPI read by hand or from a connection. */
  record(by: string, input: { goalId: string; kpi: string; value: unknown; note?: string }): { reading: KpiReading; text: string } {
    if (this.#d.coordinator()?.id !== by) throw new ConflictError('KPI okumasını yalnız koordinatör yazar.');
    const goal = this.#d.goals.get(input.goalId);
    if (goal.status !== 'active') throw new ConflictError(`“${goal.title}” hedefi aktif değil; kapalı hedefe okuma yazılmaz.`);
    const kpi = goal.kpis.find((k) => fold(k.name) === fold(input.kpi));
    if (!kpi) throw new ValidationError(`“${input.kpi}” bu hedefin KPI'sı değil. Hedefin KPI'ları: ${goal.kpis.map((k) => k.name).join(', ') || 'yok'}.`);
    if (kpi.source === 'office') {
      throw new ConflictError(`“${kpi.name}” ofis kaynaklı: ofis onu kendi metriğinden (${KPI_OFFICE_METRICS[kpi.metric!].label}) kendisi okur; elle yazılmaz.`);
    }
    if (typeof input.value !== 'number' || !Number.isFinite(input.value)) throw new ValidationError('Okunan değer (value) bir sayı olmalı.');
    if (kpi.unit === '%' && (input.value < 0 || input.value > 100)) throw new ValidationError('Yüzde değeri 0 ile 100 arasında olmalı.');
    const note = clean(input.note, 'Not', 500, false) || null;
    const reading = this.#write(goal, kpi, { value: input.value, periodStart: null, at: this.#now(), by, note });
    return { reading, text: `“${kpi.name}” okuması kaydedildi: ${valueText(reading)}; hedef ${targetText(kpi)}: ${met(kpi, input.value) ? 'tuttu' : 'tutmadı'}.` };
  }

  /** The routine, on the office tick: each active goal's KPI whose period has passed since its last reading (or the goal's opening). */
  measure(): void {
    const now = this.#now();
    const coordinator = this.#d.coordinator();
    const due: string[] = [];
    for (const goal of this.#d.goals.list({ statuses: ['active'] })) {
      if (goal.kpis.length === 0) continue;
      const readings = this.#readingsOf(goal.id);
      for (const kpi of goal.kpis) {
        const period = KPI_PERIOD_MS[kpi.cadence];
        const last = this.#of(readings, kpi).at(-1);
        if (now - (last?.recordedAt ?? goal.createdAt) < period) continue;
        if (kpi.source === 'office') {
          this.#readOffice(goal, kpi, now);
          continue;
        }
        // Read by hand: the coordinator hears once a period (the marker survives a restart, as the pulse's).
        if (!coordinator) continue;
        const key = `kpi.due.${goal.id}.${fold(kpi.name)}`;
        const reminded = Number(this.#d.state.get(key) ?? '0') || 0;
        if (reminded > 0 && now - reminded < period) continue;
        this.#d.state.set(key, String(now));
        due.push(`“${goal.title}” hedefinin “${kpi.name}” KPI'sı (${KPI_CADENCE_TR[kpi.cadence]}; ${last ? `son okuma: ${valueText(last)} (${formatStamp(last.recordedAt)})` : 'son okuma yok'})`);
      }
    }
    if (due.length > 0 && coordinator) this.#d.notices.add(coordinator.id, 'kpi.due', `KPI ölçüm zamanı: ${due.join('; ')}. ${due.length > 1 ? 'Değerleri' : 'Değeri'} kpiRecord ile yaz.`);
  }

  /** The retro's KPI table for a plan's goal (office KPIs read now); null when it has no goal or no KPIs. */
  retroTable(goalId: string | null): string | null {
    if (!goalId) return null;
    const goal = this.#d.goals.get(goalId);
    if (goal.kpis.length === 0) return null;
    const now = this.#now();
    for (const kpi of goal.kpis) if (kpi.source === 'office') this.#readOffice(goal, kpi, now);
    const readings = this.#readingsOf(goal.id);
    const reading = (r: KpiReading) => `${valueText(r)} (${formatStamp(r.recordedAt)}${r.source === 'office' ? ', ofis' : ''})`;
    const rows = goal.kpis.map((kpi) => {
      const own = this.#of(readings, kpi);
      const last = own.at(-1);
      const previous = own.at(-2);
      const status = !last ? 'kpiRecord ile yaz' : last.value === null ? 'veri yok' : met(kpi, last.value) ? 'tuttu' : 'tutmadı';
      return `| ${cell(kpi.name)} | ${targetText(kpi)} | ${last ? reading(last) : 'okuma yok'} | ${previous ? reading(previous) : '—'} | ${status} |`;
    });
    return ['| KPI | Hedef | Son okuma | Önceki | Durum |', '|---|---|---|---|---|', ...rows].join('\n');
  }

  /** goalsRead's line: the last reading of each KPI that has one; empty when none has. */
  lastReadings(goal: Goal): string {
    const readings = this.#readingsOf(goal.id);
    const parts = goal.kpis.flatMap((kpi) => {
      const last = this.#of(readings, kpi).at(-1);
      if (!last) return [];
      const verdict = last.value === null ? '' : `, ${met(kpi, last.value) ? 'tuttu' : 'tutmadı'}`;
      return [`${kpi.name} ${valueText(last)} (${formatStamp(last.recordedAt)}${verdict})`];
    });
    return parts.join('; ');
  }

  /** The office's value over the goal's plans' work in the KPI's window; a rate is shown as a %. */
  #readOffice(goal: Goal, kpi: Kpi, now: number): void {
    const period = KPI_PERIOD_MS[kpi.cadence];
    const planIds = this.#d.plans.list(100_000).filter((p) => p.goalId === goal.id).map((p) => p.id);
    const metrics = this.#d.performance({ since: now - period, now, goals: [{ id: goal.id, planIds }] }).goals?.[0];
    const raw = metrics ? metrics[kpi.metric!] : null;
    const value = raw === null || raw === undefined ? null : kpi.metric === 'firstPassRate' ? raw * 100 : raw;
    this.#write(goal, kpi, { value, periodStart: now - period, at: now, by: 'office', note: null });
  }

  #write(goal: Goal, kpi: Kpi, r: { value: number | null; periodStart: number | null; at: number; by: string; note: string | null }): KpiReading {
    const out = this.#d.db
      .prepare('INSERT INTO kpi_readings (goal_id, kpi, value, unit, target, direction, source, period_start, recorded_at, recorded_by, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(goal.id, kpi.name, r.value, kpi.unit, kpi.target, kpi.direction, kpi.source, r.periodStart, r.at, r.by, r.note);
    return { id: Number(out.lastInsertRowid), goalId: goal.id, kpi: kpi.name, value: r.value, unit: kpi.unit, target: kpi.target, direction: kpi.direction, source: kpi.source, periodStart: r.periodStart, recordedAt: r.at, recordedBy: r.by, note: r.note };
  }

  /** A goal's readings, oldest first. */
  #readingsOf(goalId: string): KpiReading[] {
    return (this.#d.db.prepare('SELECT * FROM kpi_readings WHERE goal_id = ? ORDER BY recorded_at, id').all(goalId) as unknown as Row[]).map(fromRow);
  }

  /** The readings of one KPI: its name, folded as goalSet compares them. */
  #of(readings: KpiReading[], kpi: Kpi): KpiReading[] {
    return readings.filter((r) => fold(r.kpi) === fold(kpi.name));
  }
}
