import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/api.ts';
import { OutboxStore, type NewOutboxEntry } from '../src/company/outbox-store.ts';
import { QuotaTracker } from '../src/quota.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function start() {
  const s = setup();
  const f = fakeEngine(s);
  const c = companyFor(s, f, ['coder']);
  const outbox = new OutboxStore(s.db);
  const api = createApi(
    { engine: f.engine, roster: s.roster, events: s.events, quota: new QuotaTracker(s.db, s.events), company: { service: c.company, tasks: c.tasks, plans: c.plans, memory: c.memory, budget: c.budget, proposals: c.proposals, outbox } },
    { allowedOrigins: [] },
  );
  await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', resolve));
  const port = (api.server.address() as AddressInfo).port;
  cleanups.push(() => api.close(), f.cleanup, s.cleanup);
  return { port, outbox };
}

function get(port: number, path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    httpRequest({ host: '127.0.0.1', port, method: 'GET', path }, (res) => {
      let data = '';
      res.on('data', (x) => (data += x));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null }));
    }).on('error', reject).end();
  });
}

describe('the owner’s outbox (spec capabilities §7)', () => {
  it('newest first; by department (none: the centre) or kind; 1–200 of them', async () => {
    const t = await start();
    const line = (over: Partial<NewOutboxEntry>) =>
      t.outbox.add({ employeeId: 'e1', departmentId: null, tool: 'mcp__claude_ai_Gmail__send_message', kind: 'send', target: 'send_message to=a@x.co', recipients: ['a@x.co'], summary: '{}', via: 'system', approvalId: null, ...over });
    const a = line({});
    const b = line({ departmentId: 'd1', kind: 'call', target: 'jeeta_click_to_dial' });
    const c = line({ departmentId: 'd1', via: 'owner', approvalId: 'ap1' });
    const ids = async (q = '') => (await get(t.port, `/api/outbox${q}`)).body.map((e: { id: number }) => e.id);
    expect(await ids()).toEqual([c.id, b.id, a.id]);
    expect(await ids('?department=d1')).toEqual([c.id, b.id]);
    expect(await ids('?department=none')).toEqual([a.id]);
    expect(await ids('?kind=call')).toEqual([b.id]);
    expect(await ids('?limit=1')).toEqual([c.id]);
    expect((await get(t.port, '/api/outbox?limit=0')).status).toBe(400);
    expect((await get(t.port, '/api/outbox?kind=pay')).status).toBe(400);
  });
});
