import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Employee } from '@cc/shared';
import { BRIEF_FILE } from '../company/brief.ts';
import { GUIDE_FILE, prepareDesk } from '../desk.ts';

/** Codex does not interpret Claude's @file imports: put the role, guide and brief into a native AGENTS.md. */
export function prepareCodexDesk(dataDir: string, e: Employee): string {
  const cwd = prepareDesk(dataDir, e);
  const role = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8')
    .replaceAll(`@${GUIDE_FILE}`, readFileSync(join(cwd, GUIDE_FILE), 'utf8'))
    .replaceAll(`@${BRIEF_FILE}`, readFileSync(join(cwd, BRIEF_FILE), 'utf8'))
    .replaceAll('@provider-handoff.md', existsSync(join(cwd, 'provider-handoff.md')) ? readFileSync(join(cwd, 'provider-handoff.md'), 'utf8') : '');
  writeFileSync(join(cwd, 'AGENTS.md'), `${role}\n\nBu ofis Codex ile çalışır. Model adları yerine çalışma düzeyleri kullanılır: haiku=düşük, sonnet=dengeli, opus=yüksek, fable=en yüksek (modelin desteklediği düzeylerde). Ofis araçları mcp__office__ önekiyle sunulur.\n`);
  return cwd;
}

export function codexTerminalCommand(cwd: string, threadId: string): string {
  // Produce a command for the owner's native shell without executing it here.
  if (process.platform === 'win32') return `Set-Location -LiteralPath '${cwd.replaceAll("'", "''")}'; codex resume '${threadId.replaceAll("'", "''")}'`;
  const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
  return `cd ${quote(cwd)} && codex resume ${quote(threadId)}`;
}
