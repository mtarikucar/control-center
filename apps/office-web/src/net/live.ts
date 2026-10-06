import type { ServerMessage } from '@cc/shared';

export interface WebSocketLike {
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  close(): void;
}

export interface LiveOptions {
  onMessage: (m: ServerMessage) => void;
  onStatus: (connected: boolean) => void;
  /** The last seq the client has applied; the server replays everything after it. */
  getAfter: () => number;
  url?: (after: number) => string;
  WebSocketImpl?: new (url: string) => WebSocketLike;
  minDelayMs?: number;
  maxDelayMs?: number;
}

function defaultUrl(after: number): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws?after=${after}`;
}

/** Opens the live feed and keeps it open with exponential backoff. Returns a function that stops it. */
export function connectLive(o: LiveOptions): () => void {
  const Impl = o.WebSocketImpl ?? (WebSocket as unknown as new (url: string) => WebSocketLike);
  const minDelay = o.minDelayMs ?? 1000;
  const maxDelay = o.maxDelayMs ?? 10_000;
  const url = o.url ?? defaultUrl;
  let delay = minDelay;
  let stopped = false;
  let socket: WebSocketLike | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    timer = null;
    const ws = new Impl(url(o.getAfter()));
    socket = ws;
    ws.onopen = () => {
      delay = minDelay;
      o.onStatus(true);
    };
    ws.onmessage = (ev) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      o.onMessage(message);
    };
    ws.onclose = () => {
      o.onStatus(false);
      if (stopped) return;
      timer = setTimeout(open, delay);
      delay = Math.min(delay * 2, maxDelay);
    };
  };

  open();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    socket?.close();
  };
}
