import { request as httpRequest } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readArgv } from './engine-helpers.ts';
import { FAKE_CLAUDE, tempDir, until } from './helpers.ts';
import { pageHeaders } from './owner-helpers.ts';
import { sessionDeny } from '../src/company/session-deny.ts';
import { COST_CAP_USD, PILOT_MODEL, PILOT_STUBS, STEP_TIMEOUT_MS, STUB_CONFIG, pilotClassify, pilotCommand, pilotOffice, type PilotOffice } from './pilot-harness.ts';
import { LOCKED_ARGS, LOCKED_TOOLS } from './real-session.ts';

/**
 * The pilot K3's bounds (C5-4; pilot readiness §4 "Güvenlik sınırları"), checked here at K1 on what the sessions really
 * get: the harness is built with the fake CLI, which logs its arguments.
 */
const offices: PilotOffice[] = [];
afterEach(async () => {
  for (const o of offices.splice(0)) await o.stop();
});

const after = (args: string[], flag: string) => args.flatMap((a, i) => (a === flag ? [args[i + 1]!] : []));

/** A change as the office page sends it (pageHeaders). */
async function owner(port: number, path: string, body: unknown): Promise<{ status: number }> {
  const headers = { 'content-type': 'application/json', ...(await pageHeaders(port)) };
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method: 'POST', path, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

describe('pilot K3 — the bounds are fixed in the test (K1)', () => {
  it('every session starts locked: the lock’s arguments in full, then only the test’s two stubs, each the harmless stub', () => {
    const command = pilotCommand();
    expect(command[0]).toBe('claude');
    expect(command.slice(1, 1 + LOCKED_ARGS.length)).toEqual(LOCKED_ARGS);
    expect(LOCKED_ARGS[0]).toBe('--strict-mcp-config');
    for (const t of ['Bash', 'WebFetch', 'WebSearch', 'Write', 'Edit', 'Task', 'Skill']) expect(LOCKED_TOOLS).toContain(t);
    expect(after(command, '--mcp-config')).toEqual([STUB_CONFIG]);
    const servers = (JSON.parse(STUB_CONFIG) as { mcpServers: Record<string, { command: string; args: string[] }> }).mcpServers;
    expect(Object.keys(servers)).toEqual([...PILOT_STUBS]);
    for (const [name, server] of Object.entries(servers)) {
      expect(server.command).toBe(process.execPath);
      expect(server.args).toEqual([expect.stringMatching(/test\/fixtures\/mcp-stub\.mjs$/), name]);
    }
  });

  it('the sessions the office opens get exactly that, the office’s own server on 127.0.0.1, the pilot model, their own closed list and the gate’s hook as live', async () => {
    const state = tempDir('pilot-fake-');
    const argvLog = join(state, 'argv.jsonl');
    const o = await pilotOffice({ claude: [process.execPath, FAKE_CLAUDE], env: { ...process.env, FAKE_CLAUDE_STATE: state, FAKE_CLAUDE_ARGV_LOG: argvLog } });
    offices.push(o);
    const c = o.company.hireCoordinator();
    // A member the blueprint would hire on opus, from a template on sonnet: both run on the pilot model.
    o.company.hire(c.id, { name: 'Editör', role: 'r', model: 'opus' });
    o.company.hire(c.id, { name: 'Yazar', role: 'r', template: 'icerik-yazari' });
    const argv = await readArgv(argvLog, 3);
    for (const { args, gate } of argv) {
      expect(args.slice(0, LOCKED_ARGS.length)).toEqual(LOCKED_ARGS);
      const configs = after(args, '--mcp-config').map((c) => Object.keys((JSON.parse(c) as { mcpServers: Record<string, unknown> }).mcpServers));
      expect(configs).toEqual([[...PILOT_STUBS], ['office']]);
      const office = (JSON.parse(after(args, '--mcp-config')[1]!) as { mcpServers: { office: { url: string } } }).mcpServers.office.url;
      expect(office).toBe(`http://127.0.0.1:${o.port}/mcp`);
      expect(after(args, '--model')).toEqual([PILOT_MODEL]);
      expect(args).toContain('--disallowedTools');
      // B9a as main.ts wires it: the hook in the session's settings, asking this office with the session's own token.
      expect(args.some((a) => a.includes('hooks/gate.mjs'))).toBe(true);
      expect(gate?.url).toBe(`http://127.0.0.1:${o.port}/gate/check`);
      expect(gate?.token).toBeTruthy();
    }
    expect(o.roster.list().map((e) => e.model)).toEqual([PILOT_MODEL, PILOT_MODEL, PILOT_MODEL]);
  });

  it('a role hint keeps the pilot model: the owner’s word to the coordinator (a project start, fable by default) and the coordinator’s other turns (sonnet, opus) all run on it', async () => {
    const state = tempDir('pilot-fake-');
    const argvLog = join(state, 'argv.jsonl');
    const o = await pilotOffice({ claude: [process.execPath, FAKE_CLAUDE], env: { ...process.env, FAKE_CLAUDE_STATE: state, FAKE_CLAUDE_ARGV_LOG: argvLog } });
    offices.push(o);
    // The constitution's role models (management cycle §3.5) apply whatever the model policy says: every one is the pilot's.
    expect(o.budget.constitution().coordinatorModels).toEqual({ kickoff: PILOT_MODEL, cycle: PILOT_MODEL, routine: PILOT_MODEL });
    const c = o.company.hireCoordinator();
    await readArgv(argvLog, 1);
    const turns = () => o.events.list({ limit: 5000 }).filter((e) => e.employeeId === c.id && e.event.type === 'turn.finished').length;
    const before = turns();
    expect((await owner(o.port, `/api/employees/${c.id}/messages`, { text: 'Yeni bir proje: plan öner.' })).status).toBe(202);
    await until(() => turns() > before, 8000);
    const argv = await readArgv(argvLog, 1);
    expect(argv.map(({ args }) => after(args, '--model'))).toEqual(argv.map(() => [PILOT_MODEL]));
  });

  it('a throwaway data directory, never the live office’s', async () => {
    const o = await pilotOffice({ claude: [process.execPath, FAKE_CLAUDE], env: { ...process.env, FAKE_CLAUDE_STATE: tempDir('pilot-fake-') } });
    offices.push(o);
    expect(resolve(o.dataDir).startsWith(resolve(tmpdir()))).toBe(true);
    expect(resolve(o.dataDir).startsWith(resolve(homedir(), '.control-center'))).toBe(false);
  });

  it('the run stops past the cost ceiling ($0.50), earlier runs included, counting every turn result; the step limit is 600 s', async () => {
    expect(COST_CAP_USD).toBe(0.5);
    expect(STEP_TIMEOUT_MS).toBe(600_000);
    const o = await pilotOffice({ claude: [process.execPath, FAKE_CLAUDE], env: { ...process.env, FAKE_CLAUDE_STATE: tempDir('pilot-fake-') }, spentBefore: 0.1 });
    offices.push(o);
    const turn = (costUsd: number) =>
      o.events.append(null, { type: 'turn.finished', ok: true, subtype: 'success', usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }, costUsd, numTurns: 1, queuedTurns: 0, sessionUsage: null, sessionCostUsd: 0 });
    turn(0.3);
    turn(0.1);
    expect(o.checkCost()).toBeCloseTo(0.4);
    turn(0.0001);
    expect(() => o.checkCost()).toThrow(/Maliyet tavanı aşıldı: \$0\.1000 önceki \+ \$0\.4001 bu koşu > \$0\.5; koşu durduruldu\./);
  });

  it('B9b leaves the stubs’ tools open (a non-outward class here), so only the desk file closes probe_shut; real tools keep their class', () => {
    const stubs = PILOT_STUBS.map((s) => `mcp__${s}__ping`);
    const deny = sessionDeny({ capabilities: [], seen: [...stubs, 'mcp__plugin_x_x__other'], closedServers: [], classify: pilotClassify });
    for (const t of stubs) expect(deny).not.toContain(t);
    expect(deny).toContain('mcp__plugin_x_x__other');
    expect(pilotClassify('mcp__claude_ai_Gmail__send_message')).toEqual({ kind: 'classified', capability: 'email.send', outward: true });
    expect(pilotClassify('mcp__office__myTasks')).toEqual({ kind: 'office' });
  });
});

