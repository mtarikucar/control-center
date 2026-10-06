import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Employee } from '@cc/shared';

export function deskDir(dataDir: string, slug: string): string {
  return join(dataDir, 'desks', slug);
}

export function roleCard(e: Pick<Employee, 'name' | 'role'>): string {
  return `# ${e.name}

Sen bu ofiste çalışan ${e.name} adlı bir çalışansın. Bu klasör senin masan: dosyalarını burada tutar,
işlerini burada yaparsın. Ofisin sahibi seninle ofis ekranından konuşur.

## Rolün

${e.role}
`;
}

/** Idempotent: creates the desk and its role card once; never overwrites a card the owner edited. */
export function prepareDesk(dataDir: string, e: Employee): string {
  const dir = deskDir(dataDir, e.slug);
  mkdirSync(dir, { recursive: true });
  const card = join(dir, 'CLAUDE.md');
  if (!existsSync(card)) writeFileSync(card, roleCard(e));
  return dir;
}
