import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { OWNER, type HireInput, type OfficeSnapshot, type ServerMessage } from '@cc/shared';
import type { Budget } from './company/budget.ts';
import { MODEL_RANK } from './model-policy.ts';
import type { Company } from './company/company.ts';
import type { Memory } from './company/memory.ts';
import type { ProposalStore } from './company/proposal-store.ts';
import type { PlanStore, TaskStore } from './company/store.ts';
import type { Engine } from './engine.ts';
import { ForbiddenError, UnsupportedMediaTypeError, ValidationError, statusOf } from './errors.ts';
import type { EventStore } from './event-store.ts';
import { handleMcp, type McpTool } from './mcp/protocol.ts';
import type { TokenRegistry } from './mcp/tokens.ts';
import type { QuotaTracker } from './quota.ts';
import type { Roster } from './roster.ts';
import { resolveInside, sendFile } from './static.ts';

export interface ApiDeps {
  engine: Engine;
  roster: Roster;
  events: EventStore;
  quota: QuotaTracker;
  /** The office tools employees call over MCP (absent: no /mcp route). */
  mcp?: { tokens: TokenRegistry; tools: McpTool[] };
  /** The company layer: plans, tasks and the coordinator (absent: v1 office). */
  company?: { service: Company; tasks: TaskStore; plans: PlanStore; memory: Memory; budget: Budget; proposals: ProposalStore };
}

export interface ApiOptions {
  allowedOrigins: string[];
  /** Built office-web; omitted → only the API is served. */
  webDir?: string;
  /** Models + manifest served under /assets3d/. */
  assetsDir?: string;
}

export interface Api {
  server: Server;
  close: () => Promise<void>;
}

const MAX_BODY_BYTES = 1_000_000;
const WS_OPEN = 1;
const DECISION_ROUTE = /^\/api\/decisions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/revert$/;
const PROPOSAL_ROUTE = /^\/api\/proposals\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(approve|reject)$/;
const PLAN_ROUTE = /^\/api\/plans\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(approve|decline)$/;
const EMPLOYEE_ROUTE =
  /^\/api\/employees\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/(messages|side-questions|stop|resume|terminal|events|file))?$/;

/** What the owner sees of the proposals: everything still open or waiting for them, and the last 30 decided. */
function visibleProposals(store: ProposalStore) {
  return [...store.list({ statuses: ['open', 'owner'] }), ...store.list({ statuses: ['accepted', 'declined'], limit: 30 })];
}

