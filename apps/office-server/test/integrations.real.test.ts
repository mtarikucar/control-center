import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sessionArgs } from '../src/claude/args.ts';
import { normalize } from '../src/claude/normalize.ts';
import { IntegrationRegistry } from '../src/company/integrations.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup, tempDir } from './helpers.ts';

const enabled = process.env.OFFICE_SMOKE === '1';
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

/** The system/init of a real session opened in `cwd` with the office's arguments; the process is killed right after it. */
async function realInit(cwd: string): Promise<Record<string, unknown> | null> {
  const child = spawn('claude', sessionArgs({ model: 'haiku', sessionId: crypto.randomUUID(), resume: false }), { cwd, stdio: ['pipe', 'pipe', 'ignore'] });
  let init: Record<string, unknown> | null = null;
  const done = new Promise<void>((resolve) => {
    let buf = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      for (const line of buf.split('\n')) {
        try {
          const o = JSON.parse(line) as Record<string, unknown>;
          if (o.type === 'system' && o.subtype === 'init') {
            init = o;
            resolve();
          }
        } catch {
          // partial line
        }
      }
    });
  });
  // The init comes with the first message and tells the connections as they stand then: let the servers connect first
  // (written at once, every server is still `pending` and no MCP tool is listed; k3-init-stream.txt).
  await new Promise((r) => setTimeout(r, 8_000));
  child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: 'Reply with the single word ok.' } })}\n`);
  await Promise.race([done, new Promise((r) => setTimeout(r, 90_000))]);
  child.kill('SIGKILL');
  return init;
}

describe.skipIf(!enabled)('the integration registry with the real claude CLI (review, Kerem round 1)', () => {
  it('a desk whose .claude/settings.json denies a connector: the session keeps it connected with no tools, and the registry shows it shut there', async () => {
    const desk = tempDir();
    mkdirSync(join(desk, '.claude'), { recursive: true });
    // Pilot 0's closed mode, the same file shape: server-level deny rules in the desk's project settings.
    writeFileSync(join(desk, '.claude', 'settings.json'), JSON.stringify({ permissions: { deny: ['mcp__cad', 'mcp__claude_ai_Gmail'] } }, null, 2));
    const init = await realInit(desk);
    expect(init).not.toBeNull();
    const [event] = normalize(init);
    expect(event?.type).toBe('session.started');
    const s = setup();
    const f = fakeEngine(s);
    cleanups.push(f.cleanup, s.cleanup);
    const c = companyFor(s, f, ['coder']);
    const ada = c.company.hire(c.company.hireCoordinator().id, { name: 'Ada', role: 'r' });
    s.events.append(ada.id, event!);
    const registry = new IntegrationRegistry({ db: s.db, roster: s.roster, events: s.events });
    const desks = (name: string) => registry.get(name).desks.filter((d) => d.employeeId === ada.id);
    const mcp = (event as { mcp: Array<{ name: string; status: string; tools?: number }> }).mcp;
    console.log(`GERÇEK INIT: claude ${String(init!.claude_code_version)}, ${mcp.length} sunucu; cad ${JSON.stringify(mcp.find((m) => m.name === 'cad'))}, blender ${JSON.stringify(mcp.find((m) => m.name === 'blender'))}, Gmail ${JSON.stringify(mcp.find((m) => m.name === 'claude.ai Gmail'))}`);
    // Denied: connected, none of its tools in the session, shut on this desk because of the desk.
    expect(desks('cad')).toEqual([expect.objectContaining({ status: 'denied', raw: 'connected', tools: 0, open: false, closedBy: 'desk' })]);
    // Not denied, the same kind of server: connected with its tools, open.
    expect(desks('blender')).toEqual([expect.objectContaining({ status: 'connected', open: true, closedBy: null })]);
    expect(desks('blender')[0]!.tools).toBeGreaterThan(0);
    // claude.ai connectors may still be connecting at init: when Gmail is connected, it is denied too.
    const gmail = mcp.find((m) => m.name === 'claude.ai Gmail');
    if (gmail?.status === 'connected') expect(desks('claude.ai Gmail')).toEqual([expect.objectContaining({ status: 'denied', tools: 0, open: false })]);
  }, 120_000);
});
