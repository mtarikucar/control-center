import { afterEach, describe, expect, it } from 'vitest';
import type { StoredEvent } from '@cc/shared';
import { fakeEngine, readArgv, type ArgvEntry } from './engine-helpers.ts';
import { setup, until } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const MIN = 60_000;

function make() {
  let clock = new Date(2026, 9, 7, 10, 0).getTime();
  const now = () => clock;
  const s = setup(8, now);
  const f = fakeEngine(s, { engine: { now, cacheTtlMinutes: () => 5 } });
  cleanups.push(f.cleanup, s.cleanup);
  const turns = (id: string) => s.events.list({ employeeId: id, limit: 5000 }).filter((e) => e.event.type === 'turn.finished').length;
  const said = (id: string) =>
    s.events
      .list({ employeeId: id, limit: 5000 })
      .filter((e): e is StoredEvent & { event: { type: 'message.assistant'; text: string } } => e.event.type === 'message.assistant')
      .map((e) => e.event.text);
  return { ...s, engine: f.engine, argvLog: f.argvLog, advance: (ms: number) => (clock += ms), turns, said };
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
    expect(t.roster.get(e.id).model).toBe('fable');

    t.advance(4 * MIN);
    t.engine.send(e.id, 'karar notu', 'system', { model: 'sonnet' });
    await until(() => t.turns(e.id) === 3, 8000);
    expect(sessions(await readArgv(t.argvLog, 2))).toEqual(['sonnet', 'fable']);

    t.advance(5 * MIN);
    t.engine.send(e.id, 'özet', 'system', { model: 'haiku' });
    await until(() => t.turns(e.id) === 4, 8000);
    argv = await readArgv(t.argvLog, 3);
    expect(sessions(argv)).toEqual(['sonnet', 'fable', 'haiku']);
    expect(t.events.list({ employeeId: e.id, limit: 5000 }).filter((x) => x.event.type === 'model.changed').map((x) => (x.event as { model: string }).model)).toEqual(['fable', 'haiku']);
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
});