export function snapshot(d: ApiDeps): OfficeSnapshot {
  const employees = d.roster.list();
  const base: OfficeSnapshot = { employees, quota: d.quota.state(), usage: d.quota.usageAll(employees.map((e) => e.id)), lastSeq: d.events.lastSeq() };
  if (!d.company) return base;
  const open = d.company.tasks.list({ statuses: ['waiting', 'in_progress', 'blocked'] });
  const closed = d.company.tasks.list({ statuses: ['done', 'cancelled'], limit: 100_000 }).slice(-50);
  return { ...base, tasks: [...open, ...closed], plans: d.company.plans.list(), budget: d.company.budget.summary(), proposals: visibleProposals(d.company.proposals) };
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
  if (url.pathname === '/mcp' && d.mcp) {
    // Claude Code sends JSON; a GET (event stream) is answered 405 inside handleMcp.
    const body = method === 'POST' ? await readJson(req) : null;
    const out = await handleMcp({ method, authorization: req.headers.authorization, body, tokens: d.mcp.tokens, roster: d.roster, tools: d.mcp.tools });
    if (out.body === undefined) return sendEmpty(res, out.status);
    return sendJson(res, out.status, out.body);
  }
  if (method === 'POST' && !(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new UnsupportedMediaTypeError('İstek gövdesi application/json olmalı.');
  }
  if (method === 'GET' && url.pathname === '/api/office') return sendJson(res, 200, snapshot(d));
  if (method === 'POST' && url.pathname === '/api/employees') {
    const body = await readJson(req);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ValidationError('Geçersiz istek gövdesi.');
    const input = body as HireInput;
    return sendJson(res, 201, d.company ? d.company.service.hire(OWNER, input) : d.engine.hire(input));
  }
  if (d.company) {
    const company = d.company.service;
    const plan = PLAN_ROUTE.exec(url.pathname);
    if (method === 'POST' && plan) return sendJson(res, 200, plan[2] === 'approve' ? company.approve(plan[1] ?? '') : company.decline(plan[1] ?? ''));
    if (method === 'POST' && url.pathname === '/api/company/coordinator/hire') return sendJson(res, 201, company.hireCoordinator());
    if (method === 'POST' && url.pathname === '/api/company/coordinator') {
      const id = (await readJson(req) as { employeeId?: unknown }).employeeId;
      if (typeof id !== 'string' || !id) throw new ValidationError('employeeId gerekli.');
      return sendJson(res, 200, company.appointCoordinator(id));
    }
    const memory = d.company.memory;
    if (method === 'GET' && url.pathname === '/api/memory/decisions') return sendJson(res, 200, memory.decisions({ query: url.searchParams.get('q') ?? undefined, limit: 200 }));
    const revert = DECISION_ROUTE.exec(url.pathname);
    if (method === 'POST' && revert) return sendJson(res, 201, memory.revertDecision(revert[1] ?? ''));
    if (method === 'GET' && url.pathname === '/api/memory/playbook') return sendJson(res, 200, memory.playbookTopics());
    if (method === 'GET' && url.pathname === '/api/memory/playbook/history') return sendJson(res, 200, memory.playbookHistory(url.searchParams.get('topic') ?? ''));
    if (method === 'GET' && url.pathname === '/api/memory/notes') return sendJson(res, 200, memory.notes(url.searchParams.get('q') ?? undefined, 100));
    const budget = d.company.budget;
    if (method === 'GET' && url.pathname === '/api/budget') return sendJson(res, 200, budget.summary());
    if (method === 'GET' && url.pathname === '/api/budget/spend') return sendJson(res, 200, budget.spending(url.searchParams.get('planId') ?? undefined));
    if (method === 'POST' && url.pathname === '/api/constitution') {
      const body = await readJson(req);
      if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ValidationError('Geçersiz istek gövdesi.');
      return sendJson(res, 200, budget.setConstitution(body as Record<string, unknown>));
    }
    if (method === 'GET' && url.pathname === '/api/proposals') return sendJson(res, 200, visibleProposals(d.company.proposals));
    const decide = PROPOSAL_ROUTE.exec(url.pathname);
    if (method === 'POST' && decide) {
      const note = (await readJson(req)) as { note?: unknown } | null;
      return sendJson(res, 200, company.ownerDecideProposal(decide[1] ?? '', decide[2] === 'approve', typeof note?.note === 'string' ? note.note : undefined));
    }
  }

  const match = EMPLOYEE_ROUTE.exec(url.pathname);
  if (match) {
    const id = match[1] ?? '';
    const action = match[2];
    if (method === 'DELETE' && action === undefined) {
      // The company asks for a hand-over first (spec §3.4); "?now=1" — or an office without the company — fires at once.
      if (d.company && url.searchParams.get('now') !== '1') return sendJson(res, 202, { handover: d.company.service.beginHandover(id) });
      await d.engine.fire(id);
      d.company?.service.releaseTasksOf(id);
      return sendEmpty(res, 204);
    }
    if (method === 'GET' && action === 'file' && d.company) return sendJson(res, 200, d.company.memory.employeeFile(id));
    if (method === 'POST' && action === 'messages') {
      const text = textOf(await readJson(req));
      // The owner talking to the coordinator: the constitution's owner model, but never below the coordinator's own (a
      // coordinator who moved itself up for planning stays there); to anyone else, their own model (a task may have
      // moved their session to another). The engine ignores hints while the model policy is off.
      const employee = d.roster.get(id);
      const owner = d.company?.budget.constitution().coordinatorModels.owner;
      const model = owner && employee.kind === 'coordinator' && MODEL_RANK[owner] > MODEL_RANK[employee.model] ? owner : employee.model;
      d.engine.send(id, text, 'owner', { model });
      return sendJson(res, 202, { ok: true });
    }
    if (method === 'POST' && action === 'side-questions') return sendJson(res, 200, await d.engine.sideQuestion(id, textOf(await readJson(req))));
    if (method === 'POST' && action === 'stop') return sendJson(res, 200, await d.engine.stop(id));
    if (method === 'POST' && action === 'resume') return sendJson(res, 200, d.engine.resume(id));
    if (method === 'POST' && action === 'terminal') return sendJson(res, 200, await d.engine.openInTerminal(id));
    if (method === 'DELETE' && action === 'terminal') return sendJson(res, 200, d.engine.returnFromTerminal(id));
    if (method === 'GET' && action === 'events') {
      d.roster.get(id);
      const tail = Number(url.searchParams.get('tail') ?? '0') || 0;
      if (tail > 0) return sendJson(res, 200, d.events.list({ employeeId: id, tail: true, limit: tail }));
      const after = Number(url.searchParams.get('after') ?? '0') || 0;
      const limit = Number(url.searchParams.get('limit') ?? '500') || 500;
      return sendJson(res, 200, d.events.list({ employeeId: id, after, limit }));
    }
  }
  if ((method === 'GET' || method === 'HEAD') && !url.pathname.startsWith('/api/')) return serveStatic(opts, url.pathname, req, res);
  sendJson(res, 404, { error: 'Bulunamadı.' });
}

function serveStatic(opts: ApiOptions, pathname: string, req: IncomingMessage, res: ServerResponse): void {
  if (pathname.startsWith('/assets3d/')) {
    const file = opts.assetsDir ? resolveInside(opts.assetsDir, pathname.slice('/assets3d'.length)) : null;
    if (file && sendFile(req, res, file)) return;
    return sendJson(res, 404, { error: 'Model bulunamadı.' });
  }
  if (opts.webDir) {
    const file = resolveInside(opts.webDir, pathname === '/' ? '/index.html' : pathname);
    if (file && sendFile(req, res, file)) return;
    const index = resolveInside(opts.webDir, '/index.html');
    if (index && sendFile(req, res, index)) return;
  }
  sendJson(res, 404, { error: 'Arayüz derlenmemiş: önce `pnpm --filter @cc/office-web build` çalıştır.' });
}

function attach(d: ApiDeps, ws: WebSocket, after: number): void {
  const send = (message: ServerMessage) => {
    if (ws.readyState === WS_OPEN) ws.send(JSON.stringify(message));
  };
  const snap = snapshot(d);
  send({ type: 'snapshot', snapshot: snap });
  // An `after` beyond the log (e.g. the database was reset) must not silence the feed: start from now.
  let last = after > 0 ? Math.min(after, snap.lastSeq) : snap.lastSeq;
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
  // A malformed frame must only drop this client, never the office process (and every employee with it).
  ws.on('error', () => ws.terminate());
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
