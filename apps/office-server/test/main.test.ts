import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ConstitutionStore } from '../src/company/budget-store.ts';
import { DecisionStore, NoteStore } from '../src/company/memory-store.ts';
import { TaskStore } from '../src/company/store.ts';
import { migrateUp, openDb } from '../src/db.ts';
import { MIGRATIONS } from '../src/migrations.ts';
import { Roster } from '../src/roster.ts';
import { FAKE_CLAUDE, tempDir, until } from './helpers.ts';
import { pageHeaders } from './owner-helpers.ts';

const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function startOffice(dataDir: string, env: Record<string, string> = {}) {
  const child = spawn(process.execPath, [MAIN], {
    env: { ...process.env, OFFICE_DATA_DIR: dataDir, OFFICE_PORT: '0', OFFICE_CLAUDE_COMMAND: JSON.stringify([process.execPath, FAKE_CLAUDE]), FAKE_CLAUDE_STATE: tempDir(), ...env },
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

/** A change goes as the office page sends it (pageHeaders). */
async function call(port: number, method: string, path: string, body?: unknown): Promise<any> {
  const page = method === 'GET' ? {} : await pageHeaders(port);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { 'content-type': 'application/json', ...page } }, (res) => {
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
  it('does not open on a database whose migrations are not the code’s: says which version, exits 1, frees the lock', async () => {
    const dir = tempDir();
    // B26 went live alone as 16 and v15 of the code is another migration under the same number.
    const db = openDb(join(dir, 'office.db'));
    migrateUp(db);
    db.prepare("UPDATE schema_migrations SET name = 'KPI readings' WHERE version = 15").run();
    db.close();
    const office = startOffice(dir);
    expect(await office.exited).toBe(1);
    expect(office.output()).toContain('office-server açılmadı: v15 canlıda “KPI readings”, kodda “integration registry: what the coordinator records by hand”: göç sırası bozuk.');
    expect(office.output()).not.toMatch(/hazır: http/);
    expect(existsSync(join(dir, 'office.lock'))).toBe(false);
  });

  it('review (Kerem): opens on a database ahead of the code (only the code went back) and says so in one line', async () => {
    const dir = tempDir();
    // Ahead: one version above the code's last, whatever that is (core-3 makes it 18, B26 19 …; task 37b8bbe7).
    const above = Math.max(...MIGRATIONS.map((m) => m.version)) + 1;
    const db = openDb(join(dir, 'office.db'));
    migrateUp(db);
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, 1)').run(above, 'a migration of newer code');
    db.close();
    const office = startOffice(dir);
    await until(() => /hazır: http:\/\/127\.0\.0\.1:\d+/.test(office.output()), 10_000);
    expect(office.output()).toContain(`Uyarı: veritabanı koddan ileride: v${above} “a migration of newer code” bu kodda yok; göç çalıştırılmadı, ofis açılıyor.`);
  });

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
    // An office database from before v21: a note and a decision, written with no search index.
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

/**
 * main.ts's wiring (task 3ab606f2, Kerem's proposal 5b4f1c89; B9a's test is on the branch that has the gate): the features below enter the dispatcher and the engine as
 * optional dependencies given only in main.ts, so their own tests build them by hand and stay green if main.ts drops
 * them. Each test opens the real office process (fake claude, a temporary data folder) on a database prepared before
 * it opens, and looks at what only main.ts's wiring makes happen.
 */
describe('main.ts wiring: the office process', () => {
  /** A database the office will open: migrated, one employee asleep (the dispatcher wakes them when there is work). */
  function prepared(o: { capabilities?: string[] } = {}) {
    const dir = tempDir();
    const db = openDb(join(dir, 'office.db'));
    migrateUp(db);
    const roster = new Roster(db, 8);
    const ada = roster.create({ name: 'Ada', role: 'Metin yazarı', capabilityIds: o.capabilities });
    roster.update(ada.id, { lifecycle: 'sleeping' });
    return { dir, db, ada, tasks: new TaskStore(db) };
  }
  const work = (assignee: string, title: string, o: { done?: string[]; requires?: string[] } = {}) =>
    ({ planId: null, title, description: 'Kablolama testi.', done: o.done ?? [], requester: 'owner', assignee, priority: 1, dependsOn: [], chainDepth: 0, requires: o.requires });
  async function portOf(office: ReturnType<typeof startOffice>): Promise<number> {
    await until(() => /hazır: http:\/\/127\.0\.0\.1:\d+/.test(office.output()), 10_000);
    return Number(/hazır: http:\/\/127\.0\.0\.1:(\d+)/.exec(office.output())?.[1]);
  }
  /** A task as the office wrote it, read beside the running office. */
  function taskRow(dir: string, id: string): { status: string; note: string | null } {
    const db = new DatabaseSync(join(dir, 'office.db'), { readOnly: true });
    try {
      return db.prepare('SELECT status, note FROM tasks WHERE id = ?').get(id) as { status: string; note: string | null };
    } finally {
      db.close();
    }
  }
  async function stop(office: ReturnType<typeof startOffice>) {
    office.child.kill('SIGINT');
    expect(await office.exited).toBe(0);
  }

  it('B12: the task message the office hands out carries the related memory (`related` given to the dispatcher)', async () => {
    const { dir, db, ada, tasks } = prepared();
    new NoteStore(db).create({ by: 'koordinatör', title: 'Pastane Ada marka dili', text: 'Sıcak ve samimi; ünlem yok, emoji en çok bir.', tags: [], source: null });
    const task = tasks.create(work(ada.id, 'Pastane Ada için Instagram metni', { done: ['marka diline uygun üç gönderi'] }));
    db.close();
    const office = startOffice(dir);
    const port = await portOf(office);
    await until(() => taskRow(dir, task.id).status !== 'waiting', 15_000);
    const events: Array<{ event: { type: string; text?: string } }> = await call(port, 'GET', `/api/employees/${ada.id}/events?after=0`);
    const messages = events.filter((e) => e.event.type === 'message.user').map((e) => e.event.text ?? '');
    const delivery = messages.find((m) => m.includes('Pastane Ada için Instagram metni')) ?? '';
    expect(delivery, messages.join('\n---\n')).toContain('## İlgili hafıza');
    // The note is under the section, not only somewhere in the message.
    expect(delivery.slice(delivery.indexOf('## İlgili hafıza'))).toContain('Pastane Ada marka dili');
    await stop(office);
  }, 30_000);

  it('B8: with the precheck on, a task needing a capability its desk lacks is held, not handed out (`precheck` given to the dispatcher)', async () => {
    const { dir, db, ada, tasks } = prepared();
    new ConstitutionStore(db).set({ capabilityPrecheckEnabled: true });
    const task = tasks.create(work(ada.id, 'Müşteriye teklif e-postasını gönder', { requires: ['email.send'] }));
    db.close();
    const office = startOffice(dir);
    const port = await portOf(office);
    await until(() => taskRow(dir, task.id).status !== 'waiting', 15_000);
    const row = taskRow(dir, task.id);
    expect(row.status).toBe('blocked');
    expect(row.note).toContain('Yetenek ön-kontrolü');
    expect(row.note).toContain('email.send');
    const events: Array<{ event: { type: string; text?: string } }> = await call(port, 'GET', `/api/employees/${ada.id}/events?after=0`);
    expect(events.some((e) => e.event.type === 'message.user' && (e.event.text ?? '').includes('Müşteriye teklif e-postasını gönder'))).toBe(false);
    await stop(office);
  }, 30_000);

  it('B9b: a session opens with the role’s closed tools in --disallowedTools, per role (`sessionDeny` given to the engine)', async () => {
    const { dir, db, ada } = prepared();
    const bora = new Roster(db, 8).create({ name: 'Bora', role: 'Hesap yöneticisi', capabilityIds: ['email.send'] });
    db.close();
    const log = join(tempDir(), 'argv.jsonl');
    const office = startOffice(dir, { FAKE_CLAUDE_ARGV_LOG: log });
    const port = await portOf(office);
    await call(port, 'POST', `/api/employees/${ada.id}/messages`, { text: 'merhaba' });
    await call(port, 'POST', `/api/employees/${bora.id}/messages`, { text: 'merhaba' });
    const starts = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { args: string[]; cwd: string }) : []);
    await until(() => starts().length >= 2, 15_000);
    /** What one desk's session closes: the values of its one --disallowedTools flag. */
    const closed = (slug: string) => {
      const args = starts().find((s) => s.cwd.endsWith(`/${slug}`))!.args;
      const at = args.indexOf('--disallowedTools');
      const end = args.findIndex((a, i) => i > at && a.startsWith('--'));
      return args.slice(at + 1, end < 0 ? undefined : end);
    };
    const send = 'mcp__claude_ai_Gmail__send_message';
    // Ada's role opens no outward capability: sending mail is closed; Bora's opens email.send, the rest stays closed.
    expect(closed('ada')).toContain(send);
    expect(closed('bora')).not.toContain(send);
    expect(closed('bora')).toContain('mcp__claude_ai_Google_Calendar__create_event');
    await stop(office);
  }, 30_000);

  it('B9a: with the gate on, a session’s settings carry the hook, and the hook run as the session runs it gets the gate’s answer (`gate` given to the engine and the API)', async () => {
    const { dir, db, ada } = prepared();
    new ConstitutionStore(db).set({ gateEnabled: true });
    db.close();
    const log = join(tempDir(), 'argv.jsonl');
    const office = startOffice(dir, { FAKE_CLAUDE_ARGV_LOG: log });
    const port = await portOf(office);
    await call(port, 'POST', `/api/employees/${ada.id}/messages`, { text: 'merhaba' });
    await until(() => existsSync(log) && readFileSync(log, 'utf8').trim() !== '', 15_000);
    const start = JSON.parse(readFileSync(log, 'utf8').trim().split('\n')[0]!) as { args: string[]; cwd: string; gate: { url: string | null; token: string | null } };
    const settings = JSON.parse(start.args[start.args.indexOf('--settings') + 1]!) as { hooks?: { PreToolUse?: Array<{ hooks: Array<{ command: string }> }> } };
    const hook = settings.hooks?.PreToolUse?.[0]?.hooks[0]?.command ?? '';
    expect(hook).toContain('gate.mjs');
    expect(start.gate.url).toBe(`http://127.0.0.1:${port}/gate/check`);
    /** The hook as Claude Code runs it: its command through the shell, the call on stdin, the session's environment. */
    const ask = (command: string) =>
      new Promise<{ code: number | null; stderr: string }>((resolve) => {
        const child = spawn(hook, { shell: true, cwd: start.cwd, env: { ...process.env, OFFICE_GATE_URL: start.gate.url ?? '', OFFICE_GATE_TOKEN: start.gate.token ?? '' } });
        let stderr = '';
        child.stderr.on('data', (d) => (stderr += d));
        child.on('exit', (code) => resolve({ code, stderr }));
        child.stdin.end(JSON.stringify({ hook_event_name: 'PreToolUse', cwd: start.cwd, tool_name: 'Bash', tool_input: { command } }));
      });
    // A harmless call runs; one that cannot be taken back waits for the owner (with the gate off both would run).
    expect(await ask('ls')).toEqual({ code: 0, stderr: '' });
    const push = await ask('git push origin main');
    expect(push.code).toBe(2);
    expect(push.stderr).toContain('OFİS KAPISI');
    await stop(office);
  }, 30_000);
});
