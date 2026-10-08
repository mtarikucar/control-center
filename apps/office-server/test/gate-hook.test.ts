import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { classifyCall } from '../src/company/gate-policy.ts';
import { liveContext } from '../src/company/gate.ts';
import { tempDir } from './helpers.ts';

/**
 * B9a K2: the hook script in a child process, fed a synthetic stdin, against the test's own little office (no real
 * claude) — and the real context's questions to git, against a throwaway repository.
 */

const HOOK = fileURLToPath(new URL('../hooks/gate.mjs', import.meta.url));
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

interface Seen {
  auth: string | undefined;
  body: unknown;
}

/** A stand-in for the office's /gate/check: answers with `reply` (or never, or garbage) and records what it got. */
async function office(reply: (body: any) => { status?: number; text: string } | null) {
  const seen: Seen[] = [];
  const server: Server = createServer((req: IncomingMessage, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      let body: unknown = null;
      try {
        body = JSON.parse(data);
      } catch {
        body = data;
      }
      seen.push({ auth: req.headers.authorization, body });
      const r = reply(body);
      if (r === null) return; // never answers
      res.writeHead(r.status ?? 200, { 'content-type': 'application/json' });
      res.end(r.text);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/gate/check`, seen };
}

function hook(stdin: string, env: Record<string, string | undefined>): Promise<{ code: number | null; stderr: string; ms: number }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [HOOK], { env: { PATH: process.env.PATH, ...env } as NodeJS.ProcessEnv, stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => resolve({ code, stderr, ms: Date.now() - started }));
    child.stdin.end(stdin);
  });
}

const ping = JSON.stringify({ session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'mcp__probe__ping', tool_input: {}, cwd: '/tmp' });

describe('hooks/gate.mjs (K2): exit 0 lets the call run, exit 2 stops it; every failure is 2', () => {
  it('the office says allow → 0; it sends the session’s token and the hook’s input as it came', async () => {
    const o = await office(() => ({ text: JSON.stringify({ decision: 'allow', reason: 'serbest' }) }));
    const r = await hook(ping, { OFFICE_GATE_URL: o.url, OFFICE_GATE_TOKEN: 'abc' });
    expect(r.code).toBe(0);
    expect(o.seen).toEqual([{ auth: 'Bearer abc', body: JSON.parse(ping) }]);
  });

  it('the office says deny → 2, and its reason on stderr for the model', async () => {
    const o = await office(() => ({ text: JSON.stringify({ decision: 'deny', reason: 'OFİS KAPISI: diğer — “ping” onaysız yapılamaz.' }) }));
    const r = await hook(ping, { OFFICE_GATE_URL: o.url, OFFICE_GATE_TOKEN: 'abc' });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('OFİS KAPISI: diğer — “ping” onaysız yapılamaz.');
  });

  it('the office is down → 2', async () => {
    const o = await office(() => ({ text: '{}' }));
    const url = o.url.replace(/:\d+\//, ':1/');
    const r = await hook(ping, { OFFICE_GATE_URL: url, OFFICE_GATE_TOKEN: 'abc' });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/ulaşılamadı/);
  });

  it('a stdin it cannot read → 2, without asking the office', async () => {
    const o = await office(() => ({ text: JSON.stringify({ decision: 'allow' }) }));
    for (const bad of ['', '{bozuk', '[1]', JSON.stringify({ tool_input: {} })]) {
      const r = await hook(bad, { OFFICE_GATE_URL: o.url, OFFICE_GATE_TOKEN: 'abc' });
      expect(r.code, bad).toBe(2);
    }
    expect(o.seen).toEqual([]);
  });

  it('an office tool → 0 without asking the office (the matcher’s plan B)', async () => {
    const o = await office(() => ({ text: JSON.stringify({ decision: 'deny', reason: 'x' }) }));
    const r = await hook(JSON.stringify({ tool_name: 'mcp__office__myTasks', tool_input: {} }), { OFFICE_GATE_URL: o.url, OFFICE_GATE_TOKEN: 'abc' });
    expect(r.code).toBe(0);
    expect(o.seen).toEqual([]);
  });

  it('no address or token in the environment, a refusal (401), an answer that is not JSON, an answer it does not know → 2', async () => {
    const ok = await office(() => ({ text: JSON.stringify({ decision: 'allow' }) }));
    expect((await hook(ping, { OFFICE_GATE_TOKEN: 'abc' })).code).toBe(2);
    expect((await hook(ping, { OFFICE_GATE_URL: ok.url })).code).toBe(2);
    const refused = await office(() => ({ status: 401, text: JSON.stringify({ error: 'jeton' }) }));
    expect((await hook(ping, { OFFICE_GATE_URL: refused.url, OFFICE_GATE_TOKEN: 'abc' })).code).toBe(2);
    const garbage = await office(() => ({ text: '<html>' }));
    expect((await hook(ping, { OFFICE_GATE_URL: garbage.url, OFFICE_GATE_TOKEN: 'abc' })).code).toBe(2);
    // An error status never lets a call through, whatever its body says.
    const broken = await office(() => ({ status: 500, text: JSON.stringify({ decision: 'allow' }) }));
    expect((await hook(ping, { OFFICE_GATE_URL: broken.url, OFFICE_GATE_TOKEN: 'abc' })).code).toBe(2);
    const odd = await office(() => ({ text: JSON.stringify({ decision: 'maybe' }) }));
    expect((await hook(ping, { OFFICE_GATE_URL: odd.url, OFFICE_GATE_TOKEN: 'abc' })).code).toBe(2);
  });

  it('an office that never answers → 2 within the hook’s own time limit', async () => {
    const o = await office(() => null);
    const r = await hook(ping, { OFFICE_GATE_URL: o.url, OFFICE_GATE_TOKEN: 'abc', OFFICE_GATE_TIMEOUT_MS: '300' });
    expect(r.code).toBe(2);
    expect(r.ms).toBeLessThan(5000);
  }, 10_000);

  it('OFFICE_GATE_TRACE: each run leaves the tool’s name (the K3 test of the matcher reads it)', async () => {
    const o = await office(() => ({ text: JSON.stringify({ decision: 'allow' }) }));
    const trace = join(tempDir(), 'trace.log');
    await hook(ping, { OFFICE_GATE_URL: o.url, OFFICE_GATE_TOKEN: 'abc', OFFICE_GATE_TRACE: trace });
    await hook(JSON.stringify({ tool_name: 'mcp__office__myTasks' }), { OFFICE_GATE_URL: o.url, OFFICE_GATE_TOKEN: 'abc', OFFICE_GATE_TRACE: trace });
    expect(readFileSync(trace, 'utf8').trim().split('\n')).toEqual(['mcp__probe__ping', 'mcp__office__myTasks']);
  });
});

describe('the real context (K2): git is asked about the live checkout’s worktrees, in a throwaway repository', () => {
  it('a clean sibling worktree may go; one with uncommitted work may not; the live checkout’s own rules stand', async () => {
    const root = tempDir('gate-k2-');
    const repo = join(root, 'control-center');
    mkdirSync(repo);
    const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' }).toString();
    git(repo, 'init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'a.txt'), 'a');
    git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'init', '--allow-empty');
    git(repo, 'add', 'a.txt');
    git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'a');
    git(repo, 'worktree', 'add', '-q', '--detach', join(root, 'clean'), 'main');
    git(repo, 'worktree', 'add', '-q', '--detach', join(root, 'dirty'), 'main');
    writeFileSync(join(root, 'dirty', 'yeni.txt'), 'commit edilmemiş');
    const data = join(root, 'data');
    const desk = join(data, 'desks', 'mert');
    mkdirSync(desk, { recursive: true });
    const live = liveContext({ repoRoot: repo, dataDir: data, home: root, port: () => 4319, hosts: [] });
    const ctx = live({ slug: 'mert' });
    // Review round 1 (Kerem, minor): git is never run in the office's event loop. Before an answer comes, a worktree is
    // taken as dirty (the careful side) and the list as empty; the gate then asks git asynchronously and classifies again.
    expect(ctx.worktrees()).toEqual([]);
    expect([ctx.dirty(join(root, 'clean')), ctx.dirty(join(root, 'dirty'))]).toEqual([true, true]);
    expect(live.git.missing()).toBe(true);
    await live.git.refresh();
    expect(live.git.missing()).toBe(false);
    expect(ctx.worktrees().sort()).toEqual([join(root, 'clean'), join(root, 'dirty'), repo].sort());
    expect([ctx.dirty(join(root, 'clean')), ctx.dirty(join(root, 'dirty'))]).toEqual([false, true]);
    expect(ctx.toplevel(join(repo, 'apps', 'yok'))).toBe(repo);
    expect(ctx.toplevel(join(root, 'clean'))).toBe(join(root, 'clean'));
    const bash = (command: string, cwd = desk) => classifyCall('Bash', { command }, cwd, ctx);
    expect(bash(`rm -rf ${join(root, 'clean')}`).gated).toBe(false);
    expect(bash(`rm -rf ${join(root, 'dirty')}`).parts.map((p) => p.kind)).toEqual(['delete']);
    expect(bash(`git -C ${repo} worktree remove --force ${join(root, 'dirty')}`).parts.map((p) => p.kind)).toEqual(['delete']);
    expect(bash(`git -C ${repo} worktree remove --force ${join(root, 'clean')}`).gated).toBe(false);
    expect(bash('git checkout -b x', repo).parts.map((p) => p.kind)).toEqual(['self']);
    expect(bash('git checkout -b x', join(root, 'clean')).gated).toBe(false);
    // The gate itself asks git when it must, and classifies again with the answer.
    const { Gate } = await import('../src/company/gate.ts');
    const events: unknown[] = [];
    const fresh = liveContext({ repoRoot: repo, dataDir: data, home: root, port: () => 4319, hosts: [] });
    const gate = new Gate({
      approvals: { pass: () => ({ ok: false as const, missing: { kind: 'delete' as const, target: '', why: '' } }) } as never,
      events: { append: (_: unknown, e: unknown) => events.push(e) } as never,
      roster: { get: () => ({ slug: 'mert' }) } as never,
      enabled: () => true,
      context: fresh,
      git: fresh.git,
    });
    // While git answers, the office's event loop runs on (a timer set before the check fires before it ends).
    let ticked = false;
    setTimeout(() => void (ticked = true), 0);
    const first = gate.check('mert', { tool_name: 'Bash', tool_input: { command: `rm -rf ${join(root, 'clean')}` }, cwd: desk });
    expect((await first).decision).toBe('allow');
    expect(ticked).toBe(true);
    expect((await gate.check('mert', { tool_name: 'Bash', tool_input: { command: `rm -rf ${join(root, 'dirty')}` }, cwd: desk })).decision).toBe('deny');
    // A script is read from the disk as it stands.
    writeFileSync(join(desk, 'yayin.sh'), 'git push origin main\n');
    expect(bash('bash yayin.sh').parts.map((p) => p.kind)).toEqual(['publish']);
  });
});
