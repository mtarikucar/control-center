import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Employee, EmployeeKind } from '@cc/shared';
import { BRIEF_FILE, readBrief } from './company/brief.ts';
import { officeGuide } from './company/roles.ts';

export function deskDir(dataDir: string, slug: string): string {
  return join(dataDir, 'desks', slug);
}

/** The office's working rules for one kind of employee, kept current on every desk (headless claude imports only from the desk). */
export const GUIDE_FILE = 'office-guide.md';
const GUIDE_IMPORT = `@${GUIDE_FILE}`;
const BRIEF_IMPORT = `@${BRIEF_FILE}`;

export function guideText(kind: EmployeeKind): string {
  return `# Ofiste nasıl çalışırsın\n\n${officeGuide(kind)}\n`;
}

export function roleCard(e: Pick<Employee, 'name' | 'role' | 'title' | 'team' | 'kind'>): string {
  return `# ${e.name}${e.title ? ` — ${e.title}` : ''}

Sen bu ofiste çalışan ${e.name} adlı bir çalışansın${e.team ? `; ekibin: ${e.team}` : ''}. Bu klasör senin masan: dosyalarını
burada tutar, işlerini burada yaparsın.

## Rolün

${e.role}

## Ofiste nasıl çalışırsın

${GUIDE_IMPORT}

## Şirket

${BRIEF_IMPORT}
`;
}

/**
 * Idempotent: creates the desk and its role card once (never rewrites a card the owner or coordinator edited), gives a
 * card from before the company each import once, and refreshes the office guide and the brief copy on the desk.
 */
export function prepareDesk(dataDir: string, e: Employee): string {
  const dir = deskDir(dataDir, e.slug);
  mkdirSync(dir, { recursive: true });
  const card = join(dir, 'CLAUDE.md');
  if (!existsSync(card)) writeFileSync(card, roleCard(e));
  else {
    const text = readFileSync(card, 'utf8');
    if (!text.includes(GUIDE_IMPORT)) appendFileSync(card, `\n## Ofiste nasıl çalışırsın\n\n${GUIDE_IMPORT}\n`);
    if (!text.includes(BRIEF_IMPORT)) appendFileSync(card, `\n## Şirket\n\n${BRIEF_IMPORT}\n`);
  }
  writeFileSync(join(dir, GUIDE_FILE), guideText(e.kind));
  writeFileSync(join(dir, BRIEF_FILE), readBrief(dataDir));
  return dir;
}

/**
 * Closes tools on a desk (B5's closed mode, pilot §8): the deny rules go into the desk's .claude/settings.json, which
 * a session opened there reads at start. An existing file keeps its other keys and rules; the given ones are added.
 */
export function writeDeskDeny(dataDir: string, slug: string, deny: string[]): void {
  const dir = join(deskDir(dataDir, slug), '.claude');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'settings.json');
  const settings = (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}) as { permissions?: { deny?: string[] } & Record<string, unknown> } & Record<string, unknown>;
  const rules = [...(settings.permissions?.deny ?? [])];
  for (const rule of deny) if (!rules.includes(rule)) rules.push(rule);
  writeFileSync(file, `${JSON.stringify({ ...settings, permissions: { ...settings.permissions, deny: rules } }, null, 2)}\n`);
}

/** The coordinator changed someone's role card (or their kind): write the card and their guide out again. */
export function writeRoleCard(dataDir: string, e: Employee): void {
  const dir = deskDir(dataDir, e.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'CLAUDE.md'), roleCard(e));
  writeFileSync(join(dir, GUIDE_FILE), guideText(e.kind));
}
