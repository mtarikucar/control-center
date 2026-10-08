import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineOptions } from '../src/engine.ts';
import { BACKGROUND_LIMIT_MS, CONTINUE_AFTER_CRASH, CONTINUE_AFTER_RESTART, CONTINUE_AFTER_TERMINAL } from '../src/engine.ts';
import { ConflictError } from '../src/errors.ts';
import { fakeEngine, readArgv } from './engine-helpers.ts';
import { setup, tempDir, until, waitFor } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

/** The fake CLI holds its background job (and, with FAKE_CLAUDE_HOLD_FOLLOWUP, the follow-up turn) until released. */
function make(env: Record<string, string> = {}, engine: Partial<EngineOptions> = {}) {
  const s = setup();
  const hold = tempDir('hold-');
  const f = fakeEngine(s, { env: { FAKE_CLAUDE_HOLD_DIR: hold, ...env }, engine });
  cleanups.push(f.cleanup, s.cleanup);
  const release = (sessionId: string, what: '.bg' | '.follow') => writeFileSync(join(hold, `${sessionId}${what}`), '');
  return { ...s, ...f, release };
}

type Change = { from: string; to: string; reason: string };
const changesOf = (t: ReturnType<typeof make>, id: string, after = 0): Change[] =>
  t.events
    .list({ after, employeeId: id, limit: 5000 })
    .flatMap((x) => (x.event.type === 'lifecycle.changed' ? [{ from: x.event.from, to: x.event.to, reason: x.event.reason }] : []));
const typesOf = (t: ReturnType<typeof make>, id: string, after = 0) => t.events.list({ after, employeeId: id, limit: 5000 }).map((x) => x.event.type);

describe('Engine — work that goes on after the turn (background jobs, turns the CLI opens itself)', () => {
  it('a background job keeps the employee working past the result; the follow-up turn the CLI opens is work too', async () => {
    // A short grace: the follow-up turn outlasts it and must still count as work.
    const t = make({ FAKE_CLAUDE_HOLD_FOLLOWUP: '1' }, { followUpGraceMs: 500 });
    const e = t.engine.hire({ name: 'Mert', role: 'r' });
    const hired = t.events.lastSeq();
    t.engine.send(e.id, 'BACKGROUND mutasyon koşusu', 'system');
    const first = await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'turn.finished');
    // The turn ended, the job it started runs on: not idle, not ready for the next task, not to be put to sleep.
    expect(t.roster.get(e.id).lifecycle).toBe('working');
    expect(t.engine.ready(e.id)).toBe(false);
    await expect(t.engine.sleep(e.id)).rejects.toThrow(ConflictError);

    t.release(e.sessionId, '.bg');
    const follow = await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'message.assistant', { after: first.seq });
    // The CLI's own turn runs (no message from the office): working, and the log opens a turn for it.
    await new Promise((r) => setTimeout(r, 800));
    expect(t.roster.get(e.id).lifecycle).toBe('working');
    expect(t.engine.ready(e.id)).toBe(false);
    expect(typesOf(t, e.id, first.seq).filter((x) => x === 'turn.started')).toHaveLength(1);

    t.release(e.sessionId, '.follow');
    await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'turn.finished', { after: follow.seq });
    await until(() => t.engine.ready(e.id));
    expect(t.roster.get(e.id).lifecycle).toBe('idle');
    // One working stretch from the message to the end of the follow-up: no idle (coffee) in between.
    expect(changesOf(t, e.id, hired).map((c) => `${c.from}>${c.to}`)).toEqual(['idle>working', 'working>idle']);
  });

  it('a turn the CLI opens by itself shows as working even when the office never saw its job start', async () => {
    const t = make({ FAKE_CLAUDE_BG_SILENT: '1', FAKE_CLAUDE_HOLD_FOLLOWUP: '1' });
    const e = t.engine.hire({ name: 'Mert', role: 'r' });
    t.engine.send(e.id, 'BACKGROUND', 'system');
    const first = await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'turn.finished');
    // Nothing told the office about the job: idle is all it can know (as before).
    expect(t.roster.get(e.id).lifecycle).toBe('idle');

    t.release(e.sessionId, '.bg');
    const follow = await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'message.assistant', { after: first.seq });
    expect(t.roster.get(e.id).lifecycle).toBe('working');
    expect(t.engine.ready(e.id)).toBe(false);
    const opened = typesOf(t, e.id, first.seq);
    expect(opened.indexOf('turn.started')).toBeGreaterThanOrEqual(0);
    expect(opened.indexOf('turn.started')).toBeLessThan(opened.indexOf('message.assistant'));

    t.release(e.sessionId, '.follow');
    await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'turn.finished', { after: follow.seq });
    expect(t.roster.get(e.id).lifecycle).toBe('idle');
    expect(t.engine.ready(e.id)).toBe(true);
  });

  it('a job that ends with no follow-up turn lets the employee go idle after the grace', async () => {
    const t = make({ FAKE_CLAUDE_BG_NO_FOLLOWUP: '1' }, { followUpGraceMs: 100 });
    const e = t.engine.hire({ name: 'Mert', role: 'r' });
    t.engine.send(e.id, 'BACKGROUND', 'system');
    await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'turn.finished');
    expect(t.roster.get(e.id).lifecycle).toBe('working');
    t.release(e.sessionId, '.bg');
    await until(() => t.engine.ready(e.id), 3000);
    expect(changesOf(t, e.id).at(-1)).toMatchObject({ from: 'working', to: 'idle' });
  });
});

