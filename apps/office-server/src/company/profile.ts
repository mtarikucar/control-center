import { PROFILE_SECTIONS, PROFILE_SPEC, type CompanyProfile, type ProfileEntry, type ProfileFieldKind, type ProfileFields, type ProfileSection, type ProfileValue } from '@cc/shared';
import { ValidationError } from '../errors.ts';
import { clean, lines } from './text.ts';

const TEXT_MAX = 1000;
const LIST_MAX = 20;
const ITEM_MAX = 300;

export function profileSection(value: unknown): ProfileSection {
  if (typeof value !== 'string' || !(PROFILE_SECTIONS as readonly string[]).includes(value)) {
    throw new ValidationError(`Bilinmeyen profil bölümü: ${String(value)}. Bölümler: ${PROFILE_SECTIONS.join(', ')}.`);
  }
  return value as ProfileSection;
}

/** One field's value checked; null when it is to be removed (null, empty text, empty list). */
function fieldValue(field: { label: string; kind: ProfileFieldKind }, raw: unknown): ProfileValue | null {
  if (raw === null || raw === undefined) return null;
  if (field.kind === 'text') {
    if (typeof raw !== 'string') throw new ValidationError(`${field.label} metin olmalı.`);
    return clean(raw, field.label, TEXT_MAX, false) || null;
  }
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string')) throw new ValidationError(`${field.label} bir liste olmalı (metinler).`);
  const items = lines(raw as string[], field.label, LIST_MAX, ITEM_MAX);
  return items.length ? items : null;
}

/**
 * A section after an update: the given fields replace theirs, null / empty text / empty list remove them, the rest
 * stay. Unknown fields and wrong values are refused. Keys come out in the section's own order, so that equal contents
 * are equal JSON.
 */
export function mergeProfile(section: ProfileSection, current: ProfileFields, patch: unknown): ProfileFields {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    throw new ValidationError('Profilde alanlar (fields) bir nesne olmalı: alan adı → metin ya da metin listesi.');
  }
  const spec = PROFILE_SPEC[section];
  const next: ProfileFields = { ...current };
  for (const [key, raw] of Object.entries(patch)) {
    if (!Object.hasOwn(spec.fields, key)) throw new ValidationError(`${spec.label} bölümünde “${key}” alanı yok. Alanlar: ${Object.keys(spec.fields).join(', ')}.`);
    const value = fieldValue(spec.fields[key]!, raw);
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return Object.fromEntries(Object.keys(spec.fields).flatMap((k) => (next[k] === undefined ? [] : [[k, next[k]]])));
}

/** What each section holds, for the tools' descriptions: `identity (Kimlik): name, sector, …, languages[]`. */
export function profileFieldsHelp(): string {
  return PROFILE_SECTIONS.map((s) => {
    const spec = PROFILE_SPEC[s];
    return `${s} (${spec.label}): ${Object.entries(spec.fields).map(([k, f]) => (f.kind === 'list' ? `${k}[]` : k)).join(', ')}`;
  }).join('; ');
}

function sectionText(section: ProfileSection, entry: ProfileEntry | undefined): string {
  const spec = PROFILE_SPEC[section];
  if (!entry || Object.keys(entry.fields).length === 0) return `## ${spec.label}${entry?.assumed ? ' (varsayım)' : ''}\nboş`;
  const rows = Object.entries(entry.fields).map(([k, v]) => `- ${spec.fields[k]?.label ?? k}: ${Array.isArray(v) ? v.join('; ') : v}`);
  return [`## ${spec.label}${entry.assumed ? ' (varsayım)' : ''}`, ...rows].join('\n');
}

/** The profile as profileRead shows it: every section (or one), the empty ones as empty, the assumed ones marked. */
export function profileText(p: CompanyProfile, only?: ProfileSection): string {
  const head = p.version === 0 ? 'Şirket profili henüz boş: bölümleri koordinatör profileUpdate ile doldurur.' : `# Şirket profili (sürüm ${p.version})`;
  const sections = only ? [only] : [...PROFILE_SECTIONS];
  return [head, ...sections.map((s) => sectionText(s, p.sections[s]))].join('\n\n');
}

/** A section's versions, newest first, with who wrote each and when. */
export function profileHistoryText(section: ProfileSection, entries: ProfileEntry[], nameOf: (id: string) => string): string {
  const label = PROFILE_SPEC[section].label;
  if (entries.length === 0) return `${label} bölümü henüz hiç yazılmadı.`;
  const rows = entries.map((e) => `• sürüm ${e.version}, ${nameOf(e.by)}, ${new Date(e.ts).toLocaleString('tr-TR')}${e.assumed ? ' (varsayım)' : ''}: ${JSON.stringify(e.fields)}`);
  return [`# Şirket profili — ${label} geçmişi (yeniden eskiye)`, ...rows].join('\n');
}
