import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { StoredEvent } from '@cc/shared';
import { fakeEngine, readArgv, type ArgvEntry } from './engine-helpers.ts';
import { setup, tempDir, until } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const MIN = 60_000;

function make(o: { policy?: () => boolean; unavailable?: string } = {}) {
  let clock = new Date(2026, 9, 7, 10, 0).getTime();
  const now = () => clock;
  const s = setup(8, now);
  const failFlag = join(tempDir('fake-claude-fail-'), 'fail');
  // These tests are about the model policy: on unless a test switches it.
  const f = fakeEngine(s, { env: { FAKE_CLAUDE_FAIL_FLAG: failFlag, FAKE_CLAUDE_UNAVAILABLE_MODELS: o.unavailable ?? '' }, engine: { now, cacheTtlMinutes: () => 5, modelPolicyEnabled: o.policy ?? (() => true) } });
  cleanups.push(f.cleanup, s.cleanup);
  const turns = (id: string) => s.events.list({ employeeId: id, limit: 5000 }).filter((e) => e.event.type === 'turn.finished').length;
  const said = (id: string) =>
    s.events
      .list({ employeeId: id, limit: 5000 })
      .filter((e): e is StoredEvent & { event: { type: 'message.assistant'; text: string } } => e.event.type === 'message.assistant')
      .map((e) => e.event.text);
  const errors = (id: string) => s.events.list({ employeeId: id, limit: 5000 }).flatMap((e) => (e.event.type === 'error' ? [e.event.message] : []));
  return { ...s, engine: f.engine, argvLog: f.argvLog, advance: (ms: number) => (clock += ms), turns, said, errors, failNextStarts: (n: number) => writeFileSync(failFlag, String(n)) };
}

const modelOf = (a: ArgvEntry) => a.args[a.args.indexOf('--model') + 1];
const sessions = (argv: ArgvEntry[]) => argv.filter((a) => !a.args.includes('json')).map(modelOf);