describe('Engine — back from the terminal', () => {
  it('taken to the terminal while a background job ran: back at the desk the session hears it was cut and goes on', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Mert', role: 'r' });
    t.engine.send(e.id, 'BACKGROUND mutasyon koşusu', 'system');
    await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'turn.finished');
    expect(t.roster.get(e.id).lifecycle).toBe('working');

    expect((await t.engine.openInTerminal(e.id)).employee.lifecycle).toBe('in_terminal');
    const before = t.events.lastSeq();
    const back = t.engine.returnFromTerminal(e.id);
    // The session the office started again is reading the note: working, as the process is.
    expect(back.lifecycle).toBe('working');
    expect(t.engine.ready(e.id)).toBe(false);
    const told = t.events.list({ after: before, employeeId: e.id }).find((x) => x.event.type === 'message.user');
    expect(told?.event).toEqual({ type: 'message.user', text: CONTINUE_AFTER_TERMINAL, source: 'system' });
    await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'turn.finished', { after: before });
    expect(t.roster.get(e.id).lifecycle).toBe('idle');
  });

  it('taken to the terminal in the middle of a turn: back at the desk it goes on', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Mert', role: 'r' });
    t.engine.send(e.id, 'SLOW job', 'system');
    await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'tool.started');
    expect((await t.engine.openInTerminal(e.id)).employee.lifecycle).toBe('in_terminal');
    const before = t.events.lastSeq();
    expect(t.engine.returnFromTerminal(e.id).lifecycle).toBe('working');
    const told = t.events.list({ after: before, employeeId: e.id }).find((x) => x.event.type === 'message.user');
    expect(told?.event).toMatchObject({ text: CONTINUE_AFTER_TERMINAL, source: 'system' });
  });

  it('taken to the terminal while idle: back at the desk it is idle and nothing is sent (as before)', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Mert', role: 'r' });
    t.engine.send(e.id, 'merhaba', 'system');
    await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'turn.finished');
    await t.engine.openInTerminal(e.id);
    const before = t.events.lastSeq();
    expect(t.engine.returnFromTerminal(e.id).lifecycle).toBe('idle');
    await until(() => t.engine.ready(e.id));
    expect(typesOf(t, e.id, before)).not.toContain('message.user');
    expect(typesOf(t, e.id, before)).not.toContain('turn.started');
  });
});

