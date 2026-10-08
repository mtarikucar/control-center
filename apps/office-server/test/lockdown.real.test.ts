import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DISALLOWED_TOOLS, sessionArgs } from '../src/claude/args.ts';
import { tempDir } from './helpers.ts';
import { LOCKED_ARGS } from './real-session.ts';

const enabled = process.env.OFFICE_SMOKE === '1';
const STUB = fileURLToPath(new URL('./fixtures/mcp-stub.mjs', import.meta.url));
/** One stub of the test's own (one harmless tool, it answers "pong"): with the lock, no connector of the owner's enters. */
const STUB_CONFIG = JSON.stringify({ mcpServers: { probe_lock: { command: process.execPath, args: [STUB, 'probe_lock'] } } });

/**
 * The office's arguments close Claude's own scheduler in every session (spec §8), checked on the real CLI. Locked
 * (playbook "gerçek claude testleri"; task 6b28255b): LOCKED_ARGS first, then the office's arguments with one stub as
 * the only MCP server. That no built-in but the scheduler is closed by the office is K1 (args.test.ts): the lock closes
 * Bash here, so it cannot be seen in this session. The session answers "ok" once, so the CLI reports its cost.
 * SMOKE_OUT=<file> writes the record.
 */
describe.skipIf(!enabled)('lockdown with the real claude CLI (locked: LOCKED_ARGS and one stub)', () => {
  it('a session opened with the office’s arguments has none of Claude’s scheduling tools, and only the stub as MCP server', async () => {
    const args = [...LOCKED_ARGS, ...sessionArgs({ model: 'haiku', sessionId: crypto.randomUUID(), resume: false, mcpConfig: STUB_CONFIG })];
    const child = spawn('claude', args, { cwd: tempDir(), stdio: ['pipe', 'pipe', 'ignore'] });
    let init: Record<string, unknown> | null = null;
    let result: Record<string, unknown> | null = null;
    const done = new Promise<void>((resolve) => {
      let buf = '';
      child.stdout.on('data', (chunk: Buffer) => {
        buf += chunk.toString('utf8');
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          try {
            const o = JSON.parse(line) as Record<string, unknown>;
            if (o.type === 'system' && o.subtype === 'init') init = o;
            if (o.type === 'result') {
              result = o;
              resolve();
            }
          } catch {
            // not JSON
          }
        }
      });
    });
    // The init comes with the first message and tells the connections as they stand then: let the stub connect first.
    await new Promise((r) => setTimeout(r, 4_000));
    child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: 'Reply with the single word ok. Use no tool.' } })}\n`);
    await Promise.race([done, new Promise((r) => setTimeout(r, 90_000))]);
    child.kill('SIGKILL');
    expect(init).not.toBeNull();
    const i = init as unknown as { tools: string[]; mcp_servers: Array<{ name: string; status: string }>; claude_code_version?: string; model?: string };
    const r = result as unknown as { subtype?: string; total_cost_usd?: number; num_turns?: number; result?: string } | null;
    const record = [
      `claude ${String(i.claude_code_version)}; model ${String(i.model)}`,
      `sunucular: ${i.mcp_servers.map((m) => `${m.name} ${m.status}`).join(', ')}`,
      `init.tools (${i.tools.length}): ${i.tools.join(', ')}`,
      `sonuç: ${r ? `${String(r.subtype)}, ${String(r.num_turns)} adım, maliyet $${(r.total_cost_usd ?? 0).toFixed(4)}, cevap ${JSON.stringify(r.result)}` : 'gelmedi (90 sn)'}`,
    ];
    if (process.env.SMOKE_OUT) writeFileSync(process.env.SMOKE_OUT, `${record.join('\n')}\n`);
    console.log(record.join('\n'));
    expect(i.mcp_servers.map((m) => m.name)).toEqual(['probe_lock']);
    for (const banned of DISALLOWED_TOOLS) expect(i.tools).not.toContain(banned);
    expect(r).not.toBeNull();
  }, 120_000);
});
