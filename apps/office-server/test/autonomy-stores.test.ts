import { afterEach, describe, expect, it } from 'vitest';
import type { CustomCapability } from '@cc/shared';
import { CustomCapabilityStore } from '../src/company/custom-capability-store.ts';
import { OutboxStore, type NewOutboxEntry } from '../src/company/outbox-store.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

function db() {
  const s = setup();
  cleanups.push(s.cleanup);
  return s.db;
}

describe('CustomCapabilityStore (spec capabilities §4.1)', () => {
  it('puts a row and reads it back; updates its decision; a row put again under its id starts over; lists by status, oldest first', () => {
    const store = new CustomCapabilityStore(db());
    const base: CustomCapability = { id: 'sms.send', title: 'SMS', summary: 's', kind: 'send', tools: ['mcp__netgsm__send_sms'], status: 'proposed', proposedBy: 'e1', decidedBy: null, note: null, createdAt: 1, decidedAt: null };
    expect(store.put(base)).toEqual(base);
    expect(store.find('x.y')).toBeNull();
    expect(() => store.get('x.y')).toThrow(/Şirket yeteneği bulunamadı: x\.y/);
    expect(store.update('sms.send', { status: 'rejected', decidedBy: 'c1', note: 'gerek yok', decidedAt: 2 })).toEqual({ ...base, status: 'rejected', decidedBy: 'c1', note: 'gerek yok', decidedAt: 2 });
    store.put({ ...base, id: 'sms.read', kind: 'read', tools: ['mcp__netgsm__inbox'], status: 'active', decidedBy: 'owner', createdAt: 3, decidedAt: 3 });
    expect(store.put({ ...base, title: 'SMS gönderme', createdAt: 4 })).toEqual({ ...base, title: 'SMS gönderme', createdAt: 4 });
    expect(store.list().map((c) => c.id)).toEqual(['sms.read', 'sms.send']);
    expect(store.list({ statuses: ['active'] }).map((c) => c.id)).toEqual(['sms.read']);
  });
});

describe('OutboxStore (spec capabilities §7)', () => {
  let now = 1_000;
  const make = () => {
    now = 1_000;
    const outbox = new OutboxStore(db(), () => now);
    const line = (over: Partial<NewOutboxEntry> = {}) =>
      outbox.add({ employeeId: 'e1', departmentId: 'd1', tool: 'mcp__claude_ai_Gmail__send_message', kind: 'send', target: 'send_message to=a@x.co', recipients: ['a@x.co'], summary: '{"to":"a@x.co"}', via: 'system', approvalId: null, ...over });
    return { outbox, line };
  };

  it('keeps each line as written (at most 20 recipients, a 300-character summary), newest first; narrows by department (null: the centre), kind and time', () => {
    const { outbox, line } = make();
    const a = line({ recipients: Array.from({ length: 25 }, (_, i) => `k${i}@x.co`), summary: 'x'.repeat(400) });
    expect(a).toMatchObject({ id: 1, at: 1_000 });
    expect(a.recipients).toHaveLength(20);
    expect(a.summary).toHaveLength(300);
    now = 2_000;
    const b = line({ employeeId: 'e2', departmentId: null, kind: 'call', target: 'jeeta_click_to_dial' });
    now = 3_000;
    const c = line({ via: 'owner', approvalId: 'ap1' });
    expect(outbox.list()).toEqual([c, b, a]);
    expect(outbox.list({ departmentId: 'd1' }).map((e) => e.id)).toEqual([c.id, a.id]);
    expect(outbox.list({ departmentId: null }).map((e) => e.id)).toEqual([b.id]);
    expect(outbox.list({ kind: 'call' }).map((e) => e.id)).toEqual([b.id]);
    // `since` is inclusive: a line written at that very moment is in.
    expect(outbox.list({ since: 2_000 }).map((e) => e.id)).toEqual([c.id, b.id]);
    expect(outbox.list({ limit: 1 }).map((e) => e.id)).toEqual([c.id]);
  });

  it('cuts the summary by code point: an emoji at the 300th place is kept whole or dropped whole, never half', () => {
    const { outbox, line } = make();
    const kept = line({ summary: `${'x'.repeat(299)}😀tail` });
    const dropped = line({ summary: `${'x'.repeat(300)}😀` });
    expect([kept.summary, dropped.summary]).toEqual([`${'x'.repeat(299)}😀`, 'x'.repeat(300)]);
    // As stored: read back, the same text.
    expect(outbox.list().map((e) => e.summary)).toEqual([dropped.summary, kept.summary]);
  });

  it('counts what the system let out: a department’s, or — someone without one — theirs alone; never the owner’s approvals', () => {
    const { outbox, line } = make();
    line();
    line({ employeeId: 'e3' });
    line({ employeeId: 'e3', kind: 'publish' });
    line({ via: 'owner', approvalId: 'ap1' });
    line({ kind: 'call' });
    line({ departmentId: 'd2' });
    line({ employeeId: 'e5', departmentId: null });
    line({ employeeId: 'e6', departmentId: null });
    const count = (departmentId: string | null, employeeId: string, kinds: Array<'send' | 'publish' | 'call'>, since = 0) => outbox.countSystem({ departmentId, employeeId, kinds, since });
    expect(count('d1', 'e9', ['send', 'publish'])).toBe(3);
    expect(count('d1', 'e1', ['call'])).toBe(1);
    expect(count('d2', 'e1', ['send', 'publish'])).toBe(1);
    expect(count(null, 'e5', ['send', 'publish'])).toBe(1);
    expect(count(null, 'e7', ['send', 'publish'])).toBe(0);
    expect(count('d1', 'e1', ['send', 'publish'], 1_001)).toBe(0);
    // The hour's window is `at >= since`: a line written at `since` itself still counts.
    expect(count('d1', 'e1', ['send', 'publish'], 1_000)).toBe(3);
  });

  it('the scope and the value it is bound to come from the same test: a department id, whatever it is, is counted as a department', () => {
    const { outbox, line } = make();
    line({ departmentId: '' });
    line({ employeeId: 'e2', departmentId: '' });
    expect(outbox.countSystem({ departmentId: '', employeeId: 'e1', kinds: ['send'], since: 0 })).toBe(2);
  });
});

describe('OutboxStore.together (hardening round 2)', () => {
  it('when SQLite has already ended the transaction itself, the error that made it surfaces, not the rollback’s', () => {
    const d = db();
    const store = new OutboxStore(d);
    expect(() =>
      store.together(() => {
        d.exec('ROLLBACK');
        throw new Error('asıl hata');
      }),
    ).toThrow('asıl hata');
    expect(d.isTransaction).toBe(false);
    expect(store.together(() => 7)).toBe(7);
  });
});
