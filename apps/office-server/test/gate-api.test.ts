import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER } from '@cc/shared';
import { createApi } from '../src/api.ts';
import { ApprovalStore } from '../src/company/approval-store.ts';
import { Approvals } from '../src/company/approvals.ts';
import { Gate } from '../src/company/gate.ts';
import { TokenRegistry } from '../src/mcp/tokens.ts';
import { QuotaTracker } from '../src/quota.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { DATA, testContext } from './gate-helpers.ts';
import { setup } from './helpers.ts';
import { pageHeaders } from './owner-helpers.ts';

/** B9a K1-4, K1-7: the hook's endpoint, the approvals' endpoints, and who may decide (the owner guard). */

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function start() {
  const s = setup();
  const f = fakeEngine(s);
  const c = companyFor(s, f, ['coder']);
  const tokens = new TokenRegistry();
  const quota = new QuotaTracker(s.db, s.events);
  const approvals = new Approvals({ store: new ApprovalStore(s.db), events: s.events, notices: c.notices, roster: s.roster, tasks: c.tasks, coordinator: () => c.company.coordinator(), memory: c.memory, defer: (fn) => fn() });
  let enabled = true;
  const gate = new Gate({ approvals, events: s.events, roster: s.roster, enabled: () => enabled, context: (e) => testContext({ deskDir: `${DATA}/desks/${e.slug}` }) });
  const api = createApi(
    {
      engine: f.engine, roster: s.roster, events: s.events, quota, mcp: { tokens, tools: [] }, gate,
      company: { service: c.company, tasks: c.tasks, plans: c.plans, memory: c.memory, budget: c.budget, proposals: c.proposals, approvals },
    },
    { allowedOrigins: [] },
  );
  await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', resolve));
  const port = (api.server.address() as AddressInfo).port;
  cleanups.push(() => api.close(), f.cleanup, s.cleanup);
  const ada = c.company.hire(OWNER, { name: 'Ada', role: 'r' });
  return { s, c, port, tokens, approvals, gate, ada, setEnabled: (v: boolean) => void (enabled = v) };
}

interface Reply {
  status: number;
  body: any;
}

function call(port: number, method: string, path: string, headers: Record<string, string> = {}, body?: unknown): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body ?? {});
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

const ping = { session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'mcp__probe__ping', tool_input: {}, cwd: `${DATA}/desks/ada` };
const events = (t: Awaited<ReturnType<typeof start>>, type: string) => t.s.events.list({ limit: 5000 }).filter((e) => e.event.type === type);

describe('POST /gate/check — the hook asks (K1-4)', () => {
  it('needs the session’s token: none or a wrong one → 401; a body it cannot read → 400', async () => {
    const t = await start();
    expect((await call(t.port, 'POST', '/gate/check', {}, ping)).status).toBe(401);
    expect((await call(t.port, 'POST', '/gate/check', { authorization: 'Bearer yanlis' }, ping)).status).toBe(401);
    const auth = { authorization: `Bearer ${t.tokens.issue(t.ada.id)}` };
    expect((await call(t.port, 'POST', '/gate/check', auth, '{bozuk')).status).toBe(400);
    expect((await call(t.port, 'POST', '/gate/check', auth, [1, 2])).status).toBe(400);
    expect(events(t, 'gate.checked')).toEqual([]);
  });

  it('allow or deny in the body; gate.checked only for held calls; it is not an owner endpoint (no Origin, no nonce, nothing flagged)', async () => {
    const t = await start();
    const auth = { authorization: `Bearer ${t.tokens.issue(t.ada.id)}`, 'user-agent': 'node' };
    const read = await call(t.port, 'POST', '/gate/check', auth, { ...ping, tool_name: 'Read', tool_input: { file_path: '/etc/hosts' } });
    expect(read).toMatchObject({ status: 200, body: { decision: 'allow' } });
    expect(events(t, 'gate.checked')).toEqual([]);
    const held = await call(t.port, 'POST', '/gate/check', auth, ping);
    expect(held).toMatchObject({ status: 200, body: { decision: 'deny', kind: 'other', target: 'ping', reason: expect.stringContaining('approvalRequest') } });
    expect(events(t, 'gate.checked')).toHaveLength(1);
    expect(events(t, 'owner.request.flagged')).toEqual([]);
  });

  it('a request from a foreign page is still refused (checkRequest unchanged)', async () => {
    const t = await start();
    const r = await call(t.port, 'POST', '/gate/check', { origin: 'https://evil.example', authorization: `Bearer ${t.tokens.issue(t.ada.id)}` }, ping);
    expect(r.status).toBe(403);
  });

  it('switched off: the answer is allow and nothing is written', async () => {
    const t = await start();
    t.setEnabled(false);
    const r = await call(t.port, 'POST', '/gate/check', { authorization: `Bearer ${t.tokens.issue(t.ada.id)}` }, ping);
    expect(r.body.decision).toBe('allow');
    expect(events(t, 'gate.checked')).toEqual([]);
  });
});

