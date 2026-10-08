import { STREAM_TO_HIRE, type Employee, type PlanStream } from '@cc/shared';
import { ValidationError } from '../errors.ts';
import { clean, fold } from './text.ts';

/** Spec 2026-10-08-management-cycle-design §3.4: a plan's parallel lines of work. */
export const MAX_STREAMS = 12;
const ID_MAX = 32;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OWNER_HELP = 'ofisteki bir çalışanın adı ya da kimliği (officeStatus), ya da işe alınacaksa “alınacak: <rol>”';

/**
 * A plan's streams as the coordinator gave them, checked: each a short lowercase slug unique in the plan, a title, an
 * owner — someone in the office, stored by id (`person` is the office's lookup by id or name, null for no one), or
 * `alınacak: <rol>` — and the ids of the plan's streams it waits for, with no cycle. Absent: none.
 */
export function checkStreams(value: unknown, person: (who: string) => Employee | null): PlanStream[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError('Akışlar (streams) bir liste olmalı: her biri id, title, owner ve dependsOn ile.');
  if (value.length > MAX_STREAMS) throw new ValidationError(`Bir planda en fazla ${MAX_STREAMS} akış olabilir; küçük parçaları bir akışta topla.`);
  const streams: PlanStream[] = [];
  for (const raw of value as unknown[]) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ValidationError('Her akış bir nesne olmalı: id, title, owner, dependsOn.');
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    if (!ID.test(id) || id.length > ID_MAX) {
      throw new ValidationError(`Akış kimliği (id) kısa, küçük harfli bir kısaltma olmalı (a-z, 0-9 ve tire; en fazla ${ID_MAX} karakter): “${String(r.id ?? '')}”.`);
    }
    if (streams.some((s) => s.id === id)) throw new ValidationError(`Aynı kimlikle iki akış var: “${id}”.`);
    const title = clean(typeof r.title === 'string' ? r.title : undefined, `“${id}” akışının başlığı`, 120, true);
    const owner = ownerOf(id, typeof r.owner === 'string' ? r.owner : '', person);
    const deps = r.dependsOn ?? [];
    if (!Array.isArray(deps) || deps.some((d) => typeof d !== 'string')) {
      throw new ValidationError(`“${id}” akışının bağımlılıkları (dependsOn) aynı plandaki akışların kimliklerinden oluşan bir liste olmalı.`);
    }
    const dependsOn = [...new Set((deps as string[]).map((d) => d.trim()).filter(Boolean))];
    if (dependsOn.includes(id)) throw new ValidationError(`“${id}” akışı kendine bağlı olamaz.`);
    streams.push({ id, title, owner, dependsOn });
  }
  const ids = new Set(streams.map((s) => s.id));
  for (const s of streams) {
    const missing = s.dependsOn.find((d) => !ids.has(d));
    if (missing) throw new ValidationError(`“${s.id}” akışı bu planda olmayan bir akışa bağlı: “${missing}”.`);
  }
  const cycle = cycleOf(streams);
  if (cycle) throw new ValidationError(`Akış bağımlılıklarında döngü var: ${cycle.join(' → ')}. Bir akış ancak kendisinden önce bitebilecek akışlara bağlanabilir.`);
  return streams;
}

/** `alınacak: <rol>` in one spelling, or the id of the person named. */
function ownerOf(id: string, given: string, person: (who: string) => Employee | null): string {
  const text = given.trim();
  if (!text) throw new ValidationError(`“${id}” akışının sahibi (owner) boş olamaz: ${OWNER_HELP}.`);
  const colon = text.indexOf(':');
  if (colon >= 0 && fold(text.slice(0, colon).trim()) === fold(STREAM_TO_HIRE)) {
    const role = clean(text.slice(colon + 1).replace(/\s+/g, ' '), `“${id}” akışının alınacak rolü`, 80, false);
    if (!role) throw new ValidationError(`“${id}” akışının sahibi alınacak biriyse rolünü de yaz: “alınacak: <rol>”.`);
    return `${STREAM_TO_HIRE}: ${role}`;
  }
  const found = person(text);
  if (!found) throw new ValidationError(`“${id}” akışının sahibi bulunamadı: ${text}. Sahip ${OWNER_HELP} olmalı.`);
  return found.id;
}

/** The first dependency cycle, as the ids along it back to where it started (a → b → a); null: none. */
function cycleOf(streams: PlanStream[]): string[] | null {
  const deps = new Map(streams.map((s) => [s.id, s.dependsOn]));
  const state = new Map<string, 'open' | 'closed'>();
  const path: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === 'closed') return null;
    if (state.get(id) === 'open') return [...path.slice(path.indexOf(id)), id];
    state.set(id, 'open');
    path.push(id);
    for (const dep of deps.get(id) ?? []) {
      const found = visit(dep);
      if (found) return found;
    }
    path.pop();
    state.set(id, 'closed');
    return null;
  };
  for (const s of streams) {
    const found = visit(s.id);
    if (found) return found;
  }
  return null;
}
