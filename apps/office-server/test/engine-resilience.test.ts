import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CONTINUE_AFTER_CRASH, CONTINUE_AFTER_LIMIT, CONTINUE_AFTER_RESTART } from '../src/engine.ts';
import { ConflictError } from '../src/errors.ts';
import { fakeEngine, readArgv } from './engine-helpers.ts';
import { setup, tempDir, waitFor, type TestSetup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make(opts: Parameters<typeof fakeEngine>[1] = {}) {
  const s = setup();
  const f = fakeEngine(s, opts);
  cleanups.push(f.cleanup, s.cleanup);
  return { ...s, ...f };
}

function another(s: TestSetup) {
  const f = fakeEngine(s);
  cleanups.unshift(f.cleanup);
  return f;
}

describe('Engine — resilience', () => {
  it('restarts once after a crash mid-turn and continues the work', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    t.engine.send(e.id, 'CRASH now');
    const cont = await waitFor(t.events, (x) => x.event.type === 'message.user' && x.event.source === 'system');
    expect(cont.event).toEqual({ type: 'message.user', text: CONTINUE_AFTER_CRASH, source: 'system' });
    await waitFor(t.events, (x) => x.event.type === 'turn.finished', { after: cont.seq });
    expect(t.roster.get(e.id).lifecycle).toBe('idle');
    const error = t.events.list().find((x) => x.event.type === 'error');
    expect((error?.event as { message: string }).message).toContain('boom: fake crash');
  });

  it('review focus: an owner message survives a session that dies before reading it', async () => {
    const flag = join(tempDir(), 'fail-next-start');
    const t = make({ env: { FAKE_CLAUDE_FAIL_FLAG: flag } });
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    t.engine.send(e.id, 'merhaba');
    await waitFor(t.events, (x) => x.event.type === 'turn.finished');
    await t.engine.stop(e.id);
    writeFileSync(flag, '1');
    const before = t.events.lastSeq();
    t.engine.send(e.id, 'lütfen X yap');
    const reply = await waitFor(t.events, (x) => x.event.type === 'message.assistant', { after: before });
    expect(reply.event).toEqual({ type: 'message.assistant', text: 'echo: lütfen X yap' });
    await waitFor(t.events, (x) => x.event.type === 'turn.finished', { after: before });
    const sent = t.events.list({ after: before }).filter((x) => x.event.type === 'message.user');
    expect(sent.map((x) => x.event)).toEqual([{ type: 'message.user', text: 'lütfen X yap', source: 'owner' }]);
    expect(t.roster.get(e.id).lifecycle).toBe('idle');
  });

  it('goes to error when the session crashes twice within the window, and resume clears it', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    t.engine.send(e.id, 'CRASH one');
    await waitFor(t.events, (x) => x.event.type === 'message.user' && x.event.source === 'system');
    t.engine.send(e.id, 'CRASH two');
    await waitFor(t.events, (x) => x.event.type === 'lifecycle.changed' && x.event.to === 'error');
    expect(t.roster.get(e.id).lastError).toMatch(/beklenmedik/);
    const resumed = t.engine.resume(e.id);
    expect(resumed).toMatchObject({ lifecycle: 'idle', lastError: null });
  });

  it('on a usage limit goes limited and continues by itself when the window resets', async () => {
    const t = make({ env: { FAKE_CLAUDE_LIMIT_RESET_SEC: '1' }, engine: { limitGraceMs: 0 } });
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    t.engine.send(e.id, 'LIMIT hit');
    await waitFor(t.events, (x) => x.event.type === 'lifecycle.changed' && x.event.to === 'limited');
    expect(t.roster.get(e.id).limitResetsAt).toBeGreaterThan(Date.now() - 2000);
    const cont = await waitFor(t.events, (x) => x.event.type === 'message.user' && x.event.text === CONTINUE_AFTER_LIMIT, { timeoutMs: 6000 });
    expect(cont.event).toMatchObject({ source: 'system' });
    await waitFor(t.events, (x) => x.event.type === 'turn.finished', { after: cont.seq });
    expect(t.roster.get(e.id)).toMatchObject({ lifecycle: 'idle', limitResetsAt: null });
  });

  it('review focus: after an office restart a running turn becomes interrupted and resume continues it', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    t.engine.send(e.id, 'SLOW job');
    await waitFor(t.events, (x) => x.event.type === 'tool.started');
    await t.engine.shutdown();
    expect(t.roster.get(e.id).lifecycle).toBe('working');

    const second = another(t);
    second.engine.recover();
    expect(t.roster.get(e.id).lifecycle).toBe('interrupted');
    second.engine.resume(e.id);
    const cont = await waitFor(t.events, (x) => x.event.type === 'message.user' && x.event.text === CONTINUE_AFTER_RESTART);
    expect(cont.event).toMatchObject({ source: 'system' });
    await waitFor(t.events, (x) => x.event.type === 'turn.finished', { after: cont.seq });
    expect(t.roster.get(e.id).lifecycle).toBe('idle');
  });

  it('recover restarts idle employees and leaves stopped ones alone', async () => {
    const t = make();
    t.engine.hire({ name: 'Ada', role: 'r' });
    const can = t.engine.hire({ name: 'Can', role: 'r' });
    await t.engine.stop(can.id);
    await t.engine.shutdown();

    const second = another(t);
    second.engine.recover();
    const argvs = await readArgv(second.argvLog, 1);
    expect(argvs.map((a) => a.cwd)).toEqual([join(t.dataDir, 'desks', 'ada')]);
    expect(t.roster.get(can.id).lifecycle).toBe('stopped');
  });

  it('side question runs on a tool-less fork without touching the main session', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    await expect(t.engine.sideQuestion(e.id, 'ne yapıyorsun?')).rejects.toThrow(ConflictError);
    t.engine.send(e.id, 'merhaba');
    await waitFor(t.events, (x) => x.event.type === 'turn.finished');
    await expect(t.engine.sideQuestion(e.id, '   ')).rejects.toThrow(/boş/);
    expect(await t.engine.sideQuestion(e.id, 'ne yapıyorsun?')).toEqual({ ok: true, answer: 'side:ne yapıyorsun?|history:1' });
    const argvs = await readArgv(t.argvLog, 2);
    expect(argvs[1]?.args).toEqual(expect.arrayContaining(['--fork-session', '--resume', e.sessionId, '--output-format', 'json']));
    const answer = t.events.list().find((x) => x.event.type === 'side.answer');
    expect(answer?.event).toMatchObject({ ok: true, costUsd: 0.002 });
    expect(t.roster.get(e.id).lifecycle).toBe('idle');
  });
});
