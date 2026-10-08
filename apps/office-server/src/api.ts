import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { OWNER, type AgendaReport, type ClockStatus, type HireInput, type OfficeMetrics, type OfficeSnapshot, type PlanView, type ServerMessage } from '@cc/shared';
import type { Budget } from './company/budget.ts';
import { coordinatorHint } from './model-policy.ts';
import type { Company } from './company/company.ts';
import { LOG_DEFAULT, LOG_MAX, type ManagementCycle } from './company/cycle.ts';
import type { Memory } from './company/memory.ts';
import type { ProposalStore } from './company/proposal-store.ts';
import { memoryKinds } from './company/search.ts';
import type { PlanStore, TaskStore } from './company/store.ts';
import { parseSince } from './company/time.ts';
import type { Engine } from './engine.ts';
import { ForbiddenError, UnsupportedMediaTypeError, ValidationError, statusOf } from './errors.ts';
import type { EventStore } from './event-store.ts';
import { handleMcp, type McpTool } from './mcp/protocol.ts';
import type { TokenRegistry } from './mcp/tokens.ts';
import type { Blueprints } from './company/blueprint.ts';
import type { IntegrationRegistry } from './company/integrations.ts';
import { OwnerGuard } from './owner-guard.ts';
import { capabilityVocabulary, coverage, unclassifiedTools } from './company/capabilities.ts';
import { listRoleTemplates } from './company/role-templates.ts';
import type { PerformanceReport } from './performance.ts';
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
  /** The company layer: plans, tasks and the coordinator (absent: v1 office); `clock` is the office clock (spec §5), `agenda` the per-employee sheet (§6.1). */
  company?: {
    service: Company; tasks: TaskStore; plans: PlanStore; memory: Memory; budget: Budget; proposals: ProposalStore; clock?: { status(): ClockStatus }; agenda?: { report(): AgendaReport };
    performance?: { report(o: { days?: number }): PerformanceReport };
    /** The top bar's three figures: busy, delivered in the last day, stuck. */
    metrics?: { report(): OfficeMetrics };
    integrations?: IntegrationRegistry;
    /** The coordinator's management cycle: its log for the owner's Yönetim tab (management cycle §3.3). */
    management?: Pick<ManagementCycle, 'log'>;
    blueprints?: Blueprints;
  };
}

export interface ApiOptions {
  allowedOrigins: string[];
  /** Host names allowed besides the server's own (each also allows its https:// origin), e.g. a private Tailscale name. */
  allowedHosts?: string[];
  /** Built office-web; omitted → only the API is served. */
  webDir?: string;
  /** Models + manifest served under /assets3d/. */
  assetsDir?: string;
  /** How long a nonce of the page stays good (default OWNER_NONCE_TTL_MS). */
  ownerNonceTtlMs?: number;
}

export interface Api {
  server: Server;
  close: () => Promise<void>;
}

const MAX_BODY_BYTES = 1_000_000;
const WS_OPEN = 1;
const DECISION_ROUTE = /^\/api\/decisions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/revert$/;
const PROPOSAL_ROUTE = /^\/api\/proposals\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(approve|reject)$/;
const PLAN_ROUTE = /^\/api\/plans\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(approve|decline|stop)$/;
const GOAL_ROUTE = /^\/api\/goals\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/stop$/;
const TASK_ROUTE = /^\/api\/tasks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(park|release|prioritize)$/;
const SCHEDULE_ROUTE = /^\/api\/schedules\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(pause|resume|stop)$/;
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
  const open = d.company.tasks.list({ statuses: ['waiting', 'in_progress', 'review', 'blocked', 'parked'] });
  const closed = d.company.tasks.list({ statuses: ['done', 'cancelled'], limit: 100_000 }).slice(-50);
  // Each plan's streams with the status their tasks give them (management cycle §3.4): derived here, never stored.
  const service = d.company.service;
  const all = d.company.plans.list();
  const streams = service.streamsOf(all);
  const plans = all.map((p): PlanView => ({ ...p, streams: streams.get(p.id) ?? [] }));
  return {
    ...base, tasks: [...open, ...closed], plans, budget: d.company.budget.summary(), proposals: visibleProposals(d.company.proposals),
    goals: d.company.service.goals(), paused: d.company.service.paused(), schedules: d.company.service.schedules(), ...(d.company.clock ? { clock: d.company.clock.status() } : {}),
  };
}

