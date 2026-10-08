import { describe, expect, it } from 'vitest';
import { employeeSettings, GATE_MATCHER, gateHookCommand, sessionArgs, sideQuestionArgs, terminalCommand } from '../src/claude/args.ts';
import { REPO_ROOT } from '../src/config.ts';

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

describe('claude args', () => {
  it('starts a new session in stream-json with the employee settings', () => {
    const args = sessionArgs({ model: 'haiku', sessionId: 'sid-1', resume: false, home: '/home/test' });
    expect(args.slice(0, 6)).toEqual(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']);
    expect(flag(args, '--model')).toBe('haiku');
    expect(flag(args, '--permission-mode')).toBe('bypassPermissions');
    expect(flag(args, '--setting-sources')).toBe('user,project,local');
    expect(flag(args, '--session-id')).toBe('sid-1');
    expect(args).not.toContain('--resume');
    expect(args).toContain('--replay-user-messages');
    expect(JSON.parse(flag(args, '--settings') ?? '')).toEqual(employeeSettings('/home/test'));
  });

  it('employee settings disable superpowers, the personal CLAUDE.md and Claude attribution', () => {
    expect(employeeSettings('/home/test')).toEqual({
      enabledPlugins: { 'superpowers@claude-plugins-official': false },
      claudeMdExcludes: ['/home/test/.claude/CLAUDE.md'],
      attribution: { commit: '', pr: '' },
    });
  });

  it('B9a (K1-5, K1-8): with the gate, the settings carry the PreToolUse hook and disableAllHooks: false, which a desk file cannot turn off', () => {
    const settings = employeeSettings('/home/test', { hook: "'/usr/bin/node' '/r/apps/office-server/hooks/gate.mjs'" });
    expect(settings).toEqual({
      ...employeeSettings('/home/test'),
      // Deney 6A/6B: a desk's .claude/settings.local.json with disableAllHooks: true turns the hook off unless --settings says false.
      disableAllHooks: false,
      hooks: { PreToolUse: [{ matcher: GATE_MATCHER, hooks: [{ type: 'command', command: "'/usr/bin/node' '/r/apps/office-server/hooks/gate.mjs'", timeout: 10 }] }] },
    });
    const args = sessionArgs({ model: 'haiku', sessionId: 's', resume: false, home: '/home/test', hook: 'h' });
    expect(JSON.parse(flag(args, '--settings') ?? '')).toEqual(employeeSettings('/home/test', { hook: 'h' }));
    // The side questions run with no tools at all: no hook there.
    expect(JSON.parse(flag(sideQuestionArgs({ model: 'haiku', sessionId: 's', home: '/home/test' }), '--settings') ?? '')).toEqual(employeeSettings('/home/test'));
  });

  it('B9a: the hook’s matcher takes the shell, file, web and connector tools, not the office’s own nor the read-only built-ins', () => {
    const re = new RegExp(GATE_MATCHER);
    for (const tool of ['Bash', 'Monitor', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'mcp__probe__ping', 'mcp__claude_ai_Gmail__send_message', 'mcp__plugin_playwright_playwright__browser_click']) expect(re.test(tool), tool).toBe(true);
    for (const tool of ['mcp__office__myTasks', 'mcp__office__approvalRequest', 'Read', 'Grep', 'Glob', 'ToolSearch', 'WebSearch', 'BashOutput', 'Writer']) expect(re.test(tool), tool).toBe(false);
  });

  it('B9a: the hook runs the checkout’s own script with the office’s node, quoted for the shell', () => {
    expect(gateHookCommand('/opt/n o/node')).toBe(`'/opt/n o/node' '${REPO_ROOT}/apps/office-server/hooks/gate.mjs'`);
  });

  it('resumes an existing session', () => {
    const args = sessionArgs({ model: 'sonnet', sessionId: 'sid-2', resume: true, home: '/home/test' });
    expect(flag(args, '--resume')).toBe('sid-2');
    expect(args).not.toContain('--session-id');
  });

  it('asks side questions on a tool-less fork with JSON output', () => {
    const args = sideQuestionArgs({ model: 'haiku', sessionId: 'sid-3', home: '/home/test' });
    expect(flag(args, '--output-format')).toBe('json');
    expect(flag(args, '--resume')).toBe('sid-3');
    expect(args).toContain('--fork-session');
    expect(args).toContain('--strict-mcp-config');
    expect(args.slice(-2)).toEqual(['--tools', '']);
    expect(args).not.toContain('--input-format');
  });

  it('builds a shell-safe terminal command', () => {
    expect(terminalCommand("/tmp/o'k/desks/ada", 'sid-4')).toBe(`cd '/tmp/o'\\''k/desks/ada' && claude --resume sid-4`);
  });

  it('gives the session the office tools when asked, keeping the owner’s other connections', () => {
    const config = JSON.stringify({ mcpServers: { office: { type: 'http', url: 'http://127.0.0.1:1/mcp' } } });
    const args = sessionArgs({ model: 'fable', sessionId: 's', resume: false, mcpConfig: config });
    expect(args[args.indexOf('--mcp-config') + 1]).toBe(config);
    expect(args).not.toContain('--strict-mcp-config');
    expect(args[args.indexOf('--model') + 1]).toBe('fable');
    expect(sessionArgs({ model: 'haiku', sessionId: 's', resume: false })).not.toContain('--mcp-config');
  });

  it('closes Claude’s own scheduler in every employee session', () => {
    const args = sessionArgs({ model: 'haiku', sessionId: 's', resume: false, home: '/home/test' });
    const i = args.indexOf('--disallowedTools');
    expect(i).toBeGreaterThan(0);
    expect(args.slice(i + 1, i + 6)).toEqual(['CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup', 'RemoteTrigger']);
    // The list must come before the session id so nothing is swallowed into it.
    expect(args.indexOf('--session-id')).toBeGreaterThan(i + 5);
  });
});
