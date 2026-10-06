import { describe, expect, it } from 'vitest';
import { TOOL_OUTPUT_LIMIT, normalize, truncate } from '../src/claude/normalize.ts';

// Shapes copied from a real `claude -p --output-format stream-json --verbose` run (2026-10-06), trimmed.
const INIT = {
  type: 'system',
  subtype: 'init',
  session_id: 's1',
  model: 'claude-haiku-4-5-20251001',
  cwd: '/d',
  permissionMode: 'bypassPermissions',
  mcp_servers: [
    { name: 'office', status: 'connected', source: 'dynamic' },
    { name: 'claude.ai Gmail', status: 'needs-auth' },
  ],
  tools: [],
};
const assistant = (content: unknown[]) => ({
  type: 'assistant',
  session_id: 's1',
  parent_tool_use_id: null,
  message: { id: 'msg_1', role: 'assistant', content },
});
const TOOL_USE = assistant([{ type: 'tool_use', id: 'toolu_01Q', name: 'Bash', input: { command: 'sleep 4', description: 'Sleep for 4 seconds' } }]);
const toolResult = (content: unknown, isError = false) => ({
  type: 'user',
  session_id: 's1',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01Q', is_error: isError, content }] },
  tool_use_result: { stdout: '', stderr: '' },
});
const RATE = {
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'allowed',
    resetsAt: 1791290400,
    rateLimitType: 'five_hour',
    overageStatus: 'rejected',
    isUsingOverage: false,
    unifiedWindows: { five_hour: { utilization: 0.01, resetsAt: 1791290400 }, seven_day: { utilization: 0, resetsAt: 1791878400 } },
  },
  session_id: 's1',
};
const RESULT = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  num_turns: 4,
  total_cost_usd: 0.0216893,
  usage: { input_tokens: 18, cache_creation_input_tokens: 8115, cache_read_input_tokens: 35213, output_tokens: 384 },
  result: '7 × 6 = 42.',
  session_id: 's1',
};

