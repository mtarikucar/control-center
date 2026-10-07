import { KPI_CADENCES, KPI_DIRECTIONS, KPI_OFFICE_METRICS, KPI_SOURCES, type Kpi, type KpiCadence, type KpiDirection, type KpiOfficeMetric, type KpiSource } from '@cc/shared';
import { ValidationError } from '../errors.ts';
import type { GroupMetrics } from '../performance.ts';
import { clean, fold } from './text.ts';

/** Every office KPI metric is one of the performance report's group metrics (B4): checked when compiling. */
const OFFICE_METRICS: readonly (keyof GroupMetrics)[] = Object.keys(KPI_OFFICE_METRICS) as KpiOfficeMetric[];
const KEYS = ['name', 'target', 'direction', 'unit', 'source', 'metric', 'cadence'];
const MAX_KPIS = 8;

const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === 'string' && (list as readonly string[]).includes(value);

/** A goal's KPI list checked whole (spec 2026-10-08-goal-kpis-design §2): every field said, none unknown, no silent default. */
export function checkKpis(value: unknown): Kpi[] {
  if (!Array.isArray(value)) throw new ValidationError("KPI'lar (kpis) bir liste olmalı: her biri name, target, direction, unit, source, cadence (office kaynağında metric) alanlı bir nesne.");
  if (value.length > MAX_KPIS) throw new ValidationError(`Bir hedefte en fazla ${MAX_KPIS} KPI olabilir.`);
  const seen = new Set<string>();
  return value.map((raw): Kpi => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ValidationError("KPI'lar (kpis) içinde her KPI bir nesne olmalı.");
    const k = raw as Record<string, unknown>;
    if (k.name !== undefined && typeof k.name !== 'string') throw new ValidationError('KPI adı (name) metin olmalı.');
    const name = clean(k.name as string | undefined, 'KPI adı (name)', 120, true);
    const fail = (why: string) => new ValidationError(`KPI “${name}”: ${why}`);
    const unknown = Object.keys(k).find((key) => !KEYS.includes(key));
    if (unknown !== undefined) throw fail(`bilinmeyen alan “${unknown}”. Alanlar: ${KEYS.join(', ')}.`);
    if (seen.has(fold(name))) throw new ValidationError(`Aynı adla iki KPI var: “${name}”.`);
    seen.add(fold(name));
    if (typeof k.target !== 'number' || !Number.isFinite(k.target)) throw fail('hedef değer (target) bir sayı olmalı.');
    if (!oneOf<KpiDirection>(KPI_DIRECTIONS, k.direction)) throw fail('yön (direction) atLeast (en az) ya da atMost (en çok) olmalı.');
    if (!oneOf<KpiSource>(KPI_SOURCES, k.source)) throw fail('kaynak (source) manual, office ya da capability olmalı.');
    if (!oneOf<KpiCadence>(KPI_CADENCES, k.cadence)) throw fail('sıklık (cadence) daily, weekly ya da monthly olmalı.');
    let unit: string;
    let metric: KpiOfficeMetric | null = null;
    if (k.source === 'office') {
      if (!oneOf<KpiOfficeMetric>(OFFICE_METRICS as KpiOfficeMetric[], k.metric)) throw fail(`ofis kaynağı için metric şunlardan biri olmalı: ${OFFICE_METRICS.join(', ')}.`);
      metric = k.metric;
      unit = KPI_OFFICE_METRICS[metric].unit;
      if (k.unit !== undefined && k.unit !== null && k.unit !== unit) throw fail(`${metric} ofis metriğinin birimi ${unit}.`);
    } else {
      if (k.metric !== undefined && k.metric !== null) throw fail('metric yalnız source office iken verilir.');
      if (typeof k.unit !== 'string' || !k.unit.trim()) throw fail('birim (unit) gerekli (ör. %, gün, sipariş).');
      unit = k.unit.trim();
      if (unit.length > 20) throw fail('birim (unit) en fazla 20 karakter olabilir.');
    }
    if (unit === '%' && (k.target < 0 || k.target > 100)) throw fail('yüzde hedefi 0 ile 100 arasında olmalı.');
    return { name, target: k.target, direction: k.direction, unit, source: k.source, metric, cadence: k.cadence };
  });
}