describe('Engine — work cut beside a background job', () => {
  it('claude dies while a background job runs: started again, it hears to go on', async () => {
    const t = make({ FAKE_CLAUDE_BG_CRASH: 'running' });
    const e = t.engine.hire({ name: 'Mert', role: 'r' });
    t.engine.send(e.id, 'BACKGROUND mutasyon koşusu', 'system');
    const first = await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'turn.finished');
    t.release(e.sessionId, '.bg');
    const told = await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'message.user', { after: first.seq, timeoutMs: 3000 });
    expect(told.event).toEqual({ type: 'message.user', text: CONTINUE_AFTER_CRASH, source: 'system' });
    await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'turn.finished', { after: told.seq });
    expect(t.roster.get(e.id).lifecycle).toBe('idle');
  });

  it('claude dies after the job ended, before the turn that reads it: it hears to go on', async () => {
    const t = make({ FAKE_CLAUDE_BG_CRASH: 'notified' });
    const e = t.engine.hire({ name: 'Mert', role: 'r' });
    t.engine.send(e.id, 'BACKGROUND', 'system');
    const first = await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'turn.finished');
    t.release(e.sessionId, '.bg');
    const told = await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'message.user', { after: first.seq, timeoutMs: 3000 });
    expect(told.event).toEqual({ type: 'message.user', text: CONTINUE_AFTER_CRASH, source: 'system' });
  });

  it('a crash while idle with nothing running starts the session again and sends nothing (as before)', async () => {
    const t = make({ FAKE_CLAUDE_BG_CRASH: 'running', FAKE_CLAUDE_BG_SILENT: '1', FAKE_CLAUDE_BG_NO_FOLLOWUP: '1' });
    const e = t.engine.hire({ name: 'Mert', role: 'r' });
    t.engine.send(e.id, 'BACKGROUND', 'system');
    const first = await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'turn.finished');
    // The office never saw the job: to it the session crashed while idle.
    expect(t.roster.get(e.id).lifecycle).toBe('idle');
    t.release(e.sessionId, '.bg');
    await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'error' && x.event.message.includes('beklenmedik'), { after: first.seq });
    await until(() => t.engine.ready(e.id));
    expect(typesOf(t, e.id, first.seq)).not.toContain('message.user');
  });
});

describe('Engine — interrupted, then the terminal', () => {
  it('an employee the office restart interrupted, taken to the terminal: back at the desk it hears to go on', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Mert', role: 'r' });
    t.engine.send(e.id, 'SLOW job', 'system');
    await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'tool.started');
    await t.engine.shutdown();
    // The office starts again: a fresh engine on the same roster and log.
    const second = fakeEngine(t);
    cleanups.unshift(second.cleanup);
    second.engine.recover();
    expect(t.roster.get(e.id).lifecycle).toBe('interrupted');

    expect((await second.engine.openInTerminal(e.id)).employee.lifecycle).toBe('in_terminal');
    const before = t.events.lastSeq();
    expect(second.engine.returnFromTerminal(e.id).lifecycle).toBe('working');
    const told = t.events.list({ after: before, employeeId: e.id }).find((x) => x.event.type === 'message.user');
    expect(told?.event).toEqual({ type: 'message.user', text: CONTINUE_AFTER_RESTART, source: 'system' });
    await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'turn.finished', { after: before });
    expect(t.roster.get(e.id).lifecycle).toBe('idle');
  });
});

