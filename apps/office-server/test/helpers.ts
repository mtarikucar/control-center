import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StoredEvent } from '@cc/shared';
import type { EventStore } from '../src/event-store.ts';

export function tempDir(prefix = 'cc-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
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
