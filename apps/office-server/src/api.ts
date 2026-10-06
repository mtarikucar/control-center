import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import type { HireInput, OfficeSnapshot, ServerMessage } from '@cc/shared';
import type { Engine } from './engine.ts';
import { ForbiddenError, UnsupportedMediaTypeError, ValidationError, statusOf } from './errors.ts';
import type { EventStore } from './event-store.ts';
import type { QuotaTracker } from './quota.ts';
import type { Roster } from './roster.ts';

export interface ApiDeps {
  engine: Engine;
  roster: Roster;
  events: EventStore;
  quota: QuotaTracker;
}

export interface ApiOptions {
  allowedOrigins: string[];
}

export interface Api {
  server: Server;
  close: () => Promise<void>;
}

const MAX_BODY_BYTES = 1_000_000;
const WS_OPEN = 1;
const EMPLOYEE_ROUTE =
  /^\/api\/employees\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/(messages|side-questions|stop|resume|terminal|events))?$/;

export function snapshot(d: ApiDeps): OfficeSnapshot {
  const employees = d.roster.list();
  return { employees, quota: d.quota.state(), usage: d.quota.usageAll(employees.map((e) => e.id)), lastSeq: d.events.lastSeq() };
}

/** Blocks DNS rebinding (Host) and cross-site requests from other pages in the owner's browser (Origin). */
export function checkRequest(req: IncomingMessage, port: number, allowedOrigins: string[]): void {
  const host = req.headers.host ?? '';
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) throw new ForbiddenError('Geçersiz Host başlığı.');
  const origin = req.headers.origin;
  if (origin === undefined) return;
  const allowed = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...allowedOrigins];
  if (!allowed.includes(origin)) throw new ForbiddenError('Bu kaynaktan gelen isteklere izin yok.');
}

function portOf(server: Server): number {
  return (server.address() as AddressInfo).port;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new ValidationError('İstek gövdesi çok büyük.');
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError('Geçersiz JSON.');
  }
}

function textOf(body: unknown): string {
  const text = (body as { text?: unknown } | null)?.text;
  return typeof text === 'string' ? text : '';
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function sendEmpty(res: ServerResponse, status: number): void {
  res.writeHead(status);
  res.end();
}

async function route(d: ApiDeps, opts: ApiOptions, server: Server, req: IncomingMessage, res: ServerResponse): Promise<void> {
  checkRequest(req, portOf(server), opts.allowedOrigins);
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (method === 'POST' && !(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new UnsupportedMediaTypeError('İstek gövdesi application/json olmalı.');
  }
  if (method === 'GET' && url.pathname === '/api/office') return sendJson(res, 200, snapshot(d));
  if (method === 'POST' && url.pathname === '/api/employees') return sendJson(res, 201, d.engine.hire((await readJson(req)) as HireInput));

  const match = EMPLOYEE_ROUTE.exec(url.pathname);
  if (match) {
    const id = match[1] ?? '';
    const action = match[2];
    if (method === 'DELETE' && action === undefined) {
      await d.engine.fire(id);
      return sendEmpty(res, 204);
    }
    if (method === 'POST' && action === 'messages') {
      d.engine.send(id, textOf(await readJson(req)));
      return sendJson(res, 202, { ok: true });
    }
    if (method === 'POST' && action === 'side-questions') return sendJson(res, 200, await d.engine.sideQuestion(id, textOf(await readJson(req))));
    if (method === 'POST' && action === 'stop') return sendJson(res, 200, await d.engine.stop(id));
    if (method === 'POST' && action === 'resume') return sendJson(res, 200, d.engine.resume(id));
    if (method === 'POST' && action === 'terminal') return sendJson(res, 200, await d.engine.openInTerminal(id));
    if (method === 'DELETE' && action === 'terminal') return sendJson(res, 200, d.engine.returnFromTerminal(id));
    if (method === 'GET' && action === 'events') {
      d.roster.get(id);
      const after = Number(url.searchParams.get('after') ?? '0') || 0;
      const limit = Number(url.searchParams.get('limit') ?? '500') || 500;
      return sendJson(res, 200, d.events.list({ employeeId: id, after, limit }));
    }
  }
  sendJson(res, 404, { error: 'Bulunamadı.' });
}

function attach(d: ApiDeps, ws: WebSocket, after: number): void {
  const send = (message: ServerMessage) => {
    if (ws.readyState === WS_OPEN) ws.send(JSON.stringify(message));
  };
  const snap = snapshot(d);
  send({ type: 'snapshot', snapshot: snap });
  let last = after > 0 ? after : snap.lastSeq;
  if (after > 0) {
    for (;;) {
      const page = d.events.list({ after: last, limit: 5000 });
      for (const event of page) {
        send({ type: 'event', event });
        last = event.seq;
      }
      if (page.length < 5000) break;
    }
  }
  const unsubscribe = d.events.subscribe((event) => {
    if (event.seq <= last) return;
    last = event.seq;
    send({ type: 'event', event });
  });
  ws.on('close', unsubscribe);
}

export function createApi(d: ApiDeps, opts: ApiOptions): Api {
  const server = createServer((req, res) => {
    route(d, opts, server, req, res).catch((err: unknown) => {
      sendJson(res, statusOf(err), { error: err instanceof Error ? err.message : String(err) });
    });
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname !== '/ws') throw new ForbiddenError('Bilinmeyen adres.');
      checkRequest(req, portOf(server), opts.allowedOrigins);
    } catch {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => attach(d, ws, Number(url.searchParams.get('after') ?? '0') || 0));
  });
  return {
    server,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
