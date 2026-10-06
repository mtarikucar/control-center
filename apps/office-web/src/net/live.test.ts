import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectLive, type WebSocketLike } from './live.ts';

class FakeSocket implements WebSocketLike {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  close() {
    this.closed = true;
    this.onclose?.();
  }
}

beforeEach(() => {
  FakeSocket.all = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('connectLive', () => {
  it('passes the last seen seq, forwards messages and ignores garbage', () => {
    const messages: unknown[] = [];
    const statuses: boolean[] = [];
    let after = 7;
    connectLive({ onMessage: (m) => messages.push(m), onStatus: (s) => statuses.push(s), getAfter: () => after, url: (a) => `ws://x/ws?after=${a}`, WebSocketImpl: FakeSocket });
    const ws = FakeSocket.all[0]!;
    expect(ws.url).toBe('ws://x/ws?after=7');
    ws.onopen?.();
    ws.onmessage?.({ data: JSON.stringify({ type: 'snapshot', snapshot: {} }) });
    ws.onmessage?.({ data: '{bozuk' });
    expect(messages).toEqual([{ type: 'snapshot', snapshot: {} }]);
    expect(statuses).toEqual([true]);
    after = 42;
    ws.onclose?.();
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.all[1]?.url).toBe('ws://x/ws?after=42');
  });

  it('backs off between reconnects and stops for good when closed', () => {
    const stop = connectLive({ onMessage: () => {}, onStatus: () => {}, getAfter: () => 0, url: () => 'ws://x', WebSocketImpl: FakeSocket, minDelayMs: 100, maxDelayMs: 300 });
    FakeSocket.all[0]!.onclose?.();
    vi.advanceTimersByTime(99);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.all[1]!.onclose?.();
    vi.advanceTimersByTime(200);
    expect(FakeSocket.all).toHaveLength(3);
    FakeSocket.all[2]!.onclose?.();
    vi.advanceTimersByTime(300);
    expect(FakeSocket.all).toHaveLength(4);
    stop();
    expect(FakeSocket.all[3]!.closed).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(FakeSocket.all).toHaveLength(4);
  });
});
