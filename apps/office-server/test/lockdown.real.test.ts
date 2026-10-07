import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { sessionArgs } from '../src/claude/args.ts';
import { tempDir } from './helpers.ts';

const enabled = process.env.OFFICE_SMOKE === '1';

describe.skipIf(!enabled)('lockdown with the real claude CLI', () => {
  it('a session opened with the office’s arguments has none of Claude’s scheduling tools', async () => {
    const cwd = tempDir();
    const args = sessionArgs({ model: 'haiku', sessionId: crypto.randomUUID(), resume: false });
    const child = spawn('claude', args, { cwd, stdio: ['pipe', 'pipe', 'ignore'] });
    let tools: string[] | null = null;
    const done = new Promise<void>((resolve) => {
      let buf = '';
      child.stdout.on('data', (chunk: Buffer) => {
        buf += chunk.toString('utf8');
        for (const line of buf.split('\n')) {
          try {
            const o = JSON.parse(line) as { type?: string; subtype?: string; tools?: string[] };
            if (o.type === 'system' && o.subtype === 'init' && o.tools) {
              tools = o.tools;
              resolve();
            }
          } catch {
            // partial line
          }
        }
      });
    });
    child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: 'Reply with the single word ok.' } })}\n`);
    await Promise.race([done, new Promise((r) => setTimeout(r, 90_000))]);
    child.kill('SIGKILL');
    expect(tools).not.toBeNull();
    for (const banned of ['CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup', 'RemoteTrigger']) expect(tools).not.toContain(banned);
    expect(tools).toContain('Bash');
  }, 120_000);
});
