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