describe('normalize', () => {
  it('maps init to session.started with the MCP connection states', () => {
    expect(normalize(INIT)).toEqual([
      {
        type: 'session.started',
        model: 'claude-haiku-4-5-20251001',
        mcp: [
          { name: 'office', status: 'connected' },
          { name: 'claude.ai Gmail', status: 'needs-auth' },
        ],
      },
    ]);
  });

  it('maps tool_use, text and drops thinking blocks', () => {
    expect(normalize(TOOL_USE)).toEqual([
      { type: 'tool.started', toolUseId: 'toolu_01Q', name: 'Bash', input: { command: 'sleep 4', description: 'Sleep for 4 seconds' } },
    ]);
    expect(normalize(assistant([{ type: 'text', text: 'WORK-DONE' }]))).toEqual([{ type: 'message.assistant', text: 'WORK-DONE' }]);
    expect(normalize(assistant([{ type: 'thinking', thinking: '...' }]))).toEqual([]);
  });

  it('maps tool results given as a string or as text blocks', () => {
    expect(normalize(toolResult('(Bash completed with no output)'))).toEqual([
      { type: 'tool.finished', toolUseId: 'toolu_01Q', isError: false, output: '(Bash completed with no output)' },
    ]);
    expect(normalize(toolResult([{ type: 'text', text: 'line1' }, { type: 'text', text: 'line2' }], true))).toEqual([
      { type: 'tool.finished', toolUseId: 'toolu_01Q', isError: true, output: 'line1\nline2' },
    ]);
  });

  it('review focus: truncates huge tool output', () => {
    const [event] = normalize(toolResult('x'.repeat(10_000)));
    expect(event?.type).toBe('tool.finished');
    const output = (event as { output: string }).output;
    expect(output.startsWith('x'.repeat(TOOL_OUTPUT_LIMIT))).toBe(true);
    expect(output).toContain('(6000 karakter kısaltıldı)');
    expect(truncate('kısa')).toBe('kısa');
  });

  it('maps rate_limit_event windows to milliseconds', () => {
    expect(normalize(RATE)).toEqual([
      {
        type: 'quota.updated',
        status: 'allowed',
        fiveHour: { utilization: 0.01, resetsAt: 1791290400000 },
        sevenDay: { utilization: 0, resetsAt: 1791878400000 },
        limitResetsAt: null,
      },
    ]);
  });

  it('falls back to resetsAt when unifiedWindows is missing', () => {
    const raw = { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 100, rateLimitType: 'seven_day' } };
    expect(normalize(raw)).toEqual([{ type: 'quota.updated', status: 'rejected', fiveHour: null, sevenDay: { utilization: 1, resetsAt: 100_000 }, limitResetsAt: 100_000 }]);
  });

  it('puts a per-model weekly limit on the weekly meter, not the five-hour one', () => {
    const raw = { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 100, rateLimitType: 'seven_day_opus' } };
    expect(normalize(raw)).toEqual([{ type: 'quota.updated', status: 'rejected', fiveHour: null, sevenDay: { utilization: 1, resetsAt: 100_000 }, limitResetsAt: 100_000 }]);
  });

  it('maps result to turn.finished, including an interrupted turn', () => {
    expect(normalize(RESULT)).toEqual([
      {
        type: 'turn.finished',
        ok: true,
        subtype: 'success',
        usage: { inputTokens: 18, outputTokens: 384, cacheReadTokens: 35213, cacheCreationTokens: 8115 },
        costUsd: 0.0216893,
        numTurns: 4,
        queuedTurns: 0,
        sessionUsage: null,
        sessionCostUsd: 0.0216893,
      },
    ]);
    const interrupted = { type: 'result', subtype: 'error_during_execution', is_error: true, num_turns: 1, result: null };
    expect(normalize(interrupted)).toEqual([
      {
        type: 'turn.finished',
        ok: false,
        subtype: 'error_during_execution',
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
        costUsd: 0,
        numTurns: 1,
        queuedTurns: 0,
        sessionUsage: null,
        sessionCostUsd: 0,
      },
    ]);
  });

  it('carries the session running totals summed over every model in modelUsage', () => {
    const raw = {
      ...RESULT,
      total_cost_usd: 0.05,
      modelUsage: {
        'claude-haiku-4-5': { inputTokens: 28, outputTokens: 453, cacheReadInputTokens: 57136, cacheCreationInputTokens: 8267, costUSD: 0.03 },
        'claude-sonnet-5-5': { inputTokens: 2, outputTokens: 7, cacheReadInputTokens: 4, cacheCreationInputTokens: 1, costUSD: 0.02 },
      },
    };
    expect(normalize(raw)[0]).toMatchObject({
      type: 'turn.finished',
      sessionUsage: { inputTokens: 30, outputTokens: 460, cacheReadTokens: 57140, cacheCreationTokens: 8268 },
      sessionCostUsd: 0.05,
    });
  });

  it('reports follow-up turns claude has queued', () => {
    expect(normalize({ ...RESULT, queued_turn_count: 2 })[0]).toMatchObject({ type: 'turn.finished', queuedTurns: 2 });
  });

  it('ignores everything else', () => {
    expect(normalize({ type: 'control_response', response: { subtype: 'success' } })).toEqual([]);
    expect(normalize({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 50 })).toEqual([]);
    expect(normalize({ type: 'user', message: { role: 'user', content: 'düz metin' } })).toEqual([]);
    expect(normalize(null)).toEqual([]);
    expect(normalize('metin')).toEqual([]);
    expect(normalize([1, 2])).toEqual([]);
  });

  it('names the limiting window when a per-model limit rejects', () => {
    const raw = {
      type: 'rate_limit_event',
      rate_limit_info: { status: 'rejected', resetsAt: 500, rateLimitType: 'seven_day_opus', unifiedWindows: { five_hour: { utilization: 0.3, resetsAt: 100 }, seven_day: { utilization: 0.5, resetsAt: 200 } } },
    };
    expect(normalize(raw)[0]).toMatchObject({ type: 'quota.updated', status: 'rejected', limitResetsAt: 500_000 });
  });

  it('shortens long text fields of a tool input and keeps the short ones', () => {
    const [event] = normalize(assistant([{ type: 'tool_use', id: 't', name: 'Write', input: { file_path: '/d/a.txt', content: 'x'.repeat(10_000) } }]));
    const input = (event as { input: Record<string, string> }).input;
    expect(input.file_path).toBe('/d/a.txt');
    expect(input.content!.length).toBeLessThan(2100);
    expect(input.content).toContain('kısaltıldı');
  });
});
