import type { OfficeEvent, QuotaWindow, Usage } from '@cc/shared';

export const TOOL_OUTPUT_LIMIT = 4000;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function usageOf(raw: unknown): Usage {
  const u = isObj(raw) ? raw : {};
  return {
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheReadTokens: num(u.cache_read_input_tokens),
    cacheCreationTokens: num(u.cache_creation_input_tokens),
  };
}

/** Sums `modelUsage` (running totals per model, subagents included); null when claude did not send it. */
export function modelUsageOf(raw: unknown): Usage | null {
  if (!isObj(raw)) return null;
  const models = Object.values(raw).filter(isObj);
  if (models.length === 0) return null;
  return models.reduce<Usage>(
    (sum, m) => ({
      inputTokens: sum.inputTokens + num(m.inputTokens),
      outputTokens: sum.outputTokens + num(m.outputTokens),
      cacheReadTokens: sum.cacheReadTokens + num(m.cacheReadInputTokens),
      cacheCreationTokens: sum.cacheCreationTokens + num(m.cacheCreationInputTokens),
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  );
}

/** What changed between two running totals; a total that went down means claude restarted its count. */
export function usageSince(now: Usage, before: Usage): Usage {
  const d = (a: number, b: number) => (a >= b ? a - b : a);
  return {
    inputTokens: d(now.inputTokens, before.inputTokens),
    outputTokens: d(now.outputTokens, before.outputTokens),
    cacheReadTokens: d(now.cacheReadTokens, before.cacheReadTokens),
    cacheCreationTokens: d(now.cacheCreationTokens, before.cacheCreationTokens),
  };
}

export function truncate(text: string, limit = TOOL_OUTPUT_LIMIT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n… (${text.length - limit} karakter kısaltıldı)`;
}

const INPUT_FIELD_LIMIT = 2000;

/** Tool inputs can carry whole files (Write, Edit, MultiEdit's edits); keep every field but shorten long text. */
function shortenInput(input: unknown, depth = 0): unknown {
  if (typeof input === 'string') return truncate(input, INPUT_FIELD_LIMIT);
  if (depth >= 4) return input;
  if (Array.isArray(input)) return input.map((v) => shortenInput(v, depth + 1));
  if (isObj(input)) return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, shortenInput(v, depth + 1)]));
  return input ?? null;
}

function windowOf(raw: unknown): QuotaWindow | null {
  if (!isObj(raw) || typeof raw.resetsAt !== 'number') return null;
  return { utilization: num(raw.utilization), resetsAt: raw.resetsAt * 1000 };
}

function blocks(message: unknown): Obj[] {
  if (!isObj(message) || !Array.isArray(message.content)) return [];
  return message.content.filter(isObj);
}

function toolOutput(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(isObj)
    .map((b) => str(b.text))
    .filter(Boolean)
    .join('\n');
}

/** The uuid of a message claude acknowledges having consumed (stream-json `--replay-user-messages`). */
export function replayedUuid(raw: unknown): string | null {
  if (!isObj(raw) || raw.type !== 'user' || raw.isReplay !== true) return null;
  return typeof raw.uuid === 'string' ? raw.uuid : null;
}

/**
 * A job the session runs beside its turns (Bash run_in_background, Monitor, a background agent) started or ended,
 * from claude's `system` task messages — counted as the CLI's own session runner counts them.
 */
export function taskChange(raw: unknown): { taskId: string; running: boolean } | null {
  if (!isObj(raw) || raw.type !== 'system' || typeof raw.task_id !== 'string') return null;
  if (raw.subtype === 'task_started') return raw.task_type === 'in_process_teammate' ? null : { taskId: raw.task_id, running: true };
  if (raw.subtype === 'task_notification') return { taskId: raw.task_id, running: false };
  const status = isObj(raw.patch) ? raw.patch.status : undefined;
  if (raw.subtype === 'task_updated' && (status === 'completed' || status === 'failed' || status === 'killed')) return { taskId: raw.task_id, running: false };
  return null;
}

/** How the CLI names a server's tools: `claude.ai Gmail` → `mcp__claude_ai_Gmail__…`. */
export function mcpToolPrefix(server: string): string {
  return `mcp__${server.replace(/[^A-Za-z0-9_-]/g, '_')}__`;
}

export function normalize(raw: unknown): OfficeEvent[] {
  if (!isObj(raw)) return [];
  switch (raw.type) {
    case 'system': {
      if (raw.subtype !== 'init') return [];
      const servers = Array.isArray(raw.mcp_servers) ? raw.mcp_servers.filter(isObj) : [];
      // The session's own tool list: a server the desk's settings deny stays connected but has none of its tools in it.
      const tools = Array.isArray(raw.tools) ? raw.tools.filter((t): t is string => typeof t === 'string') : null;
      const count = (name: string) => tools!.filter((t) => t.startsWith(mcpToolPrefix(name))).length;
      return [
        {
          type: 'session.started',
          model: str(raw.model),
          mcp: servers.map((m) => (tools === null ? { name: str(m.name), status: str(m.status) } : { name: str(m.name), status: str(m.status), tools: count(str(m.name)) })),
        },
      ];
    }
    case 'assistant':
      return blocks(raw.message).flatMap((b): OfficeEvent[] => {
        if (b.type === 'text' && str(b.text)) return [{ type: 'message.assistant', text: str(b.text) }];
        if (b.type === 'tool_use') return [{ type: 'tool.started', toolUseId: str(b.id), name: str(b.name), input: shortenInput(b.input) }];
        return [];
      });
    case 'user':
      return blocks(raw.message).flatMap((b): OfficeEvent[] =>
        b.type === 'tool_result'
          ? [{ type: 'tool.finished', toolUseId: str(b.tool_use_id), isError: b.is_error === true, output: truncate(toolOutput(b.content)) }]
          : [],
      );
    case 'result':
      return [
        {
          type: 'turn.finished',
          ok: raw.subtype === 'success' && raw.is_error !== true,
          subtype: str(raw.subtype),
          usage: usageOf(raw.usage),
          costUsd: num(raw.total_cost_usd),
          numTurns: num(raw.num_turns),
          queuedTurns: num(raw.queued_turn_count),
          sessionUsage: modelUsageOf(raw.modelUsage),
          sessionCostUsd: num(raw.total_cost_usd),
        },
      ];
    case 'rate_limit_event': {
      const info = isObj(raw.rate_limit_info) ? raw.rate_limit_info : {};
      const windows = isObj(info.unifiedWindows) ? info.unifiedWindows : {};
      let fiveHour = windowOf(windows.five_hour);
      let sevenDay = windowOf(windows.seven_day);
      if (!fiveHour && !sevenDay && typeof info.resetsAt === 'number') {
        const fallback = { utilization: info.status === 'rejected' ? 1 : num(info.utilization), resetsAt: info.resetsAt * 1000 };
        // Per-model weekly limits (seven_day_opus, …) are weekly too.
        if (str(info.rateLimitType).startsWith('seven_day')) sevenDay = fallback;
        else fiveHour = fallback;
      }
      const limitResetsAt = info.status === 'rejected' && typeof info.resetsAt === 'number' ? info.resetsAt * 1000 : null;
      return [{ type: 'quota.updated', status: str(info.status), fiveHour, sevenDay, limitResetsAt }];
    }
    default:
      return [];
  }
}
