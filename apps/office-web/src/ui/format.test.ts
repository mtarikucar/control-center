import { describe, expect, it } from 'vitest';
import { formatClock, formatCost, formatPercent, formatReset, formatTokens, formatWhenTR, summarizeToolInput, tokensOf } from './format.ts';
import { canResume, canStop, lifecycleLabel, limitNote } from './labels.ts';

describe('format', () => {
  it('formats tokens, cost and percent compactly', () => {
    expect(formatTokens(0)).toBe('0 tok');
    expect(formatTokens(950)).toBe('950 tok');
    expect(formatTokens(12_345)).toBe('12,3k tok');
    expect(formatTokens(2_500_000)).toBe('2,5M tok');
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(0.0406)).toBe('$0.04');
    expect(formatCost(12.5)).toBe('$12.50');
    expect(formatPercent(0.04)).toBe('%4');
    expect(formatPercent(1)).toBe('%100');
    expect(tokensOf(undefined)).toBe(0);
    expect(tokensOf({ inputTokens: 10, outputTokens: 20, cacheReadTokens: 99, cacheCreationTokens: 99, costUsd: 0, turns: 0, sideAnswers: 0 })).toBe(30);
  });

  it('formats reset times relative to now', () => {
    const now = new Date(2026, 9, 6, 14, 0).getTime();
    expect(formatReset(new Date(2026, 9, 6, 15, 40).getTime(), now)).toBe('15:40');
    expect(formatReset(new Date(2026, 9, 8, 9, 5).getTime(), now)).toBe('Per 09:05');
    expect(formatClock(new Date(2026, 9, 6, 8, 7, 3).getTime())).toBe('08:07');
  });

  it('says when like the office does: today and tomorrow by name, the year only when it differs', () => {
    const now = new Date(2026, 9, 7, 14, 10).getTime();
    expect(formatWhenTR(new Date(2026, 9, 7, 14, 55).getTime(), now)).toBe('bugün 14:55');
    expect(formatWhenTR(new Date(2026, 9, 8, 9, 0).getTime(), now)).toBe('yarın 09:00');
    expect(formatWhenTR(new Date(2026, 9, 12, 14, 55).getTime(), now)).toBe('12 Eki 14:55');
    expect(formatWhenTR(new Date(2027, 0, 3, 8, 30).getTime(), now)).toBe('3 Oca 2027 08:30');
    expect(formatWhenTR(new Date(2026, 9, 6, 23, 5).getTime(), now)).toBe('6 Eki 23:05');
    // Tomorrow across a month end.
    expect(formatWhenTR(new Date(2026, 10, 1, 7, 0).getTime(), new Date(2026, 9, 31, 22, 0).getTime())).toBe('yarın 07:00');
  });

  it('summarizes tool input by tool', () => {
    expect(summarizeToolInput('Bash', { command: 'ls -la', description: 'list' })).toBe('ls -la');
    expect(summarizeToolInput('Read', { file_path: '/a/b.ts' })).toBe('/a/b.ts');
    expect(summarizeToolInput('Grep', { pattern: 'TODO' })).toBe('TODO');
    expect(summarizeToolInput('WebFetch', { url: 'https://x.test' })).toBe('https://x.test');
    expect(summarizeToolInput('Other', { a: 'x'.repeat(300) }).length).toBeLessThanOrEqual(120);
    expect(summarizeToolInput('Bash', null)).toBe('');
  });
});

describe('labels', () => {
  it('names every lifecycle in Turkish and knows which buttons apply', () => {
    expect(lifecycleLabel('working')).toBe('Çalışıyor');
    expect(lifecycleLabel('in_terminal')).toBe('Terminalde');
    expect(canStop('working')).toBe(true);
    expect(canStop('stopped')).toBe(false);
    expect(canResume('stopped')).toBe(true);
    expect(canResume('interrupted')).toBe(true);
    expect(canResume('working')).toBe(false);
  });

  it('says when a limited employee opens again', () => {
    const now = new Date(2026, 9, 6, 14, 0).getTime();
    const at = new Date(2026, 9, 6, 15, 40).getTime();
    expect(limitNote({ lifecycle: 'limited', limitResetsAt: at }, now)).toBe('açılış 15:40');
    expect(limitNote({ lifecycle: 'limited', limitResetsAt: null }, now)).toBeNull();
    expect(limitNote({ lifecycle: 'idle', limitResetsAt: at }, now)).toBeNull();
  });
});