describe('Engine — the cap on work held by background jobs alone', () => {
  const overdue = (t: ReturnType<typeof make>, id: string, after = 0) => t.events.list({ after, employeeId: id, limit: 5000 }).filter((x) => x.event.type === 'background.overdue');

  it('a job that runs on alone past the cap: free for tasks again, the office is told, the process lives on', async () => {
    const t = make({}, { backgroundLimitMs: 300 });
    const e = t.engine.hire({ name: 'Mert', role: 'r' });
    t.engine.send(e.id, 'BACKGROUND pnpm dev', 'system');
    const first = await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'turn.finished');
    expect(t.roster.get(e.id).lifecycle).toBe('working');
    await until(() => t.engine.ready(e.id), 3000);
    expect(overdue(t, e.id, first.seq).map((x) => x.event)).toEqual([{ type: 'background.overdue', jobs: ['arka plan işi'], limitMs: 300 }]);
    expect(changesOf(t, e.id, first.seq)).toEqual([{ from: 'working', to: 'idle', reason: 'arka plan işi üst süreyi aştı; süreç sürüyor' }]);
    // Not killed: the same process, and the job's end still comes back as a turn of its own.
    t.release(e.sessionId, '.bg');
    const follow = await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'message.assistant', { after: first.seq });
    await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'turn.finished', { after: follow.seq });
    expect(await readArgv(t.argvLog, 1)).toHaveLength(1);
    expect(t.roster.get(e.id).lifecycle).toBe('idle');
  });

  it('a turn running when the cap comes keeps the employee working; the cap waits for its end', async () => {
    const t = make({}, { backgroundLimitMs: 300 });
    const e = t.engine.hire({ name: 'Mert', role: 'r' });
    t.engine.send(e.id, 'BACKGROUND', 'system');
    const first = await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'turn.finished');
    t.engine.send(e.id, 'SLOW job', 'owner');
    await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'tool.started', { after: first.seq });
    await new Promise((r) => setTimeout(r, 500));
    // The cap passed in the middle of the turn: still working, nobody told yet.
    expect(t.roster.get(e.id).lifecycle).toBe('working');
    expect(overdue(t, e.id, first.seq)).toHaveLength(0);
    await until(() => t.engine.ready(e.id), 4000);
    expect(overdue(t, e.id, first.seq)).toHaveLength(1);
  });

  it('a job that ends before the cap: nobody is told', async () => {
    const t = make({}, { backgroundLimitMs: 300 });
    const e = t.engine.hire({ name: 'Mert', role: 'r' });
    t.engine.send(e.id, 'BACKGROUND', 'system');
    const first = await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'turn.finished');
    t.release(e.sessionId, '.bg');
    const follow = await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'message.assistant', { after: first.seq });
    await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'turn.finished', { after: follow.seq });
    await new Promise((r) => setTimeout(r, 500));
    expect(overdue(t, e.id)).toHaveLength(0);
    expect(changesOf(t, e.id, first.seq).map((c) => c.reason)).toEqual(['iş bitti']);
  });

  it('freed by the cap while the job runs: sleep, a model switch and a reload do not restart the session', async () => {
    const t = make({}, { backgroundLimitMs: 300, modelPolicyEnabled: () => true });
    const e = t.engine.hire({ name: 'Mert', role: 'r', model: 'haiku' });
    t.engine.send(e.id, 'BACKGROUND', 'system');
    const first = await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'turn.finished');
    await until(() => t.engine.ready(e.id), 3000);
    await expect(t.engine.sleep(e.id)).rejects.toThrow(ConflictError);
    t.engine.reload(e.id);
    const before = t.events.lastSeq();
    t.engine.send(e.id, 'yeni görev', 'system', { model: 'sonnet', taskStart: true });
    await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'turn.finished', { after: before });
    expect(await readArgv(t.argvLog, 1)).toHaveLength(1);
    // The job lives: its end comes back as a turn; then, nothing running, the reload that waited happens.
    t.release(e.sessionId, '.bg');
    await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'message.assistant' && x.event.text.startsWith('arka plan işi bitti'), { after: first.seq });
    expect(await readArgv(t.argvLog, 2)).toHaveLength(2);
  });

  it('freed by the cap, the job is still work: a crash that ends it is followed by the note to go on', async () => {
    const t = make({ FAKE_CLAUDE_BG_CRASH: 'running' }, { backgroundLimitMs: 300 });
    const e = t.engine.hire({ name: 'Mert', role: 'r' });
    t.engine.send(e.id, 'BACKGROUND', 'system');
    const first = await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'turn.finished');
    await until(() => t.engine.ready(e.id), 3000);
    t.release(e.sessionId, '.bg');
    const told = await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'message.user', { after: first.seq, timeoutMs: 3000 });
    expect(told.event).toEqual({ type: 'message.user', text: CONTINUE_AFTER_CRASH, source: 'system' });
  });

  it('unless set, the cap is two hours', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      expect(BACKGROUND_LIMIT_MS).toBe(2 * 60 * 60_000);
      const t = make();
      const e = t.engine.hire({ name: 'Mert', role: 'r' });
      t.engine.send(e.id, 'BACKGROUND', 'system');
      await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'turn.finished');
      vi.advanceTimersByTime(BACKGROUND_LIMIT_MS - 60_000);
      expect(t.roster.get(e.id).lifecycle).toBe('working');
      vi.advanceTimersByTime(60_000);
      expect(t.roster.get(e.id).lifecycle).toBe('idle');
      expect(overdue(t, e.id).map((x) => x.event)).toEqual([{ type: 'background.overdue', jobs: ['arka plan işi'], limitMs: BACKGROUND_LIMIT_MS }]);
    } finally {
      vi.useRealTimers();
    }
  });
});
