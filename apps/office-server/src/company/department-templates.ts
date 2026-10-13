import { readdirSync, readFileSync } from 'node:fs';
import { WORK_TYPES, type DepartmentRole, type DepartmentTemplate, type WorkType } from '@cc/shared';
import { ValidationError } from '../errors.ts';
import { listRoleTemplates } from './role-templates.ts';

/**
 * The department template catalog (spec 2026-10-13-departments §4): product knowledge, shipped as files in
 * craft/departments, never written to the database. The same narrow front matter as the role templates (B6).
 */

const DIR = new URL('./craft/departments/', import.meta.url);
const SCALARS = ['id', 'version', 'name', 'mission', 'head'] as const;
const LISTS = ['roles', 'methods', 'routines', 'checks', 'kpis'] as const;
const SECTIONS = ['### Yapar', '### Yapmaz', '### Sana gelir'] as const;

export function parseDepartmentTemplate(id: string, text: string): DepartmentTemplate {
  text = text.replaceAll('\r\n', '\n');
  const fail = (why: string) => new ValidationError(`Departman şablonu ${id}: ${why}`);
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) throw fail('ön bilgi bloğu yok (--- ile başlayıp --- ile bitmeli).');
  const scalars: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  let open: string | null = null;
  for (const line of match[1]!.split('\n')) {
    if (!line.trim()) continue;
    const item = /^- (.+)$/.exec(line);
    if (item) {
      if (open === null) throw fail(`“${line}” bir listeye ait değil.`);
      lists[open]!.push(item[1]!.trim());
      continue;
    }
    const pair = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!pair) throw fail(`okunamayan satır: “${line}”.`);
    const [, key, value] = pair as unknown as [string, string, string];
    if (!(SCALARS as readonly string[]).includes(key) && !(LISTS as readonly string[]).includes(key)) throw fail(`“${key}” bilinmeyen alan.`);
    if ((LISTS as readonly string[]).includes(key)) {
      lists[key] = [];
      open = key;
    } else {
      scalars[key] = value.trim();
      open = null;
    }
  }
  for (const key of SCALARS) if (!scalars[key]) throw fail(`“${key}” eksik.`);
  for (const key of LISTS) if (!lists[key]?.length) throw fail(`“${key}” eksik.`);
  if (scalars.id !== id) throw fail(`id “${scalars.id}” dosya adıyla aynı olmalı.`);
  const version = Number(scalars.version);
  if (!Number.isInteger(version) || version < 1) throw fail('version pozitif bir tam sayı olmalı.');
  const roleIds = new Set(listRoleTemplates().map((t) => t.id));
  if (!roleIds.has(scalars.head!)) throw fail(`başkanın rol şablonu “${scalars.head}” katalogda yok.`);
  const roles: DepartmentRole[] = lists.roles!.map((item) => {
    const colon = item.indexOf(':');
    const template = (colon < 0 ? item : item.slice(0, colon)).trim();
    const when = colon < 0 ? '' : item.slice(colon + 1).trim();
    if (!when) throw fail(`“${template}” maddesi “<şablon>: <ne zaman>” biçiminde olmalı.`);
    if (!roleIds.has(template)) throw fail(`önerilen rol şablonu “${template}” katalogda yok.`);
    return { template, when };
  });
  const unknownMethod = lists.methods!.find((m) => !(WORK_TYPES as readonly string[]).includes(m));
  if (unknownMethod) throw fail(`bilinmeyen yöntem “${unknownMethod}”.`);
  const body = match[2]!.trim();
  const missing = SECTIONS.find((h) => !body.includes(h));
  if (missing) throw fail(`gövdede “${missing}” yok.`);
  return {
    id, version, name: scalars.name!, mission: scalars.mission!, head: scalars.head!, roles, methods: lists.methods as WorkType[],
    routines: lists.routines!, checks: lists.checks!, kpis: lists.kpis!, body,
  };
}

/** The whole catalog, by id. */
export function listDepartmentTemplates(): DepartmentTemplate[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => parseDepartmentTemplate(f.slice(0, -3), readFileSync(new URL(f, DIR), 'utf8')));
}

export function departmentTemplate(id: unknown): DepartmentTemplate {
  const all = listDepartmentTemplates();
  const found = all.find((t) => t.id === id);
  if (!found) throw new ValidationError(`Bilinmeyen departman şablonu: ${String(id)}. Şablonlar: ${all.map((t) => t.id).join(', ')}.`);
  return found;
}

/** The scope text a department opened from the template keeps: its body, then the checks, measures, routines and roles. */
export function templateScope(t: DepartmentTemplate): string {
  const bullets = (items: string[]) => items.map((i) => `- ${i}`).join('\n');
  const titles = new Map(listRoleTemplates().map((r) => [r.id, r.title]));
  const roles = t.roles.map((r) => `- ${r.template} (${titles.get(r.template) ?? r.template}): ${r.when}`).join('\n');
  return [t.body, `### Kalite kontrolleri\n\n${bullets(t.checks)}`, `### Ölçüler\n\n${bullets(t.kpis)}`, `### Rutin önerileri\n\n${bullets(t.routines)}`, `### Önerilen roller\n\n${roles}`].join('\n\n');
}

/** The text under `### <heading>` up to the next `###` heading; '' when the scope has none (a custom department's free text). */
export function scopeSection(scope: string, heading: string): string {
  const lines = scope.replaceAll('\r\n', '\n').split('\n');
  const start = lines.findIndex((l) => l.trim() === `### ${heading}`);
  if (start < 0) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('### '));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
}
