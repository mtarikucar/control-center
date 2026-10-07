import { REVIEW_SEVERITIES, WORK_TYPES, type PlanMethod, type ReviewFinding, type ReviewSeverity, type Task } from '@cc/shared';
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

/** From this many review rounds sent back on, the coordinator decides how to go on (spec §5.2). */
export const REVIEW_ROUNDS = 3;

/** A reviewer's findings, checked and sorted most severe first. */
export function reviewFindings(value: unknown): ReviewFinding[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError('Bulgular (findings) bir liste olmalı: her biri için severity ve text.');
  if (value.length > 30) throw new ValidationError('En fazla 30 bulgu yazılabilir.');
  return value
    .map((raw, i) => {
      const f = record(raw);
      if (!f || !(REVIEW_SEVERITIES as readonly unknown[]).includes(f.severity)) {
        throw new ValidationError(`${i + 1}. bulgunun önem derecesi (severity) critical, important ya da minor olmalı; metni text alanına yaz.`);
      }
      return { severity: f.severity as ReviewSeverity, text: clean(text(f.text), `${i + 1}. bulgu`, 2000, true) };
    })
    .sort((a, b) => REVIEW_SEVERITIES.indexOf(a.severity) - REVIEW_SEVERITIES.indexOf(b.severity));
}

/** What the reviewer reads: the work, each done item with its evidence, the summary and the outputs. */
export function reviewBrief(task: Task, doer: string, round: number): string {
  const r = task.result;
  const ev = r?.evidence ?? [];
  const items = task.done.length
    ? task.done.map((d, i) => `${i + 1}. ${d}\n   Kanıt: ${ev[i] ?? '—'}`).join('\n')
    : ev.length
      ? ev.map((e) => `- ${e}`).join('\n')
      : '(bitti tanımı yok)';
  return [
    `${doer} “${task.title}” görevini teslim etti (inceleme turu ${round}); görev senin kararınla kapanır.`,
    '',
    '### İş',
    task.description || '(açıklama yok)',
    '',
    '### Bitti tanımı ve kanıt',
    items,
    '',
    '### Teslim özeti',
    r?.summary ?? '',
    ...(r?.outputs.length ? ['', '### Çıktılar', ...r.outputs.map((o) => `- ${o}`)] : []),
    ...(r?.archive ? ['', `Arşiv: ${r.archive}`] : []),
  ]
    .join('\n')
    .slice(0, 12000);
}
