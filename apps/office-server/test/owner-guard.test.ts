import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApi, type ApiOptions } from '../src/api.ts';
import type { McpTool } from '../src/mcp/protocol.ts';
import { TokenRegistry } from '../src/mcp/tokens.ts';
import { QuotaTracker } from '../src/quota.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const tools: McpTool[] = [
  { name: 'echo', description: 'Echo back.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, kinds: ['member', 'lead', 'coordinator'], run: ({ employee }, args) => `${employee.name}: ${String(args.text)}` },
];

async function start(opts: Partial<ApiOptions> = {}) {
  const s = setup();
  const f = fakeEngine(s);
  const c = companyFor(s, f, ['coder']);
  const tokens = new TokenRegistry();
  const quota = new QuotaTracker(s.db, s.events);
  const api = createApi(
    { engine: f.engine, roster: s.roster, events: s.events, quota, mcp: { tokens, tools }, company: { service: c.company, tasks: c.tasks, plans: c.plans, memory: c.memory, budget: c.budget, proposals: c.proposals } },
    { allowedOrigins: ['http://127.0.0.1:5180'], ...opts },
  );
  await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', resolve));
  const port = (api.server.address() as AddressInfo).port;
  cleanups.push(() => api.close(), f.cleanup, s.cleanup);
  return { s, c, port, tokens };
}

interface Reply {
  status: number;
  body: any;
}

