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
