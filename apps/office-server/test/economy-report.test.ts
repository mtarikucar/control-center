import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { OfficeEvent, Usage } from '@cc/shared';
import { migrateUp, openDb } from '../src/db.ts';
import { economyReport, formatReport, parseWhen } from '../src/economy-report.ts';
import { EventStore } from '../src/event-store.ts';
import { MIGRATIONS } from '../src/migrations.ts';
import { NoticeStore } from '../src/company/store.ts';
import { Roster } from '../src/roster.ts';
import { tempDir } from './helpers.ts';

const MIN = 60_000;
const T0 = new Date(2026, 9, 7, 9, 0).getTime();
const usage = (n: number): Usage => ({ inputTokens: n, outputTokens: n, cacheReadTokens: n * 10, cacheCreationTokens: n * 2 });
const finished = (cost: number, n = 1): OfficeEvent => ({ type: 'turn.finished', ok: true, subtype: 'success', usage: usage(n), costUsd: cost, numTurns: 1, queuedTurns: 0, sessionUsage: null, sessionCostUsd: 0 });

/** A small office day: the coordinator on three causes, a member on two tasks, one stuck and given back. */
function office(file: string, version = Math.max(...MIGRATIONS.map((m) => m.version))) {
  let clock = T0;
  const now = () => clock;
  const db = openDb(file);
  migrateUp(db, MIGRATIONS.filter((m) => m.version <= version));
  const events = new EventStore(db, now);
  const roster = new Roster(db, 8, now);
  // Plain SQL so the same office fits a database from before the plan (schema 5).
  const task = (title: string) => {
    const id = `t-${title}`;
    db.prepare(
      `INSERT INTO tasks (id, plan_id, title, description, done, requester, assignee, priority, depends_on, status, chain_depth, created_at)
       VALUES (?, NULL, ?, '', '[]', 'owner', ?, 3, '[]', 'waiting', 0, ?)`,
    ).run(id, title, ada.id, clock);
    return { id, planId: null, kind: 'work' as const, title, description: '', done: [], requester: 'owner', assignee: ada.id, priority: 3, dependsOn: [], status: 'waiting' as const, chainDepth: 0, note: null, result: null, nudged: false, createdAt: clock, startedAt: null, finishedAt: null };
  };
  const coord = roster.create({ name: 'Koordinatör', role: 'r', model: 'fable', kind: 'coordinator' });
  const ada = roster.create({ name: 'Ada', role: 'r', model: 'sonnet' });
  const turn = (id: string, text: string, source: 'owner' | 'system', cost: number) => {
    events.append(id, { type: 'message.user', text, source });
    events.append(id, { type: 'turn.started' });
    clock += MIN;
    events.append(id, finished(cost));
  };
  events.append(coord.id, { type: 'session.started', model: 'claude-fable-5-1', mcp: [] });
  turn(coord.id, 'Bir plan öner.', 'owner', 1.5);
  events.append(coord.id, { type: 'session.started', model: 'claude-sonnet-5-5', mcp: [] });
  turn(coord.id, 'Ofisten notlar:\n- Görev bitti: “Yaz” (Ada): yazıldı\n- Ada “Çiz” görevinde takıldı.', 'system', 0.1);
  events.append(coord.id, { type: 'session.started', model: 'claude-haiku-4-5', mcp: [] });
  turn(coord.id, '## Ofisten özet — 2 not, 09:00–10:00\n\nTeslimler (2):\n- …', 'system', 0.02);
  events.append(ada.id, { type: 'session.started', model: 'claude-sonnet-5-5', mcp: [] });
  const yaz = task('Yaz');
  const ciz = task('Çiz');
  for (const t of [yaz, ciz]) events.append(ada.id, { type: 'task.changed', change: 'started', task: { ...t, status: 'in_progress' } });
  turn(ada.id, '## Görev: Yaz', 'system', 0.3);
  db.prepare("UPDATE tasks SET status = 'done', finished_at = ? WHERE id = ?").run(clock, yaz.id);
  turn(ada.id, '## Görev: Çiz', 'system', 0.2);
  events.append(ada.id, { type: 'task.changed', change: 'updated', task: { ...ciz, status: 'blocked' } });
  events.append(ada.id, { type: 'task.changed', change: 'assigned', task: { ...ciz, status: 'waiting' } });
  events.append(ada.id, { type: 'side.answer', text: 'x', ok: true, usage: usage(1), costUsd: 0.01 });
  return { db, coord, ada, clock: () => clock, setClock: (t: number) => (clock = t), notices: new NoticeStore(db, now), now };
}