/** Like curl: only the headers given (Host comes with the connection). */
function call(port: number, method: string, path: string, headers: Record<string, string> = {}, body?: unknown): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body ?? {});
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { ...(payload !== undefined ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

/** What the office page's own fetch sends: the browser adds Origin (not on GET) and Sec-Fetch-Site. */
const page = (port: number) => ({ origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' });
async function nonceFor(port: number): Promise<string> {
  const r = await call(port, 'GET', '/api/owner/nonce', { 'sec-fetch-site': 'same-origin' });
  expect(r.status).toBe(200);
  return r.body.nonce as string;
}

const ID = '00000000-0000-4000-8000-000000000000';
/** Every route of api.ts that changes something for the owner (the classification in the task's document). */
const OWNER_ROUTES: Array<[string, string]> = [
  ['POST', '/api/employees'],
  ['POST', `/api/plans/${ID}/approve`],
  ['POST', `/api/plans/${ID}/decline`],
  ['POST', `/api/plans/${ID}/stop`],
  ['POST', '/api/onboarding/answers'],
  ['POST', `/api/goals/${ID}/stop`],
  ['POST', `/api/tasks/${ID}/park`],
  ['POST', `/api/tasks/${ID}/release`],
  ['POST', `/api/tasks/${ID}/prioritize`],
  ['POST', `/api/schedules/${ID}/pause`],
  ['POST', `/api/schedules/${ID}/resume`],
  ['POST', `/api/schedules/${ID}/stop`],
  ['POST', '/api/company/pause'],
  ['POST', '/api/company/resume'],
  ['POST', '/api/company/coordinator/hire'],
  ['POST', '/api/company/coordinator'],
  ['POST', `/api/decisions/${ID}/revert`],
  ['POST', '/api/constitution'],
  ['POST', `/api/proposals/${ID}/approve`],
  ['POST', `/api/proposals/${ID}/reject`],
  // B9a: the owner's approval of a held call (design §4 madde 2; review round 1, critical: no self-approval).
  ['POST', `/api/approvals/${ID}/approve`],
  ['POST', `/api/approvals/${ID}/deny`],
  ['DELETE', `/api/employees/${ID}`],
  ['POST', `/api/employees/${ID}/messages`],
  ['POST', `/api/employees/${ID}/side-questions`],
  ['POST', `/api/employees/${ID}/stop`],
  ['POST', `/api/employees/${ID}/resume`],
  ['POST', `/api/employees/${ID}/terminal`],
  ['DELETE', `/api/employees/${ID}/terminal`],
];

const flags = (t: Awaited<ReturnType<typeof start>>) => t.s.events.list({ limit: 5000 }).filter((x) => x.event.type === 'owner.request.flagged').map((x) => x.event);

describe('owner endpoints: Origin and the page’s nonce', () => {
  it('every owner endpoint that changes something refuses a request with no Origin (curl), before it does anything', async () => {
    const t = await start();
    for (const [method, path] of OWNER_ROUTES) {
      const r = await call(t.port, method, path, { 'user-agent': 'curl/8.5.0' }, { name: 'Sızma', role: 'r', paused: true });
      expect({ method, path, status: r.status, code: r.body?.code }).toEqual({ method, path, status: 403, code: 'owner_origin' });
    }
    expect(t.s.roster.list()).toHaveLength(0);
    expect(t.c.company.paused()).toBe(false);
  });

  it('with an allowed Origin but no valid nonce it still refuses: none, a made-up one, an expired one', async () => {
    const t = await start({ ownerNonceTtlMs: 150 });
    const none = await call(t.port, 'POST', '/api/company/pause', page(t.port));
    expect([none.status, none.body.code]).toEqual([403, 'owner_nonce']);
    const madeUp = await call(t.port, 'POST', '/api/company/pause', { ...page(t.port), 'x-owner-nonce': 'uydurma' });
    expect([madeUp.status, madeUp.body.code]).toEqual([403, 'owner_nonce']);
    const nonce = await nonceFor(t.port);
    await new Promise((r) => setTimeout(r, 250));
    const expired = await call(t.port, 'POST', '/api/company/pause', { ...page(t.port), 'x-owner-nonce': nonce });
    expect([expired.status, expired.body.code]).toEqual([403, 'owner_nonce']);
    expect(t.c.company.paused()).toBe(false);
  });

  it('the page’s way works: a nonce from its same-origin fetch, then Origin and nonce (also from the dev server’s origin)', async () => {
    const t = await start();
    const r = await call(t.port, 'GET', '/api/owner/nonce', { 'sec-fetch-site': 'same-origin' });
    expect(r.body).toEqual({ nonce: expect.stringMatching(/^[A-Za-z0-9_-]{40,}$/), expiresAt: expect.any(Number) });
    const hired = await call(t.port, 'POST', '/api/employees', { ...page(t.port), 'x-owner-nonce': r.body.nonce }, { name: 'Ada', role: 'r' });
    expect(hired.status).toBe(201);
    // Through Vite's proxy the browser's Origin is the dev server's, which OFFICE_ALLOWED_ORIGINS lists.
    const paused = await call(t.port, 'POST', '/api/company/pause', { origin: 'http://127.0.0.1:5180', 'sec-fetch-site': 'same-origin', 'x-owner-nonce': await nonceFor(t.port) });
    expect(paused.status).toBe(200);
    expect(t.c.company.paused()).toBe(true);
    expect(flags(t)).toEqual([]);
  });

  it('the nonce goes only to a same-origin fetch of the page', async () => {
    const t = await start();
    for (const headers of [{}, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'none' }] as Array<Record<string, string>>) {
      const r = await call(t.port, 'GET', '/api/owner/nonce', headers);
      expect([r.status, r.body.code]).toEqual([403, 'owner_fetch']);
    }
  });

  it('the employees’ MCP tools are not touched: a bearer token with no Origin still calls a tool', async () => {
    const t = await start();
    const ada = t.s.roster.create({ name: 'Ada', role: 'r' });
    const r = await call(t.port, 'POST', '/mcp', { authorization: `Bearer ${t.tokens.issue(ada.id)}`, accept: 'application/json, text/event-stream' }, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo', arguments: { text: 'selam' } } });
    expect(r.status).toBe(200);
    expect(r.body.result.content[0].text).toBe('Ada: selam');
    expect(flags(t)).toEqual([]);
  });

  it('reads stay as they were: a GET with no Origin is answered and not flagged', async () => {
    const t = await start();
    expect((await call(t.port, 'GET', '/api/office')).status).toBe(200);
    expect((await call(t.port, 'GET', '/api/budget')).status).toBe(200);
    expect(flags(t)).toEqual([]);
  });
});

describe('owner endpoints: tries without Origin or nonce are marked in the event log', () => {
  it('refused tries are marked origin-less or nonce-less, with method, path and user agent', async () => {
    const t = await start();
    await call(t.port, 'POST', '/api/company/pause', { 'user-agent': 'curl/8.5.0' });
    await call(t.port, 'DELETE', `/api/employees/${ID}`, { 'user-agent': 'curl/8.5.0', origin: `http://127.0.0.1:${t.port}` });
    await call(t.port, 'GET', '/api/owner/nonce', { 'user-agent': 'curl/8.5.0' });
    expect(flags(t)).toEqual([
      { type: 'owner.request.flagged', mark: 'owner-endpoint, origin-less', outcome: 'rejected', method: 'POST', path: '/api/company/pause', userAgent: 'curl/8.5.0' },
      { type: 'owner.request.flagged', mark: 'owner-endpoint, nonce-less', outcome: 'rejected', method: 'DELETE', path: `/api/employees/${ID}`, userAgent: 'curl/8.5.0' },
      { type: 'owner.request.flagged', mark: 'owner-endpoint, no fetch metadata', outcome: 'rejected', method: 'GET', path: '/api/owner/nonce', userAgent: 'curl/8.5.0' },
    ]);
  });

  it('an accepted change that did not come from a browser fetch is marked too', async () => {
    const t = await start();
    const nonce = await nonceFor(t.port);
    const r = await call(t.port, 'POST', '/api/company/pause', { origin: `http://127.0.0.1:${t.port}`, 'x-owner-nonce': nonce, 'user-agent': 'curl/8.5.0' });
    expect(r.status).toBe(200);
    expect(flags(t)).toEqual([{ type: 'owner.request.flagged', mark: 'owner-endpoint, no fetch metadata', outcome: 'accepted', method: 'POST', path: '/api/company/pause', userAgent: 'curl/8.5.0' }]);
  });
});
