import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { sessionArgs } from '../src/claude/args.ts';
import { normalize } from '../src/claude/normalize.ts';
import { coverage } from '../src/company/capabilities.ts';
import { IntegrationRegistry } from '../src/company/integrations.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup, tempDir } from './helpers.ts';
import { LOCKED_ARGS, LOCKED_TOOLS } from './real-session.ts';

const enabled = process.env.OFFICE_SMOKE === '1';
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const STUB = fileURLToPath(new URL('./fixtures/mcp-stub.mjs', import.meta.url));

/**
 * The system/init of a real session opened in `cwd` with the office's arguments, locked: only the given MCP servers
 * (--strict-mcp-config), the outward built-ins gone. The process is killed the moment the init arrives, before the
 * model answers anything.
 */
async function realInit(cwd: string, mcpConfig: string): Promise<Record<string, unknown> | null> {
  const args = [...LOCKED_ARGS, ...sessionArgs({ model: 'haiku', sessionId: crypto.randomUUID(), resume: false, mcpConfig })];
  const child = spawn('claude', args, { cwd, stdio: ['pipe', 'pipe', 'ignore'] });
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
            child.kill('SIGKILL');
            resolve();
          }
        } catch {
          // partial line
        }
      }
    });
  });
  // The init comes with the first message and tells the connections as they stand then: let the servers connect first.
  await new Promise((r) => setTimeout(r, 4_000));
  child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: 'Reply with the single word ok.' } })}\n`);
  await Promise.race([done, new Promise((r) => setTimeout(r, 90_000))]);
  child.kill('SIGKILL');
  return init;
}

describe.skipIf(!enabled)('the integration registry with the real claude CLI (review, Kerem round 1; locked, review of core 2)', () => {
  it('a desk whose .claude/settings.json denies a server: the session keeps it connected with no tools, and the registry shows it shut there — with no connector of the owner’s in the session', async () => {
    const desk = tempDir();
    mkdirSync(join(desk, '.claude'), { recursive: true });
    // Pilot 0's closed mode, the same file shape: a server-level deny rule in the desk's project settings.
    writeFileSync(join(desk, '.claude', 'settings.json'), JSON.stringify({ permissions: { deny: ['mcp__probe_shut'] } }, null, 2));
    // Two local servers of the test's own, each with one harmless tool; nothing else is let in.
    const mcpConfig = JSON.stringify({ mcpServers: { probe_open: { command: process.execPath, args: [STUB, 'probe_open'] }, probe_shut: { command: process.execPath, args: [STUB, 'probe_shut'] } } });
    const init = await realInit(desk, mcpConfig);
    expect(init).not.toBeNull();
    const servers = (init!.mcp_servers as Array<{ name: string; status: string }>).map((m) => `${m.name} ${m.status}`);
    const tools = init!.tools as string[];
    console.log(`GERÇEK INIT: claude ${String(init!.claude_code_version)}; sunucular: ${servers.join(', ')}; ${tools.length} araç: ${tools.join(', ')}`);
    // Only the expected servers in the session's own report; no MCP tool but the open stub's; none of the locked built-ins.
    expect((init!.mcp_servers as Array<{ name: string }>).map((m) => m.name).sort()).toEqual(['probe_open', 'probe_shut']);
    expect(tools.filter((t) => t.startsWith('mcp__'))).toEqual(['mcp__probe_open__ping']);
    for (const locked of LOCKED_TOOLS) expect(tools, locked).not.toContain(locked);
    const [event] = normalize(init);
    expect(event?.type).toBe('session.started');
    const s = setup();
    const f = fakeEngine(s);
    cleanups.push(f.cleanup, s.cleanup);
    const c = companyFor(s, f, ['coder']);
    const coordinator = c.company.hireCoordinator();
    const ada = c.company.hire(coordinator.id, { name: 'Ada', role: 'r' });
    s.events.append(ada.id, event!);
    const registry = new IntegrationRegistry({ db: s.db, roster: s.roster, events: s.events });
    const desks = (name: string) => registry.get(name).desks.filter((d) => d.employeeId === ada.id);
    // Denied: connected, none of its tools in the session, shut on this desk because of the desk.
    expect(desks('probe_shut')).toEqual([expect.objectContaining({ status: 'denied', raw: 'connected', tools: 0, open: false, closedBy: 'desk' })]);
    // Not denied, the same kind of server: connected with its tool, open.
    expect(desks('probe_open')).toEqual([expect.objectContaining({ status: 'connected', raw: 'connected', tools: 1, open: true, closedBy: null })]);
    expect(registry.list().map((i) => i.name).sort()).toEqual(['probe_open', 'probe_shut']);
    // B7: capabilities recorded on the two meet Ada's desk as her real session left it — open where the session has the
    // server's tools, shut by the desk where it has none.
    registry.register(coordinator.id, { name: 'probe_open', capabilities: ['email.read'] });
    registry.register(coordinator.id, { name: 'probe_shut', capabilities: ['email.send'] });
    const [read, send] = coverage(registry.list(), ['email.read', 'email.send'], ada.id);
    console.log(`GERÇEK INIT → YETENEK: email.read ${read!.status}, email.send ${send!.status} (${send!.providers.map((p) => `${p.name} ${p.desk?.status}/${p.desk?.closedBy}`).join(', ')})`);
    expect(read).toMatchObject({ status: 'open', providers: [expect.objectContaining({ name: 'probe_open', via: ['registry'], desk: expect.objectContaining({ open: true }) })] });
    expect(send).toMatchObject({ status: 'shut', providers: [expect.objectContaining({ name: 'probe_shut', via: ['registry'], desk: expect.objectContaining({ status: 'denied', closedBy: 'desk' }) })] });
  }, 120_000);
});