describe('economy report', () => {
  it('counts turns, money, tokens and models per employee, per hand-in, and why the coordinator’s turns came', () => {
    const t = office(':memory:');
    const r = economyReport(t.db, { since: T0, until: T0 + 60 * MIN });
    const coord = r.employees.find((e) => e.name === 'Koordinatör')!;
    expect(coord.usage).toMatchObject({ turns: 3, input: 3, cacheRead: 30 });
    expect(coord.usage.usd).toBeCloseTo(1.62);
    expect(coord.models).toEqual({ fable: 1, sonnet: 1, haiku: 1 });
    expect(r.employees.find((e) => e.name === 'Ada')!.usage).toMatchObject({ turns: 2, sideAnswers: 1 });
    expect(r.coordinator).toMatchObject({ turns: 3, causes: { 'sahibinin mesajı': 1, 'karar notu': 1, özet: 1 }, noticeLines: { teslim: 1, takılma: 1 } });
    expect(r.handIns).toBe(1);
    expect(r.perHandIn).toMatchObject({ turns: 5, coordinatorTurns: 3 });
    expect(r.perHandIn.usd).toBeCloseTo(2.13);
    expect(r.quality).toMatchObject({ started: 2, blocked: 1, blockedRate: 0.5, requeued: 1 });
    const text = formatReport(r);
    expect(text).toContain('Örneklem: 1 teslim, 5 tur, 2 çalışan.');
    expect(text).toContain('Turu açan: sahibinin mesajı 1 · karar notu 1 · özet 1');
  });

  it('times notices from written to delivered and counts those still waiting at the window’s end, by kind', () => {
    const t = office(':memory:');
    const ids = (id: string) => t.notices.pending(id).map((n) => n.id);
    t.setClock(T0);
    t.notices.add(t.coord.id, 'plan.approved', 'a');
    t.notices.add(t.coord.id, 'task.finished', 'b');
    t.setClock(T0 + 2 * MIN);
    t.notices.markDelivered(ids(t.coord.id));
    t.setClock(T0 + 10 * MIN);
    t.notices.add(t.coord.id, 'task.blocked', 'c');
    const r = economyReport(t.db, { since: T0, until: T0 + 30 * MIN });
    expect(r.latency.decision).toMatchObject({ count: 1, p50: 2, p95: 2 });
    expect(r.latency.info).toMatchObject({ count: 1, p50: 2 });
    expect(r.pending.decision).toEqual({ count: 1, oldestMinutes: 20 });
    expect(r.pending.info.count).toBe(0);
  });

  it('reads a database from before the plan (schema 5: no notice kinds): every notice counts as a decision', () => {
    const t = office(':memory:', 5);
    t.db.prepare("INSERT INTO notices (employee_id, text, created_at, delivered_at) VALUES (?, 'eski', ?, NULL)").run(t.coord.id, T0);
    const r = economyReport(t.db, { since: T0, until: T0 + 60 * MIN });
    expect(r.schemaVersion).toBe(5);
    expect(r.pending.decision.count).toBe(1);
    expect(formatReport(r)).toContain('Şema 6 öncesi');
  });

  it('review focus: the command opens the database read-only and leaves it byte for byte as it was', () => {
    const file = join(tempDir('economy-report-'), 'office.db');
    const t = office(file);
    t.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    t.db.close();
    const hash = () => createHash('sha256').update(readFileSync(file)).digest('hex');
    const before = hash();
    const script = fileURLToPath(new URL('../scripts/economy-report.ts', import.meta.url));
    const out = execFileSync(process.execPath, [script, '--db', file, '--since', '2026-10-07', '--until', '2026-10-08'], { encoding: 'utf8' });
    expect(out).toContain('salt okunur');
    expect(out).toContain('Örneklem: 1 teslim, 5 tur');
    expect(hash()).toBe(before);
  });

  it('reads a day as local midnight', () => {
    expect(parseWhen('2026-10-07')).toBe(T0 - 9 * 60 * MIN);
    expect(() => parseWhen('dün')).toThrow(/anlaşılmadı/);
  });
});
