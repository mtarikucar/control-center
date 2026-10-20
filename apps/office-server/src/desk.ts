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

/** Each desk's department block (spec departments §5.4): rewritten on every change, imported by the card once. */
export const DEPARTMENT_FILE = 'department.md';
const DEPARTMENT_IMPORT = `@${DEPARTMENT_FILE}`;

/**
 * The owner's special contacts on the desk of someone who sends, publishes, calls or invites (final review I4.2):
 * rewritten on every change, imported by the card once; the file carries its own heading, so an emptied one shows
 * nothing.
 */
export const SPECIAL_CONTACTS_FILE = 'special-contacts.md';
const SPECIAL_CONTACTS_IMPORT = `@${SPECIAL_CONTACTS_FILE}`;

/** The owner's release policy on every desk (release-policy.ts): rewritten on every change, imported by the card once. */
export const RELEASE_POLICY_FILE = 'release-policy.md';
const RELEASE_POLICY_IMPORT = `@${RELEASE_POLICY_FILE}`;

/** The card imports the desk's blocks it has (a card written anew, or one from before them). */
function keepImports(dir: string): void {
  const card = join(dir, 'CLAUDE.md');
  if (!existsSync(card)) return;
  if (existsSync(join(dir, DEPARTMENT_FILE)) && !readFileSync(card, 'utf8').includes(DEPARTMENT_IMPORT)) appendFileSync(card, `\n## Departman\n\n${DEPARTMENT_IMPORT}\n`);
  if (existsSync(join(dir, SPECIAL_CONTACTS_FILE)) && !readFileSync(card, 'utf8').includes(SPECIAL_CONTACTS_IMPORT)) appendFileSync(card, `\n${SPECIAL_CONTACTS_IMPORT}\n`);
  if (existsSync(join(dir, RELEASE_POLICY_FILE)) && !readFileSync(card, 'utf8').includes(RELEASE_POLICY_IMPORT)) appendFileSync(card, `\n${RELEASE_POLICY_IMPORT}\n`);
}

export function writeReleasePolicyFile(dataDir: string, slug: string, text: string): void {
  const dir = deskDir(dataDir, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, RELEASE_POLICY_FILE), text);
  keepImports(dir);
}

export function writeDepartmentFile(dataDir: string, slug: string, text: string): void {
  const dir = deskDir(dataDir, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, DEPARTMENT_FILE), text);
  keepImports(dir);
}

export function writeSpecialContactsFile(dataDir: string, slug: string, text: string): void {
  const dir = deskDir(dataDir, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, SPECIAL_CONTACTS_FILE), text);
  keepImports(dir);
}

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
  keepImports(dir);
  writeFileSync(join(dir, GUIDE_FILE), guideText(e.kind));
  const handoff = '@provider-handoff.md';
  if (existsSync(join(dir, 'provider-handoff.md')) && !readFileSync(card, 'utf8').includes(handoff)) appendFileSync(card, `\n## Sağlayıcı devri\n\n${handoff}\n`);
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
  keepImports(dir);
  writeFileSync(join(dir, GUIDE_FILE), guideText(e.kind));
}
