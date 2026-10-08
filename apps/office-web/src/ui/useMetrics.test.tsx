import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfficeMetrics } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { useMetrics } from './useMetrics.ts';

vi.mock('../net/api.ts', () => ({ api: { metrics: vi.fn() } }));
const { api } = await import('../net/api.ts');
const metrics = vi.mocked(api.metrics);

const reading = (busy: number): OfficeMetrics => ({
  generatedAt: busy,
  busy: { busy, total: 5, idle: [], unavailable: [] },
  delivered: { count: 0, firstPassRate: null, windowHours: 24 },
  stuck: { count: 0, items: [] },
});
/** Lets the fake timers run `ms` and every promise they settle. */
const pass = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => {
  vi.useFakeTimers();
  useOffice.setState({ agendaRev: 0 });
  metrics.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useMetrics', () => {
  it('reads on mount, a second after the office changes (a burst is one read), and every minute', async () => {
    let n = 0;
    metrics.mockImplementation(async () => reading(++n));
    const { result } = renderHook(() => useMetrics());
    expect(result.current).toBeNull();
    await pass(0);
    expect(metrics).toHaveBeenCalledTimes(1);
    expect(result.current?.busy.busy).toBe(1);

    act(() => useOffice.setState({ agendaRev: 1 }));
    act(() => useOffice.setState({ agendaRev: 2 }));
    await pass(999);
    expect(metrics).toHaveBeenCalledTimes(1);
    await pass(1);
    expect(metrics).toHaveBeenCalledTimes(2);
    expect(result.current?.busy.busy).toBe(2);

    // Idle hours and due times move with the clock alone: read again every minute.
    await pass(60_000 - 1000);
    expect(metrics).toHaveBeenCalledTimes(3);
    expect(result.current?.busy.busy).toBe(3);
  });

  it('keeps only the newest read: an older answer arriving late is dropped', async () => {
    const answers: Array<(m: OfficeMetrics) => void> = [];
    metrics.mockImplementation(() => new Promise<OfficeMetrics>((resolve) => answers.push(resolve)));
    const { result } = renderHook(() => useMetrics());
    await pass(0);
    act(() => useOffice.setState({ agendaRev: 1 }));
    await pass(1000);
    expect(answers).toHaveLength(2);
    await act(async () => answers[1]!(reading(2)));
    expect(result.current?.busy.busy).toBe(2);
    await act(async () => answers[0]!(reading(1)));
    expect(result.current?.busy.busy).toBe(2);
  });

  it('never throws: a failed read keeps the last figures, and an office without metrics shows none', async () => {
    metrics.mockRejectedValueOnce(new Error('İstek başarısız (HTTP 404).'));
    const { result } = renderHook(() => useMetrics());
    await pass(0);
    expect(result.current).toBeNull();
    metrics.mockResolvedValueOnce(reading(4));
    await pass(60_000);
    expect(result.current?.busy.busy).toBe(4);
    metrics.mockRejectedValueOnce(new Error('bağlantı yok'));
    await pass(60_000);
    expect(result.current?.busy.busy).toBe(4);
  });

  it('stops reading once unmounted', async () => {
    metrics.mockImplementation(async () => reading(1));
    const { unmount } = renderHook(() => useMetrics());
    await pass(0);
    unmount();
    await pass(120_000);
    expect(metrics).toHaveBeenCalledTimes(1);
  });
});