/** Blocks DNS rebinding (Host) and cross-site requests from other pages in the owner's browser (Origin). */
export function checkRequest(req: IncomingMessage, port: number, allowedOrigins: string[], allowedHosts: string[] = []): void {
  const host = (req.headers.host ?? '').toLowerCase();
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}` && !allowedHosts.includes(host)) throw new ForbiddenError('Geçersiz Host başlığı.');
  const origin = req.headers.origin;
  if (origin === undefined) return;
  const allowed = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...allowedOrigins, ...allowedHosts.map((h) => `https://${h}`)];
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

async function route(d: ApiDeps, opts: ApiOptions, guard: OwnerGuard, server: Server, req: IncomingMessage, res: ServerResponse): Promise<void> {
  checkRequest(req, portOf(server), opts.allowedOrigins, opts.allowedHosts);
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/mcp' && d.mcp) {
    // Claude Code sends JSON; a GET (event stream) is answered 405 inside handleMcp.
    const body = method === 'POST' ? await readJson(req) : null;
    const out = await handleMcp({ method, authorization: req.headers.authorization, body, tokens: d.mcp.tokens, roster: d.roster, tools: d.mcp.tools });
    if (out.body === undefined) return sendEmpty(res, out.status);
    return sendJson(res, out.status, out.body);
  }
  // The owner's endpoints: anything under /api/ that changes something (the MCP tools above have their own tokens).
  if (method === 'GET' && url.pathname === '/api/owner/nonce') return sendJson(res, 200, guard.issue(req, url.pathname));
  if (method !== 'GET' && method !== 'HEAD' && url.pathname.startsWith('/api/')) guard.check(req, url.pathname);
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
    if (method === 'POST' && plan) {
      const id = plan[1] ?? '';
      return sendJson(res, 200, plan[2] === 'approve' ? company.approve(id) : plan[2] === 'decline' ? company.decline(id) : company.stopPlan(id));
    }
    // The onboarding (B1): the owner follows it and answers its questions as their own word.
    if (method === 'GET' && url.pathname === '/api/onboarding') return sendJson(res, 200, company.onboarding());
    if (method === 'POST' && url.pathname === '/api/onboarding/answers') {
      const body = (await readJson(req)) as { answers?: unknown } | null;
      return sendJson(res, 200, company.onboardingAnswer(body?.answers));
    }
    const goalStop = GOAL_ROUTE.exec(url.pathname);
    if (method === 'POST' && goalStop) return sendJson(res, 200, company.stopGoal(goalStop[1] ?? ''));
    // The owner's buttons on the agenda sheet (spec §6.3): "Park et…", "Şimdi başlasın" (also priority 1), "Öne al".
    const taskAction = TASK_ROUTE.exec(url.pathname);
    if (method === 'POST' && taskAction) {
      const id = taskAction[1] ?? '';
      const body = (await readJson(req)) as { until?: unknown; reason?: unknown; priority?: unknown } | null;
      if (taskAction[2] === 'park') {
        return sendJson(res, 200, company.parkTask(OWNER, id, typeof body?.until === 'string' ? body.until : '', typeof body?.reason === 'string' && body.reason.trim() ? body.reason : 'Sahibi erteledi'));
      }
      if (taskAction[2] === 'release') return sendJson(res, 200, company.unparkTask(OWNER, id, { priority: 1 }));
      // "Öne al" always means priority 1: a `priority` in the body is accepted and ignored.
      return sendJson(res, 200, company.ownerPrioritize(id));
    }
    // Who does what when (spec §6.1): derived on every read, never published as an event.
    if (method === 'GET' && url.pathname === '/api/agenda') {
      return sendJson(res, 200, d.company.agenda?.report() ?? { generatedAt: Date.now(), horizonMs: 0, clock: { nextDueAt: null, nextDueLabel: null, lastRunAt: null, lastJumpAt: null }, employees: [] });
    }
    // The owner's routine buttons (spec §6.3): Duraklat / Sürdür / Durdur.
    const scheduleAction = SCHEDULE_ROUTE.exec(url.pathname);
    if (method === 'POST' && scheduleAction) return sendJson(res, 200, company.ownerSchedule(scheduleAction[1] ?? '', scheduleAction[2] as 'pause' | 'resume' | 'stop'));
    if (method === 'POST' && url.pathname === '/api/company/pause') {
      company.pause();
      return sendJson(res, 200, { paused: true });
    }
    if (method === 'POST' && url.pathname === '/api/company/resume') {
      company.resume();
      return sendJson(res, 200, { paused: false });
    }
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
    if (method === 'GET' && url.pathname === '/api/memory/search') {
      // The whole memory for the owner (B11): ?q=words&kinds=note,decision&limit=10&since=7d.
      const p = url.searchParams;
      const limit = p.get('limit');
      const since = p.get('since');
      return sendJson(res, 200, memory.search(p.get('q') ?? '', {
        limit: limit === null ? undefined : Number(limit),
        kinds: memoryKinds(p.get('kinds')?.split(',').map((k) => k.trim()).filter(Boolean)),
        since: since ? parseSince(since, Date.now()) : undefined,
      }));
    }
    const budget = d.company.budget;
    if (method === 'GET' && url.pathname === '/api/budget') return sendJson(res, 200, budget.summary());
    if (method === 'GET' && url.pathname === '/api/integrations' && d.company.integrations) return sendJson(res, 200, d.company.integrations.list());
    if (method === 'GET' && url.pathname === '/api/role-templates') return sendJson(res, 200, listRoleTemplates());
    // The blueprint behind a plan card (B5): its steps, how far the install went, its closed mode.
    const blueprintRoute = /^\/api\/plans\/([^/]+)\/blueprint$/.exec(url.pathname);
    if (method === 'GET' && blueprintRoute && d.company.blueprints) return sendJson(res, 200, d.company.blueprints.read(blueprintRoute[1] ?? ''));
    // The capability model (B7): the vocabulary and how the office, or one desk, has each capability.
    if (method === 'GET' && url.pathname === '/api/capabilities' && d.company.integrations) {
      const vocabulary = capabilityVocabulary();
      const who = url.searchParams.get('employee');
      const person = who === null ? null : d.roster.get(who);
      const wanted = person ? (person.capabilities ?? []) : vocabulary.capabilities.map((c) => c.id);
      const registry = d.company.integrations.list();
      return sendJson(res, 200, { ...vocabulary, coverage: coverage(registry, wanted, person?.id), unclassified: unclassifiedTools(registry) });
    }
    if (method === 'GET' && url.pathname === '/api/performance' && d.company.performance) {
      const raw = url.searchParams.get('days');
      const days = raw === null ? undefined : Number(raw);
      if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 365)) throw new ValidationError('days 1 ile 365 arasında bir tam sayı olmalı.');
      return sendJson(res, 200, d.company.performance.report({ days }));
    }
    if (method === 'GET' && url.pathname === '/api/metrics' && d.company.metrics) return sendJson(res, 200, d.company.metrics.report());
    // The management log (management cycle §3.3): the cycle open now and the last `limit` recorded, newest first.
    if (method === 'GET' && url.pathname === '/api/management' && d.company.management) {
      const raw = url.searchParams.get('limit');
      const limit = raw === null ? LOG_DEFAULT : Number(raw);
      if (!Number.isInteger(limit) || limit < 1 || limit > LOG_MAX) throw new ValidationError(`limit 1 ile ${LOG_MAX} arasında bir tam sayı olmalı.`);
      return sendJson(res, 200, d.company.management.log(limit));
    }
    if (method === 'GET' && url.pathname === '/api/budget/spend') return sendJson(res, 200, budget.spending(url.searchParams.get('planId') ?? undefined));
    if (method === 'POST' && url.pathname === '/api/constitution') {
      const body = await readJson(req);
      if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ValidationError('Geçersiz istek gövdesi.');
      return sendJson(res, 200, budget.ownerSetConstitution(body as Record<string, unknown>));
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
      // The owner talking to the coordinator (management cycle §3.5): with no plan running (none waits for the owner or
      // is under way) a project start, else an ordinary turn — the constitution's role model for it, which the engine
      // applies whatever the model policy says. To anyone else in the middle of a task: no hint, the session stays on
      // the model the task started it on (never mid-task); between tasks, their own model (the engine ignores these
      // while the model policy is off).
      const employee = d.roster.get(id);
      const company = d.company;
      const hint =
        employee.kind === 'coordinator' && company
          ? coordinatorHint(company.service.hasRunningPlan() ? 'routine' : 'kickoff', company.budget.constitution())
          : company?.tasks.inProgressOf(id)
            ? {}
            : { model: employee.model };
      d.engine.send(id, text, 'owner', hint);
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
  const guard = new OwnerGuard({ events: d.events, ttlMs: opts.ownerNonceTtlMs });
  const server = createServer((req, res) => {
    route(d, opts, guard, server, req, res).catch((err: unknown) => {
      const code = err instanceof ForbiddenError ? err.code : undefined;
      sendJson(res, statusOf(err), { error: err instanceof Error ? err.message : String(err), ...(code ? { code } : {}) });
    });
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname !== '/ws') throw new ForbiddenError('Bilinmeyen adres.');
      checkRequest(req, portOf(server), opts.allowedOrigins, opts.allowedHosts);
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
