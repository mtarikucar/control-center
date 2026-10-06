import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ModelAlias } from '@cc/shared';

/** Keeps every connection the owner has, but not superpowers, the personal CLAUDE.md or Claude attribution. */
export function employeeSettings(home: string = homedir()) {
  return {
    enabledPlugins: { 'superpowers@claude-plugins-official': false },
    claudeMdExcludes: [join(home, '.claude', 'CLAUDE.md')],
    attribution: { commit: '', pr: '' },
  };
}

function settingsArgs(home: string | undefined): string[] {
  return ['--setting-sources', 'user,project,local', '--settings', JSON.stringify(employeeSettings(home ?? homedir()))];
}

export function sessionArgs(o: { model: ModelAlias; sessionId: string; resume: boolean; home?: string }): string[] {
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
    ...settingsArgs(o.home),
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
