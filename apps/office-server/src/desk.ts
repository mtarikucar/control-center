import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Employee } from '@cc/shared';
import { BRIEF_FILE, readBrief } from './company/brief.ts';
import { officeGuide } from './company/roles.ts';

export function deskDir(dataDir: string, slug: string): string {
  return join(dataDir, 'desks', slug);
}

const BRIEF_IMPORT = `@${BRIEF_FILE}`;

export function roleCard(e: Pick<Employee, 'name' | 'role' | 'title' | 'team' | 'kind'>): string {
  return `# ${e.name}${e.title ? ` — ${e.title}` : ''}

Sen bu ofiste çalışan ${e.name} adlı bir çalışansın${e.team ? `; ekibin: ${e.team}` : ''}. Bu klasör senin masan: dosyalarını
burada tutar, işlerini burada yaparsın.

## Rolün

${e.role}

## Ofiste nasıl çalışırsın

${officeGuide(e.kind)}

## Şirket

${BRIEF_IMPORT}
`;
}

/**
 * Idempotent: creates the desk and its role card once (never overwrites a card the owner or coordinator edited),
 * keeps the desk's copy of the company brief current, and gives a card from before the company its brief import.
 */
export function prepareDesk(dataDir: string, e: Employee): string {
  const dir = deskDir(dataDir, e.slug);
  mkdirSync(dir, { recursive: true });
  const card = join(dir, 'CLAUDE.md');
  if (!existsSync(card)) writeFileSync(card, roleCard(e));
  else if (!readFileSync(card, 'utf8').includes(BRIEF_IMPORT)) appendFileSync(card, `\n## Şirket\n\n${BRIEF_IMPORT}\n`);
  writeFileSync(join(dir, BRIEF_FILE), readBrief(dataDir));
  return dir;
}

/** The coordinator changed someone's role card (or made them coordinator): write it out again. */
export function writeRoleCard(dataDir: string, e: Employee): void {
  const dir = deskDir(dataDir, e.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'CLAUDE.md'), roleCard(e));
}