describe('the approvals’ endpoints and the owner guard (K1-7, design §4 madde 2)', () => {
  it('GET /api/approvals reads without Origin (like every read)', async () => {
    const t = await start();
    t.approvals.request(t.ada.id, { kind: 'other', tool: 'mcp__probe__ping', target: 'ping', summary: 'deneme' });
    const r = await call(t.port, 'GET', '/api/approvals');
    expect(r.status).toBe(200);
    expect(r.body).toEqual([expect.objectContaining({ status: 'pending', target: 'ping' })]);
    expect((await call(t.port, 'GET', '/api/office')).body.approvals).toEqual([expect.objectContaining({ target: 'ping' })]);
  });

  it('an employee cannot approve their own request with curl: no Origin → 403 owner_origin, no nonce → 403 owner_nonce, the request still waits', async () => {
    const t = await start();
    const a = t.approvals.request(t.ada.id, { kind: 'other', tool: 'mcp__probe__ping', target: 'ping', summary: 'deneme' });
    const bare = await call(t.port, 'POST', `/api/approvals/${a.id}/approve`, { 'user-agent': 'curl/8.5.0' });
    expect([bare.status, bare.body.code]).toEqual([403, 'owner_origin']);
    const noNonce = await call(t.port, 'POST', `/api/approvals/${a.id}/approve`, { origin: `http://127.0.0.1:${t.port}` });
    expect([noNonce.status, noNonce.body.code]).toEqual([403, 'owner_nonce']);
    expect(t.approvals.get(a.id).status).toBe('pending');
    expect(events(t, 'owner.request.flagged').map((e) => (e.event as { path: string }).path)).toEqual([`/api/approvals/${a.id}/approve`, `/api/approvals/${a.id}/approve`]);
  });

  it('the page’s way: approve → 200, decided via the page; deny with a note → 200', async () => {
    const t = await start();
    const a = t.approvals.request(t.ada.id, { kind: 'other', tool: 'mcp__probe__ping', target: 'ping', summary: 'deneme' });
    const ok = await call(t.port, 'POST', `/api/approvals/${a.id}/approve`, await pageHeaders(t.port));
    expect(ok).toMatchObject({ status: 200, body: { id: a.id, status: 'approved', decidedBy: OWNER, decidedVia: 'page' } });
    const b = t.approvals.request(t.ada.id, { kind: 'publish', tool: 'Bash', target: 'git push origin', summary: 'yayın' });
    const no = await call(t.port, 'POST', `/api/approvals/${b.id}/deny`, await pageHeaders(t.port), { note: 'şimdi değil' });
    expect(no).toMatchObject({ status: 200, body: { status: 'denied', note: 'şimdi değil', decidedVia: 'page' } });
    const again = await call(t.port, 'POST', `/api/approvals/${b.id}/approve`, await pageHeaders(t.port));
    expect(again.status).toBe(409);
    const missing = await call(t.port, 'POST', '/api/approvals/00000000-0000-4000-8000-000000000000/approve', await pageHeaders(t.port));
    expect(missing.status).toBe(404);
  });
});
