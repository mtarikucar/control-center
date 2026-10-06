import { afterEach, describe, expect, it } from 'vitest';
import { TokenRegistry } from '../src/mcp/tokens.ts';
import { fakeEngine, readArgv } from './engine-helpers.ts';
import { setup, until, waitFor } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make() {
  const s = setup();
  const tokens = new TokenRegistry();
  const f = fakeEngine(s, { engine: { mcp: { url: () => 'http://127.0.0.1:4319/mcp', tokens } } });
  cleanups.push(f.cleanup, s.cleanup);
  return { ...s, ...f, tokens };
}

const tokenIn = (args: string[]): string => {
  const config = JSON.parse(args[args.indexOf('--mcp-config') + 1]!) as { mcpServers: { office: { type: string; url: string; headers: { Authorization: string } } } };
  expect(config.mcpServers.office).toMatchObject({ type: 'http', url: 'http://127.0.0.1:4319/mcp' });
  return config.mcpServers.office.headers.Authorization.replace(/^Bearer /, '');
};

describe('Engine — office tools', () => {
  it('starts every session with the office tools and a token that names the employee', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    const [first] = await readArgv(t.argvLog, 1);
    expect(t.tokens.resolve(tokenIn(first!.args))).toBe(e.id);
  });

  it('review focus: a restarted session gets a new token and the old one stops working; firing revokes it', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    const [first] = await readArgv(t.argvLog, 1);
    const old = tokenIn(first!.args);
    await t.engine.stop(e.id);
    t.engine.resume(e.id);
    const runs = await readArgv(t.argvLog, 2);
    const fresh = tokenIn(runs[1]!.args);
    expect(fresh).not.toBe(old);
    expect(t.tokens.resolve(old)).toBeNull();
    expect(t.tokens.resolve(fresh)).toBe(e.id);
    await t.engine.fire(e.id);
    expect(t.tokens.resolve(fresh)).toBeNull();
  });

  it('is ready for a task only when idle with a live session', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    expect(t.engine.ready(e.id)).toBe(true);
    t.engine.send(e.id, 'merhaba');
    expect(t.engine.ready(e.id)).toBe(false);
    await waitFor(t.events, (x) => x.event.type === 'turn.finished');
    await until(() => t.engine.ready(e.id));
    await t.engine.stop(e.id);
    expect(t.engine.ready(e.id)).toBe(false);
  });

  it('final review: reload restarts an idle session at once and a busy one after its turn, with a new token', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    await readArgv(t.argvLog, 1);
    t.engine.reload(e.id);
    const runs = await readArgv(t.argvLog, 2);
    await until(() => t.engine.ready(e.id));
    t.engine.send(e.id, 'SLOW iş');
    t.engine.reload(e.id);
    await new Promise((r) => setTimeout(r, 300));
    expect(await readArgv(t.argvLog, 2)).toHaveLength(2);
    const after = await readArgv(t.argvLog, 3, 8000);
    expect(tokenIn(after[2]!.args)).not.toBe(tokenIn(runs[1]!.args));
    await until(() => t.engine.ready(e.id), 8000);
  });

  it('review focus: sleeps only when idle, wakes with the same session, and a message wakes a sleeper', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    await readArgv(t.argvLog, 1);
    t.engine.send(e.id, 'SLOW iş');
    await expect(t.engine.sleep(e.id)).rejects.toThrow(/Yalnız boştaki/);
    await until(() => t.engine.ready(e.id), 8000);
    expect((await t.engine.sleep(e.id)).lifecycle).toBe('sleeping');
    expect(t.engine.ready(e.id)).toBe(false);
    expect((await t.engine.sleep(e.id)).lifecycle).toBe('sleeping');
    const before = (await readArgv(t.argvLog, 1)).length;
    expect(t.engine.wake(e.id).lifecycle).toBe('idle');
    const runs = await readArgv(t.argvLog, before + 1);
    expect(runs.at(-1)!.args).toContain('--resume');
    await t.engine.sleep(e.id);
    t.engine.send(e.id, 'uyan');
    await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'message.assistant' && x.event.text.includes('uyan'), { timeoutMs: 8000 });
  });

  it('review focus: a sleeper stays asleep across an office restart', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    await until(() => t.engine.ready(e.id));
    await t.engine.sleep(e.id);
    const before = (await readArgv(t.argvLog, 1)).length;
    t.engine.recover();
    await new Promise((r) => setTimeout(r, 300));
    expect(t.roster.get(e.id).lifecycle).toBe('sleeping');
    expect(await readArgv(t.argvLog, 1)).toHaveLength(before);
  });
});
