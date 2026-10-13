import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER } from '@cc/shared';
import { createApi } from '../src/api.ts';
import { useCompanyCapabilities } from '../src/company/capabilities.ts';
import { asCapability, CustomCapabilities } from '../src/company/custom-capabilities.ts';
import { CustomCapabilityStore } from '../src/company/custom-capability-store.ts';
import { IntegrationRegistry } from '../src/company/integrations.ts';
import { QuotaTracker } from '../src/quota.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { pageHeaders } from './owner-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
  useCompanyCapabilities(null);
});

async function start() {
  const s = setup();
  const f = fakeEngine(s);
  const c = companyFor(s, f, ['coder']);
  const capabilities = new CustomCapabilities({ store: new CustomCapabilityStore(s.db), roster: s.roster, events: s.events, notices: c.notices, coordinator: () => c.company.coordinator() });
  useCompanyCapabilities(() => capabilities.active().map(asCapability));
  const integrations = new IntegrationRegistry({ db: s.db, roster: s.roster, events: s.events });
  const api = createApi(
    {
      engine: f.engine, roster: s.roster, events: s.events, quota: new QuotaTracker(s.db, s.events),
      company: { service: c.company, tasks: c.tasks, plans: c.plans, memory: c.memory, budget: c.budget, proposals: c.proposals, integrations, capabilities },
    },
    { allowedOrigins: [] },
  );
  await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', resolve));
  const port = (api.server.address() as AddressInfo).port;
  cleanups.push(() => api.close(), f.cleanup, s.cleanup);
  return { port, ...c, capabilities };
}

/** As the office page sends it (pageHeaders), unless `page: false` (a request from outside the page). */
async function call(port: number, method: string, path: string, body?: unknown, o: { page?: boolean } = {}): Promise<{ status: number; body: any }> {
  const page = method === 'GET' || o.page === false ? {} : await pageHeaders(port);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...page } }, (res) => {
      let data = '';
      res.on('data', (x) => (data += x));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    if (method === 'POST') req.write(JSON.stringify(body ?? {}));
    req.end();
  });
}

describe('the owner’s capability API (spec capabilities §4.2, §9)', () => {
  it('adds one (active at once), lists them, accepts a proposal with a kind, rejects with a note, changes a kind, retires; without the page’s nonce it is refused', async () => {
    const t = await start();
    t.company.hireCoordinator();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const added = await call(t.port, 'POST', '/api/custom-capabilities', { id: 'sms.send', title: 'SMS gönderme', summary: 'Netgsm ile SMS.', kind: 'send', tools: ['mcp__netgsm__send_sms'] });
    expect(added).toMatchObject({ status: 201, body: { id: 'sms.send', status: 'active', proposedBy: OWNER, decidedBy: OWNER } });
    expect((await call(t.port, 'GET', '/api/capabilities')).body.capabilities.at(-1)).toMatchObject({ id: 'sms.send', kind: 'send', outward: true, company: true });
    t.capabilities.propose(ada.id, { id: 'sms.read', title: 'SMS okuma', summary: 'Gelen SMS.', kind: 'read', tools: ['mcp__netgsm__inbox'] });
    t.capabilities.propose(ada.id, { id: 'sms.credits', title: 'SMS kredisi', summary: 'Kredi alır.', kind: 'pay', tools: ['mcp__netgsm__buy_credits'] });
    expect((await call(t.port, 'GET', '/api/custom-capabilities')).body.map((x: { id: string; status: string }) => `${x.id}:${x.status}`)).toEqual(['sms.send:active', 'sms.read:proposed', 'sms.credits:proposed']);
    expect((await call(t.port, 'POST', '/api/custom-capabilities/sms.read/accept', { kind: 'send' })).body).toMatchObject({ status: 'active', kind: 'send', decidedBy: OWNER });
    expect((await call(t.port, 'POST', '/api/custom-capabilities/sms.credits/reject', {})).status).toBe(400);
    expect((await call(t.port, 'POST', '/api/custom-capabilities/sms.credits/reject', { note: 'Kredi elle alınır.' })).body).toMatchObject({ status: 'rejected', note: 'Kredi elle alınır.' });
    expect((await call(t.port, 'POST', '/api/custom-capabilities/sms.read/kind', { kind: 'read' })).body).toMatchObject({ kind: 'read' });
    expect((await call(t.port, 'POST', '/api/custom-capabilities/sms.send/retire', {})).body).toMatchObject({ status: 'retired' });
    expect((await call(t.port, 'POST', '/api/custom-capabilities/sms.send/retire', {})).status).toBe(409);
    expect((await call(t.port, 'POST', '/api/custom-capabilities', { id: 'email.send', title: 'X', summary: 's', kind: 'send', tools: ['mcp__x__y'] })).body.error).toMatch(/ürünle gelen/);
    expect((await call(t.port, 'POST', '/api/custom-capabilities', { id: 'x.y', title: 'X', summary: 's', kind: 'read', tools: ['mcp__x__y'] }, { page: false })).status).toBe(403);
  });

  it('answers what the service refuses with its own status: an unknown id 404, a kind that is none 400, a body that is no object 400, a decided one 409', async () => {
    const t = await start();
    t.company.hireCoordinator();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    t.capabilities.propose(ada.id, { id: 'sms.send', title: 'SMS gönderme', summary: 'Netgsm ile SMS.', kind: 'send', tools: ['mcp__netgsm__send_sms'] });
    expect((await call(t.port, 'POST', '/api/custom-capabilities/no.such/accept', {})).status).toBe(404);
    expect((await call(t.port, 'POST', '/api/custom-capabilities/sms.send/kind', { kind: 'spend' })).body.error).toMatch(/Tür \(kind\) şunlardan biri olmalı/);
    expect((await call(t.port, 'POST', '/api/custom-capabilities', ['sms.send'])).status).toBe(400);
    expect((await call(t.port, 'POST', '/api/custom-capabilities/sms.send/accept', {})).body).toMatchObject({ status: 'active', kind: 'send', decidedBy: OWNER });
    expect((await call(t.port, 'POST', '/api/custom-capabilities/sms.send/accept', {})).status).toBe(409);
    // The owner's note on a retirement is kept.
    expect((await call(t.port, 'POST', '/api/custom-capabilities/sms.send/retire', { note: 'Artık gerekmiyor.' })).body).toMatchObject({ status: 'retired', note: 'Artık gerekmiyor.' });
  });
});