describe('Engine — model hints', () => {
  it('review focus: a stronger model at once, a weaker one only once the cache is cold; the session resumes and nothing is lost', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Koordinatör', role: 'r', model: 'sonnet' });
    t.engine.send(e.id, 'merhaba', 'system');
    await until(() => t.turns(e.id) === 1);

    t.engine.send(e.id, 'WHAT DID I SAY', 'owner', { model: 'fable' });
    await until(() => t.turns(e.id) === 2, 8000);
    let argv = await readArgv(t.argvLog, 2);
    expect(sessions(argv)).toEqual(['sonnet', 'fable']);
    expect(argv[1]!.args).toContain('--resume');
    expect(t.said(e.id).at(-1)).toBe('you said: merhaba');
    // The hint moves the session only: the employee's own model stays.
    expect(t.roster.get(e.id).model).toBe('sonnet');

    t.advance(4 * MIN);
    t.engine.send(e.id, 'karar notu', 'system', { model: 'sonnet' });
    await until(() => t.turns(e.id) === 3, 8000);
    expect(sessions(await readArgv(t.argvLog, 2))).toEqual(['sonnet', 'fable']);

    t.advance(5 * MIN);
    t.engine.send(e.id, 'özet', 'system', { model: 'haiku' });
    await until(() => t.turns(e.id) === 4, 8000);
    argv = await readArgv(t.argvLog, 3);
    expect(sessions(argv)).toEqual(['sonnet', 'fable', 'haiku']);
    expect(t.events.list({ employeeId: e.id, limit: 5000 }).some((x) => x.event.type === 'model.changed')).toBe(false);
    // A side question asks the employee's own model, whatever the session runs on.
    await t.engine.sideQuestion(e.id, 'ne yapıyorsun?');
    const side = (await readArgv(t.argvLog, 4)).find((a) => a.args.includes('json'))!;
    expect(side.args[side.args.indexOf('--model') + 1]).toBe('sonnet');
    // So does the next session after a sleep.
    await t.engine.sleep(e.id);
    t.engine.send(e.id, 'uyan', 'system');
    await until(() => t.turns(e.id) === 5, 8000);
    expect(sessions(await readArgv(t.argvLog, 5))).toEqual(['sonnet', 'fable', 'haiku', 'sonnet']);
  });

  it('critical: when the session cannot start on the new model it goes on on the old one, the message delivered; that model is not asked for again for a while', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r', model: 'sonnet' });
    t.engine.send(e.id, 'merhaba', 'system');
    await until(() => t.turns(e.id) === 1);
    t.failNextStarts(1);
    let lost = 0;
    t.engine.send(e.id, 'zor iş', 'system', { model: 'opus', taskStart: true, onLost: () => (lost += 1) });
    await until(() => t.turns(e.id) === 2, 8000);
    expect(t.said(e.id).at(-1)).toBe('echo: zor iş');
    expect(lost).toBe(0);
    expect(sessions(await readArgv(t.argvLog, 3))).toEqual(['sonnet', 'opus', 'sonnet']);
    expect(t.events.list({ employeeId: e.id, limit: 5000 }).find((x) => x.event.type === 'model.switch.failed')?.event).toMatchObject({ type: 'model.switch.failed', from: 'sonnet', to: 'opus' });
    expect(t.roster.get(e.id).lifecycle).toBe('idle');
    t.engine.send(e.id, 'yine zor', 'system', { model: 'opus', taskStart: true });
    await until(() => t.turns(e.id) === 3, 8000);
    expect(sessions(await readArgv(t.argvLog, 3))).toEqual(['sonnet', 'opus', 'sonnet']);
    t.advance(11 * MIN);
    t.engine.send(e.id, 'bir daha', 'system', { model: 'opus', taskStart: true });
    await until(() => t.turns(e.id) === 4, 8000);
    expect(sessions(await readArgv(t.argvLog, 4))).toEqual(['sonnet', 'opus', 'sonnet', 'opus']);
  });

  it('critical: when no session starts at all the message is reported lost (once), so its sender can put the work back', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r', model: 'sonnet' });
    t.engine.send(e.id, 'merhaba', 'system');
    await until(() => t.turns(e.id) === 1);
    t.failNextStarts(2);
    let lost = 0;
    t.engine.send(e.id, 'zor iş', 'system', { model: 'opus', taskStart: true, onLost: () => (lost += 1) });
    await until(() => t.roster.get(e.id).lifecycle === 'error', 8000);
    expect(lost).toBe(1);
  });

  it('important: never switches in the middle of a turn, and messages sent while it switches follow in order', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r', model: 'haiku' });
    t.engine.send(e.id, 'SLOW iş', 'system');
    t.engine.send(e.id, 'araya giren', 'owner', { model: 'fable' });
    await until(() => t.engine.ready(e.id), 8000);
    expect(sessions(await readArgv(t.argvLog, 1))).toEqual(['haiku']);
    expect(t.roster.get(e.id).model).toBe('haiku');

    t.engine.send(e.id, 'bir', 'owner', { model: 'opus' });
    t.engine.send(e.id, 'iki', 'owner');
    t.engine.send(e.id, 'WHAT DID I SAY', 'owner');
    await until(() => t.said(e.id).some((x) => x.startsWith('you said')), 8000);
    expect(t.said(e.id).filter((x) => x.startsWith('echo: ')).slice(-2)).toEqual(['echo: bir', 'echo: iki']);
    expect(t.said(e.id).at(-1)).toBe('you said: iki');
    expect(sessions(await readArgv(t.argvLog, 2))).toEqual(['haiku', 'opus']);
  });

  it('a stopped or sleeping session simply starts on the model asked for; a task start applies a weaker one at once', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r', model: 'opus' });
    await until(() => t.engine.ready(e.id));
    await t.engine.sleep(e.id);
    t.engine.send(e.id, 'kolay iş', 'system', { model: 'haiku', taskStart: true });
    await until(() => t.turns(e.id) === 1, 8000);
    t.engine.send(e.id, 'zor iş', 'system', { model: 'opus', taskStart: true });
    await until(() => t.turns(e.id) === 2, 8000);
    t.engine.send(e.id, 'yine kolay', 'system', { model: 'haiku', taskStart: true });
    await until(() => t.turns(e.id) === 3, 8000);
    expect(sessions(await readArgv(t.argvLog, 4))).toEqual(['opus', 'haiku', 'opus', 'haiku']);
  });

  it('R7: with the model policy switched off hints are ignored, and a session on another model goes back to the employee’s own', async () => {
    let policy = true;
    const t = make({ policy: () => policy });
    const e = t.engine.hire({ name: 'Ada', role: 'r', model: 'sonnet' });
    t.engine.send(e.id, 'bir', 'system', { model: 'opus' });
    await until(() => t.turns(e.id) === 1, 8000);
    policy = false;
    t.engine.send(e.id, 'iki', 'system', { model: 'fable' });
    await until(() => t.turns(e.id) === 2, 8000);
    t.engine.send(e.id, 'üç', 'owner', { model: 'fable' });
    await until(() => t.turns(e.id) === 3, 8000);
    expect(sessions(await readArgv(t.argvLog, 3))).toEqual(['sonnet', 'opus', 'sonnet']);
  });

  it('R13: a model the account cannot use (the CLI answers its first turn with an error and stays up): back to the old model, the message sent again, model.switch.failed', async () => {
    const t = make({ unavailable: 'opus' });
    const e = t.engine.hire({ name: 'Ada', role: 'r', model: 'sonnet' });
    t.engine.send(e.id, 'merhaba', 'system');
    await until(() => t.turns(e.id) === 1, 8000);
    let lost = 0;
    t.engine.send(e.id, 'zor iş: rapor yaz', 'system', { model: 'opus', taskStart: true, onLost: () => (lost += 1) });
    await until(() => t.said(e.id).includes('echo: zor iş: rapor yaz'), 8000);
    await until(() => t.engine.ready(e.id), 8000);
    expect(lost).toBe(0);
    expect(sessions(await readArgv(t.argvLog, 3))).toEqual(['sonnet', 'opus', 'sonnet']);
    const failed = t.events.list({ employeeId: e.id, limit: 5000 }).find((x) => x.event.type === 'model.switch.failed')?.event;
    expect(failed).toMatchObject({ type: 'model.switch.failed', from: 'sonnet', to: 'opus' });
    expect((failed as { reason: string }).reason).toMatch(/issue with the selected model/);
    // Logged once: the owner sees the message once, though claude got it twice.
    expect(t.events.list({ employeeId: e.id, limit: 5000 }).filter((x) => x.event.type === 'message.user' && (x.event as { text: string }).text === 'zor iş: rapor yaz')).toHaveLength(1);
    t.engine.send(e.id, 'yine zor', 'system', { model: 'opus', taskStart: true });
    await until(() => t.said(e.id).includes('echo: yine zor'), 8000);
    expect(sessions(await readArgv(t.argvLog, 3))).toEqual(['sonnet', 'opus', 'sonnet']);
  });
});

