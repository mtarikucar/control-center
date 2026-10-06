import { spawn } from 'node:child_process';
import type { Usage } from '@cc/shared';
import { modelUsageOf, usageOf } from './normalize.ts';

export interface OnceResult {
  ok: boolean;
  text: string;
  /** This run's main-loop tokens. */
  usage: Usage;
  /** Running totals of the (forked) session, which include the parent session's history. */
  sessionUsage: Usage | null;
  sessionCostUsd: number;
}

export interface OnceOptions {
  command: string[];
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  input: string;
  timeoutMs: number;
}

/** Runs `claude -p --output-format json` once with `input` on stdin. Never rejects. */
export function runOnce(o: OnceOptions): Promise<OnceResult> {
  const fail = (text: string): OnceResult => ({ ok: false, text, usage: usageOf(undefined), sessionUsage: null, sessionCostUsd: 0 });
  const [command, ...prefix] = o.command;
  if (!command) return Promise.resolve(fail('claude komutu boş'));
  return new Promise((resolve) => {
    const child = spawn(command, [...prefix, ...o.args], { cwd: o.cwd, env: o.env ?? process.env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), o.timeoutMs);
    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString('utf8');
    });
    child.stderr.on('data', (c: Buffer) => {
      stderr = (stderr + c.toString('utf8')).slice(-2000);
    });
    child.stdin.on('error', () => {});
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve(fail(err.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const line = stdout
        .trim()
        .split('\n')
        .reverse()
        .find((l) => l.trim().startsWith('{'));
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = line ? (JSON.parse(line) as Record<string, unknown>) : null;
      } catch {
        parsed = null;
      }
      if (!parsed) {
        resolve(fail(stderr.trim() || `claude ${code ?? '-'} koduyla çıktı`));
        return;
      }
      resolve({
        ok: code === 0 && parsed.is_error !== true,
        text: typeof parsed.result === 'string' ? parsed.result : '',
        usage: usageOf(parsed.usage),
        sessionUsage: modelUsageOf(parsed.modelUsage),
        sessionCostUsd: typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : 0,
      });
    });
    child.stdin.end(o.input);
  });
}
