import { mcpToolPrefix } from '../claude/normalize.ts';
import { capabilityVocabulary, toolClass, type ToolClass } from './capabilities.ts';

/** The permission rule that closes every tool of a server: `claude.ai Higgsfield` → `mcp__claude_ai_Higgsfield`. */
export const serverRule = (server: string): string => mcpToolPrefix(server).slice(0, -2);

/**
 * What an employee's session closes (B9b; B9 design §2 "B9b", pilot readiness C5-2): every outward connector tool the
 * role's capabilities do not open, every unclassified connector tool (the vocabulary is an allow-list), and the whole of
 * each server the registry closed. Candidates are the vocabulary's tools and every tool name a session ever reported —
 * not only the latest reports: a tool closed everywhere stops being reported and would otherwise open again. The
 * office's own tools and Claude Code's built-ins never enter (B9's other layers watch the shell, browser and files).
 */
export function sessionDeny(o: { capabilities: readonly string[]; seen: readonly string[]; closedServers: readonly string[]; classify?: (name: string) => ToolClass }): string[] {
  const classify = o.classify ?? toolClass;
  const closed = o.closedServers.filter((s) => s !== 'office').map((s) => ({ rule: serverRule(s), prefix: mcpToolPrefix(s) }));
  const names = new Set([...capabilityVocabulary().capabilities.flatMap((c) => c.tools), ...o.seen]);
  const deny = new Set(closed.map((c) => c.rule));
  for (const name of names) {
    if (closed.some((c) => name.startsWith(c.prefix))) continue;
    const c = classify(name);
    if (c.kind === 'unclassified' || (c.kind === 'classified' && c.outward && !o.capabilities.includes(c.capability))) deny.add(name);
  }
  return [...deny].sort();
}
