import { describe, expect, it } from 'vitest';
import { DISALLOWED_TOOLS, employeeSettings, sessionArgs, sideQuestionArgs, terminalCommand, GATE_MATCHER, gateHookCommand } from '../src/claude/args.ts';
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
    // Review round 1 (Kerem): the session's own tools compared — SendMessage reaches another Claude session (the owner's),
    // PushNotification and DesignSync go out. ListAgents only lists; Skill only loads instructions; Task and Workflow
    // start agents whose own calls meet the hook (locked K3).
    for (const tool of ['Bash', 'Monitor', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'SendMessage', 'PushNotification', 'DesignSync', 'mcp__probe__ping', 'mcp__claude_ai_Gmail__send_message', 'mcp__plugin_playwright_playwright__browser_click']) expect(re.test(tool), tool).toBe(true);
    for (const tool of ['mcp__office__myTasks', 'mcp__office__approvalRequest', 'Read', 'Grep', 'Glob', 'ToolSearch', 'WebSearch', 'BashOutput', 'Writer', 'ListAgents', 'Skill', 'Task', 'Workflow']) expect(re.test(tool), tool).toBe(false);
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

  it('B9b: the employee’s own closed tools go into the same one --disallowedTools flag, after the scheduler', () => {
    const deny = ['mcp__claude_ai_Gmail__send_message', 'mcp__claude_ai_Higgsfield'];
    const args = sessionArgs({ model: 'haiku', sessionId: 's', resume: false, home: '/home/test', disallowed: deny });
    expect(args.filter((a) => a === '--disallowedTools')).toHaveLength(1);
    const i = args.indexOf('--disallowedTools');
    expect(args.slice(i + 1, i + 8)).toEqual(['CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup', 'RemoteTrigger', ...deny]);
    expect(args.indexOf('--session-id')).toBeGreaterThan(i + 7);
  });

  it('B9b: with nothing of the employee’s closed the arguments are what they were', () => {
    const base = { model: 'haiku' as const, sessionId: 's', resume: false, home: '/home/test' };
    expect(sessionArgs({ ...base, disallowed: [] })).toEqual(sessionArgs(base));
  });

  it('closes no built-in tool of Claude Code’s but its scheduler (moved from lockdown.real, whose session is now locked)', () => {
    const args = sessionArgs({ model: 'haiku', sessionId: 's', resume: false, home: '/home/test' });
    const i = args.indexOf('--disallowedTools');
    const end = args.findIndex((a, j) => j > i && a.startsWith('--'));
    expect(args.slice(i + 1, end)).toEqual([...DISALLOWED_TOOLS]);
    for (const builtin of ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite', 'NotebookEdit']) expect(args).not.toContain(builtin);
  });
});

