import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrateUp, openDb } from '../src/db.ts';
import { EventStore } from '../src/event-store.ts';
import { tempDir } from './helpers.ts';

function store(now?: () => number) {
  const db = openDb(':memory:');
  migrateUp(db);
  return new EventStore(db, now);
}

describe('EventStore', () => {
  it('appends with increasing seq and lists after a seq', () => {
    const s = store(() => 1000);
    const a = s.append('e1', { type: 'turn.started' });
    const b = s.append('e1', { type: 'message.assistant', text: 'merhaba' });
    expect(b.seq).toBeGreaterThan(a.seq);
    expect(a.ts).toBe(1000);
    expect(s.list({ after: a.seq })).toEqual([b]);
  });

  it('filters by employee and respects the limit', () => {
    const s = store();
    s.append('e1', { type: 'turn.started' });
    s.append('e2', { type: 'turn.started' });
    s.append(null, { type: 'error', message: 'genel' });
    s.append('e1', { type: 'turn.started' });
    expect(s.list({ employeeId: 'e1' }).map((e) => e.employeeId)).toEqual(['e1', 'e1']);
    expect(s.list({ limit: 2 })).toHaveLength(2);
  });

  it('notifies subscribers and a throwing subscriber does not break append', () => {
    const s = store();
    const seen: number[] = [];
    s.subscribe(() => {
      throw new Error('kötü dinleyici');
    });
    const off = s.subscribe((e) => seen.push(e.seq));
    const first = s.append('e1', { type: 'turn.started' });
    off();
    s.append('e1', { type: 'turn.started' });
    expect(seen).toEqual([first.seq]);
  });

  it('finds the latest event of a type for an employee', () => {
    const s = store();
    expect(s.latest('e1', 'turn.started')).toBeNull();
    s.append('e1', { type: 'turn.started' });
    const last = s.append('e1', { type: 'turn.started' });
    s.append('e2', { type: 'turn.started' });
    expect(s.latest('e1', 'turn.started')).toEqual(last);
  });

  it('returns the last N events in ascending order with tail', () => {
    const s = store();
    for (let i = 0; i < 5; i += 1) s.append('e1', { type: 'turn.started' });
    s.append('e2', { type: 'turn.started' });
    const tail = s.list({ employeeId: 'e1', tail: true, limit: 2 });
    expect(tail.map((e) => e.seq)).toEqual([4, 5]);
    expect(s.list({ tail: true, limit: 1 }).map((e) => e.seq)).toEqual([6]);
  });

  it('lists events of the given types logged after a time, oldest first, keeping the newest when over the limit', () => {
    let clock = 1000;
    const s = store(() => clock);
    s.append('e1', { type: 'message.user', text: 'önce', source: 'owner' });
    clock = 2000;
    const a = s.append('e1', { type: 'message.user', text: 'sınırda', source: 'owner' });
    clock = 3000;
    const b = s.append(null, { type: 'company.paused', paused: true });
    s.append('e1', { type: 'turn.started' });
    clock = 4000;
    const c = s.append('e2', { type: 'message.user', text: 'sonra', source: 'system' });
    // Strictly after the time: an event at 1000 is not "after 1000".
    expect(s.since(1000, ['message.user', 'company.paused'])).toEqual([a, b, c]);
    expect(s.since(2000, ['message.user'])).toEqual([c]);
    expect(s.since(1000, ['message.user', 'company.paused'], 2)).toEqual([b, c]);
    expect(s.since(0, [])).toEqual([]);
  });

  it('finds the last event of a type logged at or before a time', () => {
    let clock = 1000;
    const s = store(() => clock);
    expect(s.lastAt('company.paused', 5000)).toBeNull();
    s.append(null, { type: 'company.paused', paused: true });
    clock = 2000;
    const second = s.append(null, { type: 'company.paused', paused: false });
    s.append('e1', { type: 'turn.started' });
    clock = 3000;
    s.append(null, { type: 'company.paused', paused: true });
    expect(s.lastAt('company.paused', 2500)).toEqual(second);
    expect(s.lastAt('company.paused', 2000)).toEqual(second);
    expect(s.lastAt('company.paused', 999)).toBeNull();
  });

  it('says when someone last logged one of some types at or after a time (null: none)', () => {
    let now = 1000;
    const s = store(() => now);
    s.append('k', { type: 'message.assistant', text: 'önce' });
    now = 2000;
    s.append('k', { type: 'tool.started', toolUseId: 't', name: 'x', input: {} });
    now = 3000;
    s.append('k', { type: 'lifecycle.changed', from: 'working', to: 'interrupted', reason: 'ofis kapanırken iş sürüyordu' });
    s.append('a', { type: 'message.assistant', text: 'başkası' });
    const work = ['message.assistant', 'tool.started', 'tool.finished', 'turn.finished'] as const;
    expect(s.lastTs('k', 1500, work)).toBe(2000);
    expect(s.lastTs('k', 0, ['message.assistant'])).toBe(1000);
    expect(s.lastTs('k', 2500, work)).toBeNull();
    expect(s.lastTs('k', 0, [])).toBeNull();
  });

  it('finds the last change of one task at or before a time', () => {
    let clock = 1000;
    const s = store(() => clock);
    const task = (id: string, status: 'waiting' | 'blocked') => ({ id, status }) as unknown as import('@cc/shared').Task;
    s.append('e1', { type: 'task.changed', change: 'created', task: task('a', 'waiting') });
    const blocked = s.append('e1', { type: 'task.changed', change: 'updated', task: task('a', 'blocked') });
    s.append('e2', { type: 'task.changed', change: 'created', task: task('b', 'waiting') });
    clock = 2000;
    s.append('e1', { type: 'task.changed', change: 'updated', task: task('a', 'waiting') });
    expect(s.lastAt('task.changed', 1500, { taskId: 'a' })).toEqual(blocked);
    expect(s.lastAt('task.changed', 1500, { taskId: 'c' })).toBeNull();
    expect(s.lastAt('task.changed', 1500)?.event).toMatchObject({ task: { id: 'b' } });
  });

  it('reports lastSeq, 0 when empty', () => {
    const s = store();
    expect(s.lastSeq()).toBe(0);
    const e = s.append('e1', { type: 'turn.started' });
    expect(s.lastSeq()).toBe(e.seq);
  });

  it('keeps events across reopening the database file', () => {
    const file = join(tempDir(), 'office.db');
    const db = openDb(file);
    migrateUp(db);
    new EventStore(db).append('e1', { type: 'message.user', text: 'kalıcı', source: 'owner' });
    db.close();
    const reopened = openDb(file);
    expect(new EventStore(reopened).list()[0]?.event).toEqual({ type: 'message.user', text: 'kalıcı', source: 'owner' });
  });
});
