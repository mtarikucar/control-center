import { spawn } from 'node:child_process';
import { sessionArgs } from '../src/claude/args.ts';

/**
 * For the tests that open the real claude CLI (OFFICE_SMOKE=1): what keeps such a session from reaching outside, set
 * when it opens, not asked for in a prompt (review, Kerem): pass `--strict-mcp-config` so no connector of the owner's
 * enters it, and these built-in tools are not there — the ones that reach outside, run code or start agents.
 */
export const LOCKED_TOOLS = [
  'Bash', 'WebFetch', 'WebSearch', 'Task', 'Write', 'Edit', 'NotebookEdit', 'PushNotification', 'SendMessage', 'Workflow', 'Skill', 'DesignSync', 'Monitor',
  'EnterWorktree', 'ExitWorktree', 'ListAgents', 'TaskStop', 'LSP', 'ReportFindings',
] as const;

/** Prepended to the office's session arguments (the engine's claudeCommand takes it the same way). */
export const LOCKED_ARGS = ['--strict-mcp-config', '--disallowedTools', ...LOCKED_TOOLS];

/**
 * The system/init of a real session opened in `cwd` with the office's arguments, locked: only the given MCP servers
 * (--strict-mcp-config), the outward built-ins gone. The process is killed the moment the init arrives, before the
 * model answers anything. `disallowed`: the employee's own closed tools, as engine.#start gives them (B9b).
 */
export async function realInit(cwd: string, mcpConfig: string, o: { disallowed?: string[] } = {}): Promise<Record<string, unknown> | null> {
  const args = [...LOCKED_ARGS, ...sessionArgs({ model: 'haiku', sessionId: crypto.randomUUID(), resume: false, mcpConfig, disallowed: o.disallowed })];
  const child = spawn('claude', args, { cwd, stdio: ['pipe', 'pipe', 'ignore'] });
  let init: Record<string, unknown> | null = null;
  const done = new Promise<void>((resolve) => {
    let buf = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      for (const line of buf.split('\n')) {
        try {
          const o = JSON.parse(line) as Record<string, unknown>;
          if (o.type === 'system' && o.subtype === 'init') {
            init = o;
            child.kill('SIGKILL');
            resolve();
          }
        } catch {
          // partial line
        }
      }
    });
  });
  // The init comes with the first message and tells the connections as they stand then: let the servers connect first.
  await new Promise((r) => setTimeout(r, 4_000));
  child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: 'Reply with the single word ok.' } })}\n`);
  await Promise.race([done, new Promise((r) => setTimeout(r, 90_000))]);
  child.kill('SIGKILL');
  return init;
}

