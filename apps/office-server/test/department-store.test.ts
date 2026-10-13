import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../src/errors.ts';
import { DepartmentStore, StreamNoteStore } from '../src/company/department-store.ts';
import { setup } from './helpers.ts';

describe('DepartmentStore', () => {
  it('creates, reads, lists open and closed in opening order, updates and closes', () => {
    let now = 1000;
    const s = setup();
    const store = new DepartmentStore(s.db, () => now);
    const a = store.create({ name: 'Pazarlama', mission: 'm', scope: 's', template: { id: 'pazarlama', version: 1 }, headId: null });
    now = 2000;
    const b = store.create({ name: 'Satış', mission: 'm2', scope: '', template: null, headId: 'e1' });
    expect(a).toEqual({ id: a.id, name: 'Pazarlama', mission: 'm', scope: 's', template: { id: 'pazarlama', version: 1 }, headId: null, status: 'open', createdAt: 1000, closedAt: null });
    expect(store.get(b.id)).toEqual(b);
    expect(store.list().map((d) => d.name)).toEqual(['Pazarlama', 'Satış']);
    expect(store.update(a.id, { name: 'Büyüme', headId: 'e2' })).toMatchObject({ name: 'Büyüme', headId: 'e2', mission: 'm' });
    now = 3000;
    expect(store.close(b.id)).toMatchObject({ status: 'closed', closedAt: 3000, headId: null });
    expect(store.list({ status: 'open' }).map((d) => d.id)).toEqual([a.id]);
    expect(store.list({ status: 'closed' }).map((d) => d.id)).toEqual([b.id]);
    expect(() => store.get('yok')).toThrow(NotFoundError);
  });
});

describe('StreamNoteStore', () => {
  it('adds plans and reports; the latest of a kind and all of a plan, newest first', () => {
    let now = 10;
    const s = setup();
    const notes = new StreamNoteStore(s.db, () => now);
    const p1 = notes.add({ planId: 'p', streamId: 'api', kind: 'plan', text: 'ilk', evidence: [], next: null, by: 'h' });
    now = 20;
    notes.add({ planId: 'p', streamId: 'api', kind: 'plan', text: 'ikinci', evidence: [], next: null, by: 'h' });
    now = 30;
    const r = notes.add({ planId: 'p', streamId: 'api', kind: 'report', text: 'bitti', evidence: ['test geçti'], next: 'yayın', by: 'h' });
    notes.add({ planId: 'q', streamId: 'api', kind: 'plan', text: 'başka', evidence: [], next: null, by: 'h' });
    expect(p1).toMatchObject({ planId: 'p', streamId: 'api', kind: 'plan', text: 'ilk', evidence: [], next: null, by: 'h', at: 10 });
    expect(notes.latest('p', 'api', 'plan')?.text).toBe('ikinci');
    expect(notes.latest('p', 'api', 'report')).toEqual(r);
    expect(notes.latest('p', 'ui', 'plan')).toBeNull();
    expect(notes.forPlan('p').map((n) => n.text)).toEqual(['bitti', 'ikinci', 'ilk']);
  });
});
