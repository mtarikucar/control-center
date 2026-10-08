import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { DecisionStore, NoteStore } from '../src/company/memory-store.ts';
import { migrateUp, openDb } from '../src/db.ts';
import { MIGRATIONS } from '../src/migrations.ts';
import { FAKE_CLAUDE, tempDir, until } from './helpers.ts';

const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function startOffice(dataDir: string) {
  const child = spawn(process.execPath, [MAIN], {
    env: { ...process.env, OFFICE_DATA_DIR: dataDir, OFFICE_PORT: '0', OFFICE_CLAUDE_COMMAND: JSON.stringify([process.execPath, FAKE_CLAUDE]), FAKE_CLAUDE_STATE: tempDir() },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  cleanups.push(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });
  return { child, exited, output: () => output };
}

function call(port: number, method: string, path: string, body?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { 'content-type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data ? JSON.parse(data) : null));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('office-server process', () => {
  it('refuses a second office on the same data directory without touching the first', async () => {
    const dir = tempDir();
    const first = startOffice(dir);
    await until(() => /hazır: http:\/\/127\.0\.0\.1:\d+/.test(first.output()), 10_000);
    const port = Number(/hazır: http:\/\/127\.0\.0\.1:(\d+)/.exec(first.output())?.[1]);
    expect(port).toBeGreaterThan(0);

    const hired = await call(port, 'POST', '/api/employees', { name: 'Ada', role: 'r' });
    await call(port, 'POST', `/api/employees/${hired.id}/messages`, { text: 'SLOW job' });

    const second = startOffice(dir);
    expect(await second.exited).toBe(1);
    expect(second.output()).toMatch(/başka bir office-server/);

    const events: Array<{ event: { type: string; to?: string } }> = await call(port, 'GET', `/api/employees/${hired.id}/events?after=0`);
    expect(events.some((e) => e.event.type === 'lifecycle.changed' && e.event.to === 'interrupted')).toBe(false);

    first.child.kill('SIGINT');
    expect(await first.exited).toBe(0);
    expect(existsSync(join(dir, 'office.lock'))).toBe(false);
  }, 30_000);

  it('fills the search index on start from a database written before it, and keeps it filled as the office writes (B11)', async () => {
    const dir = tempDir();
    // An office database from before v20: a note and a decision, written with no search index.
    const db = openDb(join(dir, 'office.db'));
    migrateUp(db, MIGRATIONS.filter((m) => m.version <= 15));
    new NoteStore(db).create({ by: 'a', title: 'Seslendirme', text: 'ElevenLabs Türkçe iyi.', tags: [], source: null });
    const decision = new DecisionStore(db).create({ by: 'c', title: 'Ses aracı', chosen: 'ElevenLabs', reason: 'Türkçe', alternatives: [], planId: null, reverts: null });
    db.close();
    const office = startOffice(dir);
    await until(() => /hazır: http:\/\/127\.0\.0\.1:\d+/.test(office.output()), 10_000);
    const port = Number(/hazır: http:\/\/127\.0\.0\.1:(\d+)/.exec(office.output())?.[1]);
    const found: Array<{ kind: string; title: string }> = await call(port, 'GET', '/api/memory/search?q=elevenlabs');
    expect(found.map((h) => h.kind).sort()).toEqual(['decision', 'note']);
    // The owner reverts the decision: the record it writes is in the index at once.
    await call(port, 'POST', `/api/decisions/${decision.id}/revert`);
    expect(await call(port, 'GET', `/api/memory/search?q=${encodeURIComponent('geri alındı')}`)).toMatchObject([{ kind: 'decision', title: 'Geri alındı: Ses aracı' }]);
    office.child.kill('SIGINT');
    expect(await office.exited).toBe(0);
  }, 30_000);

  it('serves the office tools only to a valid token', async () => {
    const dir = tempDir();
    const office = startOffice(dir);
    await until(() => /hazır: http:\/\/127\.0\.0\.1:\d+/.test(office.output()), 10_000);
    const port = Number(/hazır: http:\/\/127\.0\.0\.1:(\d+)/.exec(office.output())?.[1]);
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, method: 'POST', path: '/mcp', headers: { 'content-type': 'application/json' } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    });
    expect(status).toBe(401);
    office.child.kill('SIGINT');
    await office.exited;
  });
});
