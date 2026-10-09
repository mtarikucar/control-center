import { afterEach, describe, expect, it } from 'vitest';
import { TokenRegistry } from '../src/mcp/tokens.ts';
import { fakeEngine, readArgv } from './engine-helpers.ts';
import { setup, until } from './helpers.ts';

/** B9a K1-5: a session the gate watches gets the hook in its settings and the gate's address and its own token in its environment. */

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const settingsOf = (args: string[]) => JSON.parse(args[args.indexOf('--settings') + 1]!) as { hooks?: unknown; disableAllHooks?: boolean };
const bearerOf = (args: string[]) => /Bearer ([0-9a-f]+)/.exec(args[args.indexOf('--mcp-config') + 1]!)![1];

describe('Engine — the gate in a session (B9a)', () => {
  it('the hook in --settings; OFFICE_GATE_URL and OFFICE_GATE_TOKEN (the same token as the office tools of this session) in its environment', async () => {
    const s = setup();
    const tokens = new TokenRegistry();
    const f = fakeEngine(s, { engine: { mcp: { url: () => 'http://127.0.0.1:9/mcp', tokens }, gate: { url: () => 'http://127.0.0.1:9/gate/check', hook: 'node /r/gate.mjs' } } });
    cleanups.push(f.cleanup, s.cleanup);
    const ada = f.engine.hire({ name: 'Ada', role: 'r' });
    const [entry] = await readArgv(f.argvLog, 1);
    expect(settingsOf(entry!.args)).toMatchObject({ disableAllHooks: false, hooks: { PreToolUse: [expect.objectContaining({ hooks: [expect.objectContaining({ command: 'node /r/gate.mjs' })] })] } });
    expect(entry!.gate).toEqual({ url: 'http://127.0.0.1:9/gate/check', token: bearerOf(entry!.args) });
    expect(tokens.resolve(entry!.gate!.token!)).toBe(ada.id);
  });

  it('without the gate (a v1 office, tests): no hook and nothing in the environment', async () => {
    const s = setup();
    const f = fakeEngine(s, { engine: { mcp: { url: () => 'http://127.0.0.1:9/mcp', tokens: new TokenRegistry() } } });
    cleanups.push(f.cleanup, s.cleanup);
    f.engine.hire({ name: 'Ada', role: 'r' });
    const [entry] = await readArgv(f.argvLog, 1);
    expect(settingsOf(entry!.args).hooks).toBeUndefined();
    expect(entry!.gate).toEqual({ url: null, token: null });
  });

  /** The environment of an office started inside another office's session: that office's gate address and token. */
  const OUTER = { OFFICE_GATE_URL: 'http://127.0.0.1:4319/gate/check', OFFICE_GATE_TOKEN: 'disaridaki-ofisin-jetonu' };

  it('an office started inside another office’s session (an employee’s `pnpm test`, a rehearsal): without its own gate, neither a session nor a side question gets the outer office’s gate address or token', async () => {
    const s = setup();
    const f = fakeEngine(s, { env: OUTER, engine: { mcp: { url: () => 'http://127.0.0.1:9/mcp', tokens: new TokenRegistry() } } });
    cleanups.push(f.cleanup, s.cleanup);
    const ada = f.engine.hire({ name: 'Ada', role: 'r' });
    const [session] = await readArgv(f.argvLog, 1);
    expect(session!.gate).toEqual({ url: null, token: null });
    // A side question runs a claude of its own (`--output-format json`; the session's is stream-json): the same environment.
    f.engine.send(ada.id, 'merhaba', 'owner');
    await until(() => s.events.list({ employeeId: ada.id, limit: 100 }).some((e) => e.event.type === 'turn.finished'), 8000);
    expect((await f.engine.sideQuestion(ada.id, 'ne yapıyorsun?')).ok).toBe(true);
    const side = (await readArgv(f.argvLog, 2)).filter((a) => a.args[a.args.indexOf('--output-format') + 1] === 'json');
    expect(side.map((a) => a.gate)).toEqual([{ url: null, token: null }]);
  });

  it('with its own gate a session gets its own office’s address and token, never the outer office’s', async () => {
    const s = setup();
    const tokens = new TokenRegistry();
    const f = fakeEngine(s, { env: OUTER, engine: { mcp: { url: () => 'http://127.0.0.1:9/mcp', tokens }, gate: { url: () => 'http://127.0.0.1:9/gate/check', hook: 'node /r/gate.mjs' } } });
    cleanups.push(f.cleanup, s.cleanup);
    const ada = f.engine.hire({ name: 'Ada', role: 'r' });
    const [entry] = await readArgv(f.argvLog, 1);
    expect(entry!.gate).toEqual({ url: 'http://127.0.0.1:9/gate/check', token: bearerOf(entry!.args) });
    expect(tokens.resolve(entry!.gate!.token!)).toBe(ada.id);
  });
});
