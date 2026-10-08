import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ModelAlias } from '@cc/shared';
import { REPO_ROOT } from '../config.ts';

/**
 * The tools the gate's hook sees (B9a, design §3): the shell (Bash, and Monitor, which runs a command too), file
 * writes, web fetches, every connector tool but the office's own, and — compared with a real session's own tools
 * (review round 1) — SendMessage (another Claude session, the owner's own among them), PushNotification and
 * DesignSync. Read-only built-ins never reach the hook; ListAgents only lists, Skill only loads instructions, and
 * the calls of agents that Task and Workflow start meet the hook themselves (locked K3).
 */
export const GATE_MATCHER = '^(Bash|Monitor|Write|Edit|MultiEdit|NotebookEdit|WebFetch|SendMessage|PushNotification|DesignSync|mcp__(?!office__).+)$';

/** The hook's command: the office's own node running this checkout's script, quoted for the shell Claude Code uses. */
export function gateHookCommand(node: string = process.execPath, script: string = join(REPO_ROOT, 'apps', 'office-server', 'hooks', 'gate.mjs')): string {
  return `${shellQuote(node)} ${shellQuote(script)}`;
}

/**
 * Keeps every connection the owner has, but not superpowers, the personal CLAUDE.md or Claude attribution. With the
 * gate (B9a), a PreToolUse hook asks the office before a call runs; `disableAllHooks: false` here outranks a desk's
 * .claude/settings.local.json that would turn hooks off (design §11, deney 6A/6B).
 */
export function employeeSettings(home: string = homedir(), o: { hook?: string } = {}) {
  return {
    enabledPlugins: { 'superpowers@claude-plugins-official': false },
    claudeMdExcludes: [join(home, '.claude', 'CLAUDE.md')],
    attribution: { commit: '', pr: '' },
    ...(o.hook ? { disableAllHooks: false, hooks: { PreToolUse: [{ matcher: GATE_MATCHER, hooks: [{ type: 'command', command: o.hook, timeout: 10 }] }] } } : {}),
  };
}

/** Claude's own scheduler is closed in the office (spec §8): time goes through the office's clock, which the owner sees and the rules govern. */
export const DISALLOWED_TOOLS = ['CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup', 'RemoteTrigger'] as const;

function settingsArgs(home: string | undefined, hook?: string): string[] {
  return ['--setting-sources', 'user,project,local', '--settings', JSON.stringify(employeeSettings(home ?? homedir(), { hook }))];
}

/** `disallowed`: the employee's own closed tools (B9b, session-deny.ts), in the same one --disallowedTools flag as the scheduler. */
export function sessionArgs(o: { model: ModelAlias; sessionId: string; resume: boolean; home?: string; mcpConfig?: string; hook?: string; disallowed?: readonly string[] }): string[] {
  return [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--replay-user-messages',
    '--model',
    o.model,
    '--permission-mode',
    'bypassPermissions',
    ...settingsArgs(o.home, o.hook),
    '--disallowedTools',
    ...DISALLOWED_TOOLS,
    ...(o.disallowed ?? []),
    // The office tools come on top of every connection the owner has (no --strict-mcp-config).
    ...(o.mcpConfig ? ['--mcp-config', o.mcpConfig] : []),
    ...(o.resume ? ['--resume', o.sessionId] : ['--session-id', o.sessionId]),
  ];
}

/** The question goes on stdin; `--tools` is last because it swallows following arguments. */
export function sideQuestionArgs(o: { model: ModelAlias; sessionId: string; home?: string }): string[] {
  return [
    '-p',
    '--output-format',
    'json',
    '--model',
    o.model,
    '--resume',
    o.sessionId,
    '--fork-session',
    ...settingsArgs(o.home),
    '--strict-mcp-config',
    '--tools',
    '',
  ];
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function terminalCommand(deskPath: string, sessionId: string): string {
  return `cd ${shellQuote(deskPath)} && claude --resume ${sessionId}`;
}
