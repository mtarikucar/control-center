import { readdirSync, readFileSync } from 'node:fs';
import { MODEL_ALIASES, WORK_TYPES, type ModelAlias, type RoleTemplate, type WorkType } from '@cc/shared';
import { ValidationError } from '../errors.ts';

/**
 * The role template catalog (B6; spec 2026-10-08-role-templates-design): product knowledge, shipped as files in
 * craft/roles, never written to the database. Each file is a narrow front matter block and a Markdown body.
 */

const DIR = new URL('./craft/roles/', import.meta.url);
const SCALARS = ['id', 'version', 'title', 'team', 'model', 'summary'] as const;
const LISTS = ['capabilities', 'methods', 'checks', 'kpis'] as const;
const SECTIONS = ['### Sorumlulukların', '### Nasıl çalışırsın', '### Bitti ne demek'] as const;

/**
 * One template from its file text. The front matter takes `key: value` and `key:` followed by `- item` lines only;
 * an unknown or missing field, a model or method the office does not have, a wrong id or a missing section is refused.
 */
export function parseRoleTemplate(id: string, text: string): RoleTemplate {
  const fail = (why: string) => new ValidationError(`Rol şablonu ${id}: ${why}`);
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
  if (!(MODEL_ALIASES as readonly string[]).includes(scalars.model!)) throw fail(`model ${MODEL_ALIASES.join(', ')} olmalı.`);
  const unknownMethod = lists.methods!.find((m) => !(WORK_TYPES as readonly string[]).includes(m));
  if (unknownMethod) throw fail(`bilinmeyen yöntem “${unknownMethod}”.`);
  const body = match[2]!.trim();
  const missing = SECTIONS.find((h) => !body.includes(h));
  if (missing) throw fail(`gövdede “${missing}” yok.`);
  return {
    id, version, title: scalars.title!, team: scalars.team!, model: scalars.model as ModelAlias, summary: scalars.summary!,
    capabilities: lists.capabilities!, methods: lists.methods as WorkType[], checks: lists.checks!, kpis: lists.kpis!, body,
  };
}

/** The whole catalog, by id. */
export function listRoleTemplates(): RoleTemplate[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => parseRoleTemplate(f.slice(0, -3), readFileSync(new URL(f, DIR), 'utf8')));
}

export function roleTemplate(id: unknown): RoleTemplate {
  const all = listRoleTemplates();
  const found = all.find((t) => t.id === id);
  if (!found) throw new ValidationError(`Bilinmeyen rol şablonu: ${String(id)}. Şablonlar: ${all.map((t) => t.id).join(', ')}.`);
  return found;
}

/**
 * The role text a template gives, under the role card's "## Rolün": the summary, the body, the checks and the
 * measures; then, when given, the company's own part (brand voice, channels, language, limits).
 */
export function templateRole(t: RoleTemplate, own?: string): string {
  const bullets = (items: string[]) => items.map((i) => `- ${i}`).join('\n');
  const parts = [t.summary, t.body, `### Kalite kontrollerin\n\n${bullets(t.checks)}`, `### Seni neyle ölçeriz\n\n${bullets(t.kpis)}`];
  const extra = own?.trim();
  if (extra) parts.push(`### Bu şirkette\n\n${extra}`);
  return parts.join('\n\n');
}
