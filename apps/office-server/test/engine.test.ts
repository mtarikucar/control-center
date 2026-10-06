import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConflictError } from '../src/errors.ts';
import { fakeEngine, readArgv } from './engine-helpers.ts';
import { setup, waitFor } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make() {
  const s = setup();
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  return { ...s, ...f };
}

describe('Engine — core', () => {
  it('hire creates the desk, starts a session and is idle', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'Yazılımcı', model: 'haiku' });
    expect(t.roster.get(e.id).lifecycle).toBe('idle');
    expect(readFileSync(join(t.dataDir, 'desks', 'ada', 'CLAUDE.md'), 'utf8')).toContain('Yazılımcı');
    const [first] = await readArgv(t.argvLog, 1);
    expect(first?.cwd).toBe(join(t.dataDir, 'desks', 'ada'));
    expect(first?.args).toEqual(expect.arrayContaining(['--session-id', e.sessionId, '--model', 'haiku', '--permission-mode', 'bypassPermissions']));
    expect(t.events.list().map((x) => x.event.type)).toContain('employee.hired');
  });

  it('delivers a message, streams the reply and returns to idle', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    t.engine.send(e.id, '  merhaba  ');
    expect(t.roster.get(e.id).lifecycle).toBe('working');
    const reply = await waitFor(t.events, (x) => x.event.type === 'message.assistant');
    expect(reply.event).toEqual({ type: 'message.assistant', text: 'echo: merhaba' });
    await waitFor(t.events, (x) => x.event.type === 'turn.finished');
    expect(t.roster.get(e.id)).toMatchObject({ lifecycle: 'idle', sessionStarted: true });
    expect(t.events.list().find((x) => x.event.type === 'message.user')?.event).toEqual({ type: 'message.user', text: 'merhaba', source: 'owner' });
  });

  it('rejects an empty message', () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    expect(() => t.engine.send(e.id, '   ')).toThrow(/boş/);
  });

  it('a message sent mid-turn reaches the running turn without starting a new one', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    t.engine.send(e.id, 'SLOW job');
    await waitFor(t.events, (x) => x.event.type === 'tool.started');
    t.engine.send(e.id, 'ara soru');
    const done = await waitFor(t.events, (x) => x.event.type === 'message.assistant');
    expect(done.event).toEqual({ type: 'message.assistant', text: 'slow-done saw:ara soru' });
    expect(t.events.list().filter((x) => x.event.type === 'turn.started')).toHaveLength(1);
  });

  it('stop interrupts the running turn and leaves the employee stopped', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    t.engine.send(e.id, 'SLOW job');
    await waitFor(t.events, (x) => x.event.type === 'tool.started');
    const stopped = await t.engine.stop(e.id);
    expect(stopped.lifecycle).toBe('stopped');
    const finished = await waitFor(t.events, (x) => x.event.type === 'turn.finished');
    expect(finished.event).toMatchObject({ ok: false, subtype: 'error_during_execution' });
  });

  it('resume reopens the same session with --resume and keeps context', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    t.engine.send(e.id, 'gizli kelime PAPATYA');
    const first = await waitFor(t.events, (x) => x.event.type === 'turn.finished');
    await t.engine.stop(e.id);
    expect(t.engine.resume(e.id).lifecycle).toBe('idle');
    t.engine.send(e.id, 'WHAT DID I SAY');
    const answer = await waitFor(t.events, (x) => x.event.type === 'message.assistant', { after: first.seq });
    expect(answer.event).toEqual({ type: 'message.assistant', text: 'you said: gizli kelime PAPATYA' });
    const argvs = await readArgv(t.argvLog, 2);
    expect(argvs[1]?.args).toEqual(expect.arrayContaining(['--resume', e.sessionId]));
    expect(argvs[1]?.args).not.toContain('--session-id');
  });

  it('review focus: a message to a stopped employee restarts the session and is delivered', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    await t.engine.stop(e.id);
    t.engine.send(e.id, 'yeniden');
    const reply = await waitFor(t.events, (x) => x.event.type === 'message.assistant');
    expect(reply.event).toEqual({ type: 'message.assistant', text: 'echo: yeniden' });
    await waitFor(t.events, (x) => x.event.type === 'turn.finished');
    expect(t.roster.get(e.id).lifecycle).toBe('idle');
  });

  it('terminal hand-off refuses messages while in the terminal and gives the resume command', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    await expect(t.engine.openInTerminal(e.id)).rejects.toThrow(ConflictError);
    t.engine.send(e.id, 'merhaba');
    await waitFor(t.events, (x) => x.event.type === 'turn.finished');
    const { command, employee } = await t.engine.openInTerminal(e.id);
    expect(employee.lifecycle).toBe('in_terminal');
    expect(command).toBe(`cd '${join(t.dataDir, 'desks', 'ada')}' && claude --resume ${e.sessionId}`);
    expect(() => t.engine.send(e.id, 'x')).toThrow(ConflictError);
    expect(() => t.engine.resume(e.id)).toThrow(ConflictError);
    expect(t.engine.returnFromTerminal(e.id).lifecycle).toBe('stopped');
    expect(() => t.engine.returnFromTerminal(e.id)).toThrow(ConflictError);
  });

  it('fire archives the employee and frees the desk', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    await t.engine.fire(e.id);
    expect(t.roster.get(e.id).lifecycle).toBe('archived');
    expect(() => t.engine.send(e.id, 'x')).toThrow(ConflictError);
    expect(t.engine.hire({ name: 'Can', role: 'r' }).deskIndex).toBe(e.deskIndex);
    expect(t.events.list().map((x) => x.event.type)).toContain('employee.fired');
  });
});

describe('Engine — overlapping commands', () => {
  it('fire while a stop is in flight wins and the employee stays archived', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    t.engine.send(e.id, 'SLOW job');
    await waitFor(t.events, (x) => x.event.type === 'tool.started');
    const firing = t.engine.fire(e.id);
    const stopping = t.engine.stop(e.id);
    await firing;
    await expect(stopping).rejects.toThrow(ConflictError);
    expect(t.roster.get(e.id).lifecycle).toBe('archived');
    expect(t.events.list().filter((x) => x.event.type === 'employee.fired')).toHaveLength(1);
  });

  it('a message sent while the employee is being stopped is refused, not silently dropped', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    t.engine.send(e.id, 'SLOW job');
    await waitFor(t.events, (x) => x.event.type === 'tool.started');
    const stopping = t.engine.stop(e.id);
    expect(() => t.engine.send(e.id, 'arada')).toThrow(ConflictError);
    expect(() => t.engine.resume(e.id)).toThrow(ConflictError);
    expect((await stopping).lifecycle).toBe('stopped');
  });

  it('stop during an open-in-terminal hand-off keeps the terminal lock', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    t.engine.send(e.id, 'merhaba');
    await waitFor(t.events, (x) => x.event.type === 'turn.finished');
    t.engine.send(e.id, 'SLOW job');
    await waitFor(t.events, (x) => x.event.type === 'tool.started');
    const opening = t.engine.openInTerminal(e.id);
    const stopping = t.engine.stop(e.id);
    expect((await opening).employee.lifecycle).toBe('in_terminal');
    await expect(stopping).rejects.toThrow(ConflictError);
    expect(t.roster.get(e.id).lifecycle).toBe('in_terminal');
  });
});
