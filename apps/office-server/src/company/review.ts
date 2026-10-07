import { WORK_TYPES, type PlanMethod } from '@cc/shared';
import { ValidationError } from '../errors.ts';
import { isWorkType } from './craft.ts';
import { clean, lines } from './text.ts';

export const METHOD_MISSING =
  'Önce işin nasıl yapılacağını yaz: methodRead ile iş türünün yöntemine bak, sonra plana yöntemi ekle (method): iş türü (workType), en az iki aşama (her biri için name, role, review) ve en az bir kalite kontrolü (checks).';

const record = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A plan's method as the coordinator gave it (spec §5.1): a work type, two or more stages, one or more checks. */
export function planMethod(value: unknown): PlanMethod {
  if (value === undefined || value === null) throw new ValidationError(METHOD_MISSING);
  const v = record(value);
  if (!v) throw new ValidationError('Yöntem (method) bir nesne olmalı: workType, stages, checks.');
  if (!isWorkType(v.workType)) throw new ValidationError(`İş türü (workType) ${WORK_TYPES.join(', ')} değerlerinden biri olmalı.`);
  if (!Array.isArray(v.stages) || v.stages.length < 2) {
    throw new ValidationError('Yöntemde en az iki aşama (stages) olmalı: her biri için ad (name), kim yapar (role), incelemesi var mı (review).');
  }
  if (v.stages.length > 12) throw new ValidationError('Yöntemde en fazla 12 aşama olabilir.');
  const stages = v.stages.map((raw, i) => {
    const st = record(raw);
    if (!st) throw new ValidationError(`${i + 1}. aşama bir nesne olmalı: name, role, review.`);
    if (st.review !== undefined && typeof st.review !== 'boolean') throw new ValidationError(`${i + 1}. aşamanın review alanı true ya da false olmalı.`);
    return { name: clean(text(st.name), `${i + 1}. aşamanın adı`, 120, true), role: clean(text(st.role), `${i + 1}. aşamanın rolü`, 120, true), review: st.review === true };
  });
  if (v.checks !== undefined && !(Array.isArray(v.checks) && v.checks.every((c) => typeof c === 'string'))) {
    throw new ValidationError('Kalite kontrolleri (checks) metinlerden oluşan bir liste olmalı.');
  }
  const checks = lines(v.checks as string[] | undefined, 'Kalite kontrolleri', 12, 300);
  if (checks.length === 0) throw new ValidationError('Yöntemde en az bir kalite kontrolü (checks) olmalı: işin iyi olduğunu neyle anlayacaksın?');
  return { workType: v.workType, stages, checks };
}
