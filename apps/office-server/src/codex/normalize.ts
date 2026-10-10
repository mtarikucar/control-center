import type { OfficeEvent, Usage } from '@cc/shared';
import { truncate } from '../claude/normalize.ts';
import { num, obj, str } from './rpc.ts';

export function codexUsage(raw: unknown): Usage {
  const u = obj(raw);
  // Codex inputTokens includes cachedInputTokens; office totals keep them separately.
  return { inputTokens: Math.max(0, num(u.inputTokens) - num(u.cachedInputTokens)), outputTokens: num(u.outputTokens), cacheReadTokens: num(u.cachedInputTokens), cacheCreationTokens: 0 };
}

export function codexQuota(raw: unknown, rejected = false): OfficeEvent {
  const limits = obj(raw);
  const window = (v: unknown) => {
    const w = obj(v);
    return typeof w.resetsAt === 'number' ? { utilization: num(w.usedPercent) / 100, resetsAt: w.resetsAt * 1000 } : null;
  };
  const primary = window(limits.primary), secondary = window(limits.secondary);
  const full = [primary, secondary].filter((w) => w && w.utilization >= 1);
  return { type: 'quota.updated', status: rejected ? 'rejected' : 'allowed', fiveHour: primary, sevenDay: secondary, limitResetsAt: rejected && full.length ? Math.max(...full.map((w) => w!.resetsAt)) : null };
}

/** Completed messages are authoritative; deltas never create duplicate chat entries. */
export function codexItem(raw: unknown, completed: boolean): OfficeEvent[] {
  const i = obj(raw), id = str(i.id), type = str(i.type);
  if (type === 'agentMessage') return completed && str(i.text) ? [{ type: 'message.assistant', text: str(i.text) }] : [];
  let name: string, input: unknown;
  if (type === 'commandExecution') { name = 'Bash'; input = { command: i.command, cwd: i.cwd }; }
  else if (type === 'fileChange') { name = 'Edit'; input = i.changes; }
  else if (type === 'mcpToolCall') { name = `mcp__${str(i.server)}__${str(i.tool)}`; input = i.arguments; }
  else if (type === 'webSearch') { name = 'WebSearch'; input = i.action ?? { query: i.query }; }
  else return [];
  if (!completed) return [{ type: 'tool.started', toolUseId: id, name, input }];
  const failed = i.status === 'failed' || i.status === 'declined' || (type === 'commandExecution' && num(i.exitCode) !== 0) || !!i.error;
  return [{ type: 'tool.finished', toolUseId: id, isError: failed, output: truncate(str(i.aggregatedOutput) || str(obj(i.error).message) || (i.result ? JSON.stringify(i.result) : str(i.status))) }];
}
