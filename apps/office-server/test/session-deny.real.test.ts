import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DISALLOWED_TOOLS } from '../src/claude/args.ts';
import { toolClass, type ToolClass } from '../src/company/capabilities.ts';
import { sessionDeny } from '../src/company/session-deny.ts';
import { tempDir } from './helpers.ts';
import { LOCKED_TOOLS, realInit } from './real-session.ts';

const enabled = process.env.OFFICE_SMOKE === '1';
const STUB = fileURLToPath(new URL('./fixtures/mcp-stub.mjs', import.meta.url));

/**
 * B9b with the real claude CLI (C5-2 item 3), locked: only the test's three stub servers, each with one harmless tool
 * that answers "pong"; the session is killed at its init, before the model answers. No real connector's name is used
 * (B9 design: the lock principle): probe_send's tool stands for an outward one by an injected class, so the role's
 * capability opens it; the vocabulary's own classes are K1 (session-deny.test.ts).
 */
const SEND = 'mcp__probe_send__ping';
const OTHER = 'mcp__probe_other__ping';
const CLOSED = 'mcp__probe_closed__ping';
const classify = (name: string): ToolClass => (name === SEND ? { kind: 'classified', capability: 'email.send', outward: true } : toolClass(name));

describe.skipIf(!enabled)('B9b with the real claude CLI (locked: only the test’s own three stubs)', () => {
  it('a tool whose capability the role lacks is not in the session; with the capability it is; unclassified and closed ones never; the lock’s and the office’s closures hold together', { timeout: 300_000 }, async () => {
    const desk = tempDir('b9b-desk-');
    mkdirSync(desk, { recursive: true });
    const mcpConfig = JSON.stringify({ mcpServers: Object.fromEntries(['probe_send', 'probe_other', 'probe_closed'].map((n) => [n, { command: process.execPath, args: [STUB, n] }])) });
    // As the registry would have them: every name a session reported, probe_closed closed by the coordinator.
    const seen = [SEND, OTHER, CLOSED];
    const lines: string[] = [];
    const open = async (capabilities: string[]) => {
      const disallowed = sessionDeny({ capabilities, seen, closedServers: ['probe_closed'], classify });
      const init = await realInit(desk, mcpConfig, { disallowed });
      expect(init).not.toBeNull();
      const tools = init!.tools as string[];
      const servers = (init!.mcp_servers as Array<{ name: string; status: string }>).map((m) => `${m.name} ${m.status}`);
      lines.push(
        `## yetenekler: ${JSON.stringify(capabilities)}`,
        `claude ${String(init!.claude_code_version)}; sunucular: ${servers.join(', ')}`,
        `kapatma listesi (${disallowed.length}): ${disallowed.filter((t) => t.startsWith('mcp__probe')).join(', ')} + sözlüğün ${disallowed.filter((t) => !t.startsWith('mcp__probe')).length} dışa dönük aracı`,
        `init.tools (${tools.length}): ${tools.join(', ')}`,
        '',
      );
      return { tools, servers, disallowed };
    };
    try {
      const without = await open([]);
      const withSend = await open(['email.send']);
      for (const s of [without, withSend]) {
        expect(s.servers.sort()).toEqual(['probe_closed connected', 'probe_other connected', 'probe_send connected']);
        // Unclassified and closed: never in the session.
        expect(s.tools).not.toContain(OTHER);
        expect(s.tools).not.toContain(CLOSED);
        // Both --disallowedTools flags hold: the lock's (LOCKED_ARGS) and the office's own one (scheduler + this list).
        for (const t of [...LOCKED_TOOLS, ...DISALLOWED_TOOLS]) expect(s.tools).not.toContain(t);
      }
      expect(without.disallowed).toContain(SEND);
      expect(without.tools).not.toContain(SEND);
      expect(withSend.disallowed).not.toContain(SEND);
      expect(withSend.tools).toContain(SEND);
    } finally {
      const out = process.env.SMOKE_OUT;
      if (out) writeFileSync(out, `${lines.join('\n')}\n`);
      console.log(lines.join('\n'));
    }
  });
});
