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

export function truncate(text: string, limit = TOOL_OUTPUT_LIMIT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n… (${text.length - limit} karakter kısaltıldı)`;
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

export function normalize(raw: unknown): OfficeEvent[] {
  if (!isObj(raw)) return [];
  switch (raw.type) {
    case 'system': {
      if (raw.subtype !== 'init') return [];
      const servers = Array.isArray(raw.mcp_servers) ? raw.mcp_servers.filter(isObj) : [];
      return [{ type: 'session.started', model: str(raw.model), mcp: servers.map((m) => ({ name: str(m.name), status: str(m.status) })) }];
    }
    case 'assistant':
      return blocks(raw.message).flatMap((b): OfficeEvent[] => {
        if (b.type === 'text' && str(b.text)) return [{ type: 'message.assistant', text: str(b.text) }];
        if (b.type === 'tool_use') return [{ type: 'tool.started', toolUseId: str(b.id), name: str(b.name), input: b.input ?? null }];
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
        },
      ];
    case 'rate_limit_event': {
      const info = isObj(raw.rate_limit_info) ? raw.rate_limit_info : {};
      const windows = isObj(info.unifiedWindows) ? info.unifiedWindows : {};
      let fiveHour = windowOf(windows.five_hour);
      let sevenDay = windowOf(windows.seven_day);
      if (!fiveHour && !sevenDay && typeof info.resetsAt === 'number') {
        const fallback = { utilization: info.status === 'rejected' ? 1 : num(info.utilization), resetsAt: info.resetsAt * 1000 };
        if (info.rateLimitType === 'seven_day') sevenDay = fallback;
        else fiveHour = fallback;
      }
      return [{ type: 'quota.updated', status: str(info.status), fiveHour, sevenDay }];
    }
    default:
      return [];
  }
}
