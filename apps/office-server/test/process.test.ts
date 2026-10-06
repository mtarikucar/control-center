import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runOnce } from '../src/claude/once.ts';
import { ClaudeProcess } from '../src/claude/process.ts';
import { FAKE_CLAUDE, tempDir, until } from './helpers.ts';

type Line = { type?: string; subtype?: string };

function spawnFake(extraEnv: Record<string, string> = {}) {
  const lines: Line[] = [];
  const exits: Array<{ code: number | null; signal: string | null; stderr: string }> = [];
  const proc = new ClaudeProcess(
    { command: [process.execPath, FAKE_CLAUDE], args: ['--session-id', crypto.randomUUID()], cwd: tempDir(), env: { ...process.env, FAKE_CLAUDE_STATE: tempDir(), ...extraEnv } },
    { onJson: (o) => lines.push(o as Line), onExit: (code, signal, stderr) => exits.push({ code, signal, stderr }) },
  );
  return { proc, lines, exits };
}

describe('ClaudeProcess', () => {
  it('sends a user message and emits parsed JSON lines, then closes cleanly', async () => {
    const { proc, lines, exits } = spawnFake();
    proc.sendUser('merhaba');
    await until(() => lines.some((l) => l.type === 'result'));
    expect(lines.map((l) => l.type)).toEqual(['system', 'assistant', 'rate_limit_event', 'result']);
    await proc.close();
    expect(proc.exited).toBe(true);
    expect(exits).toEqual([{ code: 0, signal: null, stderr: '' }]);
    expect(() => proc.sendUser('x')).toThrow(/kapalı/);
  });

  it('interrupt ends a running turn and the process stays usable', async () => {
    const { proc, lines } = spawnFake();
    proc.sendUser('SLOW job');
    await until(() => lines.some((l) => l.type === 'assistant'));
    proc.interrupt();
    await until(() => lines.some((l) => l.type === 'result'));
    expect(lines.find((l) => l.type === 'result')).toMatchObject({ subtype: 'error_during_execution' });
    expect(lines.some((l) => l.type === 'control_response')).toBe(true);
    proc.sendUser('sonra');
    await until(() => lines.filter((l) => l.type === 'result').length === 2);
    await proc.close();
  });

  it('review focus: ignores non-JSON stdout lines', async () => {
    const { proc, lines } = spawnFake({ FAKE_CLAUDE_NOISE: '1' });
    proc.sendUser('merhaba');
    await until(() => lines.some((l) => l.type === 'result'));
    expect(lines[0]?.type).toBe('system');
    await proc.close();
  });

  it('reports an unexpected exit with the stderr tail', async () => {
    const { proc, exits } = spawnFake();
    proc.sendUser('CRASH');
    await until(() => exits.length === 1);
    expect(exits[0]).toMatchObject({ code: 3 });
    expect(exits[0]?.stderr).toContain('boom: fake crash');
    expect(proc.exited).toBe(true);
  });

  it('kills a claude that ignores the end of its input and SIGTERM', async () => {
    const { proc, lines, exits } = spawnFake({ FAKE_CLAUDE_IGNORE_TERM: '1' });
    proc.sendUser('merhaba');
    await until(() => lines.some((l) => l.type === 'result'));
    const started = Date.now();
    await Promise.race([proc.close(200), new Promise((r) => setTimeout(r, 3000))]);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(exits[0]?.signal).toBe('SIGKILL');
  });

  it('review focus: also ends what its tools left running, and does not hang on their open pipes', async () => {
    const pidFile = join(tempDir(), 'grandchild.pid');
    const { proc, lines } = spawnFake({ FAKE_CLAUDE_IGNORE_TERM: '1', FAKE_CLAUDE_GRANDCHILD: pidFile });
    proc.sendUser('merhaba');
    await until(() => lines.some((l) => l.type === 'result') && existsSync(pidFile));
    const grandchild = Number(readFileSync(pidFile, 'utf8'));
    const alive = () => {
      try {
        process.kill(grandchild, 0);
        return true;
      } catch {
        return false;
      }
    };
    try {
      const closed = await Promise.race([proc.close(200).then(() => 'closed'), new Promise((r) => setTimeout(() => r('hung'), 3000))]);
      expect(closed).toBe('closed');
      await until(() => !alive(), 2000);
    } finally {
      if (alive()) process.kill(grandchild, 'SIGKILL');
    }
  });

  it('reports a missing binary as an exit instead of throwing', async () => {
    const exits: string[] = [];
    const proc = new ClaudeProcess(
      { command: ['/nonexistent/claude-binary'], args: [], cwd: tempDir() },
      { onJson: () => {}, onExit: (_c, _s, stderr) => exits.push(stderr) },
    );
    await until(() => exits.length === 1);
    expect(exits[0]).toContain('ENOENT');
    expect(proc.exited).toBe(true);
  });
});

describe('runOnce', () => {
  it('feeds the input on stdin and parses the JSON result', async () => {
    const r = await runOnce({ command: [process.execPath, FAKE_CLAUDE], args: ['--output-format', 'json'], cwd: tempDir(), env: { ...process.env, FAKE_CLAUDE_STATE: tempDir() }, input: 'ne yapıyorsun?', timeoutMs: 5000 });
    expect(r).toEqual({
      ok: true,
      text: 'side:ne yapıyorsun?|history:0',
      usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 100, cacheCreationTokens: 50 },
      sessionUsage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 100, cacheCreationTokens: 50 },
      sessionCostUsd: 0.002,
    });
  });

  it('does not start at all when it is already aborted (the office is shutting down)', async () => {
    const abort = new AbortController();
    abort.abort();
    const r = await runOnce({
      command: [process.execPath, FAKE_CLAUDE], args: ['--output-format', 'json'], cwd: tempDir(),
      env: { ...process.env, FAKE_CLAUDE_STATE: tempDir(), FAKE_CLAUDE_SIDE_HANG: '1' }, input: 'x', timeoutMs: 20_000, signal: abort.signal,
    });
    expect(r.ok).toBe(false);
  });

  it('reports failure when the command cannot run', async () => {
    const r = await runOnce({ command: ['/nonexistent/claude-binary'], args: [], cwd: tempDir(), input: 'x', timeoutMs: 5000 });
    expect(r.ok).toBe(false);
    expect(r.text).toContain('ENOENT');
  });
});
