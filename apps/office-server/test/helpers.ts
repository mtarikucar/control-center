import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';
import type { StoredEvent } from '@cc/shared';
import { migrateUp, openDb, type Db } from '../src/db.ts';
import { EventStore } from '../src/event-store.ts';
import { Roster } from '../src/roster.ts';

export const FAKE_CLAUDE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));

const created: string[] = [];
// Every test file gets its own copy of this module: remove what its tests created once the file is done.
afterAll(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export function tempDir(prefix = 'cc-test-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

export async function until(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) throw new Error('until: zaman aşımı');
    await new Promise((r) => setTimeout(r, 20));
  }
}

export function waitFor(
  events: EventStore,
  predicate: (e: StoredEvent) => boolean,
  opts: { after?: number; timeoutMs?: number } = {},
): Promise<StoredEvent> {
  const after = opts.after ?? 0;
  const match = (e: StoredEvent) => e.seq > after && predicate(e);
  const existing = events.list({ after, limit: 5000 }).find(match);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error('waitFor: zaman aşımı'));
    }, opts.timeoutMs ?? 5000);
    const off = events.subscribe((e) => {
      if (!match(e)) return;
      clearTimeout(timer);
      off();
      resolve(e);
    });
  });
}

export interface TestSetup {
  dataDir: string;
  db: Db;
  events: EventStore;
  roster: Roster;
  cleanup: () => void;
}

/** `now` (optional) is the clock of the event log and the roster, for tests that run on a simulated clock. */
export function setup(deskCount = 8, now?: () => number): TestSetup {
  const dataDir = tempDir();
  const db = openDb(':memory:');
  migrateUp(db);
  const events = new EventStore(db, now);
  const roster = new Roster(db, deskCount, now);
  return { dataDir, db, events, roster, cleanup: () => rmSync(dataDir, { recursive: true, force: true }) };
}
