import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { OfficeEvent } from '@cc/shared';
import { GoalStore } from '../src/company/goal-store.ts';
import { PlanStore, ScheduleStore, TaskStore } from '../src/company/store.ts';
import { migrateUp, openDb, type Db } from '../src/db.ts';
import { EventStore } from '../src/event-store.ts';
import { performanceReport } from '../src/performance.ts';
import { formatPilotMetrics, pilotMetrics, type PilotMetrics } from '../src/pilot-metrics.ts';
import { QuotaTracker } from '../src/quota.ts';
import { Roster } from '../src/roster.ts';
import { tempDir } from './helpers.ts';

const SCRIPT = fileURLToPath(new URL('../scripts/pilot-metrics.ts', import.meta.url));
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Monday 5 October 2026, 09:00 local: the pilot's first day. */
const T0 = new Date(2026, 9, 5, 9, 0).getTime();
const SINCE = T0 - HOUR;
const UNTIL = T0 + 7 * DAY;

// The tables of branches not on main yet, as they define them: B5 (core-3 v18), B26 (kpi_readings), B9a (v21, spec).
const BLUEPRINTS = `
  CREATE TABLE blueprints (plan_id TEXT PRIMARY KEY, json TEXT NOT NULL, profile_version INTEGER NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE blueprint_steps (plan_id TEXT NOT NULL, step TEXT NOT NULL, ref TEXT, outcome TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (plan_id, step));`;
const KPI_READINGS = `
  CREATE TABLE kpi_readings (id INTEGER PRIMARY KEY AUTOINCREMENT, goal_id TEXT NOT NULL, kpi TEXT NOT NULL, value REAL, unit TEXT NOT NULL, target REAL NOT NULL,
    direction TEXT NOT NULL, source TEXT NOT NULL, period_start INTEGER, recorded_at INTEGER NOT NULL, recorded_by TEXT NOT NULL, note TEXT);`;
const APPROVALS = `
  CREATE TABLE approvals (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, task_id TEXT, kind TEXT NOT NULL, tool TEXT NOT NULL, target TEXT NOT NULL, fingerprint TEXT NOT NULL,
    summary TEXT NOT NULL, scope TEXT NOT NULL, status TEXT NOT NULL, requested_at INTEGER NOT NULL, decided_at INTEGER, decided_by TEXT, decided_via TEXT,
    expires_at INTEGER, used_at INTEGER, note TEXT);`;

/** An office database on disk, filled by the test, then read by a second, read-only connection. */
function office(o: { pilot: boolean }) {
  const file = join(tempDir('pilot-metrics-'), 'office.db');
  const db = openDb(file);
  migrateUp(db);
  let now = T0;
  const clock = () => now;
  const roster = new Roster(db, 8, clock);
  const hire = (name: string, kind?: 'coordinator') => {
    const e = roster.create({ name, role: 'r' });
    if (kind) roster.update(e.id, { kind });
    return e.id;
  };
  const ev = (employeeId: string | null, ts: number, event: OfficeEvent) =>
    db.prepare('INSERT INTO events (employee_id, ts, type, payload) VALUES (?, ?, ?, ?)').run(employeeId, ts, event.type, JSON.stringify(event));
  const read = () => new DatabaseSync(file, { readOnly: true });
  return { file, db, clock, at: (ts: number) => (now = ts), hire, ev, read, pilot: o.pilot };
}

const turn = (costUsd: number): OfficeEvent => ({
  type: 'turn.finished', ok: true, subtype: 'success', usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0 }, costUsd, numTurns: 1, queuedTurns: 0,
  sessionUsage: null, sessionCostUsd: costUsd,
} as OfficeEvent);

/** A week of the pilot, one fact per measure, every number known (pilot-senaryosu §7). */
function pilotWeek(withNewTables = true) {
  const t = office({ pilot: true });
  const { db, ev, hire } = t;
  if (withNewTables) db.exec(BLUEPRINTS + KPI_READINGS + APPROVALS);
  const coord = hire('Koordinatör', 'coordinator');
  const yazar = hire('Yazar');
  const editor = hire('Editör');
  const hesap = hire('Hesap');
  const onboarding = (status: string, rounds: Array<{ questions: string[] }>) => ({
    id: 'o1', description: 'Altı müşterili ajans', status, startedBy: 'owner', startedAt: T0, finishedAt: status === 'done' ? T0 + 5 * MIN : null,
    rounds: rounds.map((r, i) => ({ round: i + 1, questions: r.questions, askedAt: T0 + i * MIN, replied: true })),
  });

  // KÖ1: started, two coordinator turns, finished after 8 questions; a turn after it does not count.
  ev(coord, T0, { type: 'onboarding.changed', change: 'started', onboarding: onboarding('active', []) } as OfficeEvent);
  ev(coord, T0 + 1 * MIN, turn(0.5));
  ev(coord, T0 + 3 * MIN, turn(0.5));
  ev(coord, T0 + 5 * MIN, { type: 'onboarding.changed', change: 'finished', onboarding: onboarding('done', [{ questions: ['a', 'b', 'c', 'd', 'e'] }, { questions: ['f', 'g', 'h'] }]) } as OfficeEvent);

  // KÖ2: the install plan approved at +10 min, its last step at +28 min, no owner message in between.
  t.at(T0 + 6 * MIN);
  const plan = new PlanStore(db, t.clock).create({ title: 'Kurulum', goal: 'g', approach: 'a', people: '', steps: [], quotaPct: null, usd: null, days: null, risks: '', proposedBy: coord });
  ev(coord, T0 + 10 * MIN, { type: 'plan.changed', change: 'approved', plan } as OfficeEvent);
  if (withNewTables) {
    db.prepare('INSERT INTO blueprints VALUES (?, ?, 1, ?, ?, ?)').run(plan.id, '{}', coord, T0 + 6 * MIN, T0 + 6 * MIN);
    for (const [step, at] of [['brief', 11], ['role:yazar', 15], ['goal:h1', 20], ['task:arastirma', 28]] as const) {
      db.prepare("INSERT INTO blueprint_steps VALUES (?, ?, NULL, 'done', ?)").run(plan.id, step, T0 + at * MIN);
    }
  }

  // KÖ3, KÖ4: two reviewed work tasks done in the week; A first (approved on round 1, proof for both items), B on
  // round 3 with one proof missing.
  const tasks = new TaskStore(db, t.clock);
  const base = { planId: plan.id, description: '', requester: coord, priority: 3, dependsOn: [], chainDepth: 0 };
  t.at(T0 + 30 * MIN);
  const a = tasks.create({ ...base, title: 'A: araştırma', assignee: yazar, reviewer: editor, done: ['Bir sayfa', 'Kaynaklar'] });
  const b = tasks.create({ ...base, title: 'B: gelen kutusu', assignee: hesap, reviewer: editor, done: ['Özet', 'Taslaklar'] });
  tasks.update(a.id, { status: 'done', round: 1, finishedAt: T0 + 20 * HOUR, result: { summary: 's', outputs: [], learned: '', evidence: ['e1', 'e2'] } });
  tasks.update(b.id, { status: 'done', round: 3, finishedAt: T0 + 3 * DAY, result: { summary: 's', outputs: [], learned: '', evidence: ['e1'] } });
  const review = (of: string, decision: 'approve' | 'changes', at: number) => {
    const r = tasks.create({ ...base, kind: 'review', title: 'İnceleme', assignee: editor, reviewOf: of, done: [] });
    tasks.update(r.id, { status: 'done', finishedAt: at, result: { summary: decision, outputs: [], learned: '', review: { decision, findings: [] } } });
  };
  review(a.id, 'approve', T0 + 20 * HOUR);
  review(b.id, 'changes', T0 + 1 * DAY);
  review(b.id, 'changes', T0 + 2 * DAY);
  review(b.id, 'approve', T0 + 3 * DAY);

  // KÖ5: two outward calls (Gmail send by the writer, git push by the account assistant), two that are not; the writer's
  // send was approved before it, the push was not.
  ev(yazar, T0 + 2 * DAY, { type: 'tool.started', toolUseId: 't1', name: 'mcp__claude_ai_Gmail__send_email', input: { to: 'x@y.example' } });
  ev(hesap, T0 + 2 * DAY + HOUR, { type: 'tool.started', toolUseId: 't2', name: 'Bash', input: { command: 'cd repo && git push origin main' } });
  ev(coord, T0 + 2 * DAY, { type: 'tool.started', toolUseId: 't3', name: 'mcp__office__scheduleCreate', input: {} });
  ev(hesap, T0 + 2 * DAY, { type: 'tool.started', toolUseId: 't4', name: 'Bash', input: { command: 'ls gelen-kutusu' } });
  if (withNewTables) {
    db.prepare("INSERT INTO approvals VALUES ('ap1', ?, NULL, 'send', 'mcp__claude_ai_Gmail__send_email', 'x@y.example', 'f', 'yanıt', 'call', 'used', ?, ?, 'owner', 'page', NULL, ?, NULL)")
      .run(yazar, T0 + 2 * DAY - 2 * HOUR, T0 + 2 * DAY - HOUR, T0 + 2 * DAY);
  }

  // KÖ6: the owner accepted 3 proposals and declined 1 in the week; one the coordinator decided does not count.
  const proposal = (id: string, status: string, decidedBy: string) =>
    db.prepare("INSERT INTO proposals (id, ts, by_id, kind, title, text, status, decided_by, decided_at) VALUES (?, ?, ?, 'idea', 'Yayın paketi', 't', ?, ?, ?)").run(id, T0 + DAY, coord, status, decidedBy, T0 + 4 * DAY);
  proposal('p1', 'accepted', 'owner');
  proposal('p2', 'accepted', 'owner');
  proposal('p3', 'accepted', 'owner');
  proposal('p4', 'declined', 'owner');
  proposal('p5', 'declined', coord);

  // KÖ7: 2 coordinator turns ($0.5 each, above) and 3 writer turns ($1 each); one before the week does not count.
  for (const h of [1, 2, 3]) ev(yazar, T0 + h * HOUR, turn(1));
  ev(yazar, SINCE - DAY, turn(7));

  // KÖ8: two "marka dili" searches, one found nothing; another search does not count.
  ev(yazar, T0 + DAY, { type: 'memory.searched', query: 'marka dili Pastane Ada', hits: 3, mode: 'and', ms: 1 } as unknown as OfficeEvent);
  ev(yazar, T0 + DAY, { type: 'memory.searched', query: 'Marka dili Çiçekçi Zeytin', hits: 0, mode: 'none', ms: 1 } as unknown as OfficeEvent);
  ev(yazar, T0 + DAY, { type: 'memory.searched', query: 'kota', hits: 2, mode: 'and', ms: 1 } as unknown as OfficeEvent);

  // KÖ9: the owner wrote to the coordinator twice and to a member once; a system message does not count.
  ev(coord, T0 + DAY, { type: 'message.user', text: 'Merhaba', source: 'owner' });
  ev(coord, T0 + 2 * DAY, { type: 'message.user', text: 'Rapor?', source: 'owner' });
  ev(yazar, T0 + 2 * DAY, { type: 'message.user', text: 'Şunu düzelt', source: 'owner' });
  ev(yazar, T0 + 2 * DAY, { type: 'message.user', text: 'Görev', source: 'system' });

  // KÖ10: the weekly report fired 30 s after Monday 09:00; the inbox summary 45 s after Tuesday 08:30 and 120 s after
  // Wednesday's; its skip count is 1.
  t.at(T0);
  const schedules = new ScheduleStore(db, t.clock);
  const routine = (title: string, cron: string) =>
    schedules.create({ title, description: '', done: ['d'], assignee: hesap, reviewer: editor, planId: plan.id, priority: 3, difficulty: null, cron, until: null, createdBy: coord, nextRunAt: null });
  const weekly = routine('Haftalık müşteri raporu', '0 9 * * 1');
  const daily = routine('Gelen kutusu özeti', '30 8 * * 1-5');
  schedules.update(daily.id, { skipCount: 1 });
  ev(null, T0 + 30_000, { type: 'schedule.changed', change: 'fired', schedule: weekly });
  ev(null, new Date(2026, 9, 6, 8, 30).getTime() + 45_000, { type: 'schedule.changed', change: 'fired', schedule: daily });
  ev(null, new Date(2026, 9, 7, 8, 30).getTime() + 120_000, { type: 'schedule.changed', change: 'fired', schedule: daily });

  // KÖ11: H1 (weekly KPI) read once in the week; H2's weekly KPI never.
  const goals = new GoalStore(db, t.clock);
  const kpi = (name: string) => ({ name, target: 90, direction: 'atLeast' as const, unit: '%', source: 'manual' as const, metric: null, cadence: 'weekly' as const });
  const h1 = goals.create({ title: 'H1', why: 'w', done: ['d'], createdBy: coord, kpis: [kpi('Zamanında hazır oranı')] });
  goals.create({ title: 'H2', why: 'w', done: ['d'], createdBy: coord, kpis: [kpi('Zamanında haftalık rapor oranı')] });
  if (withNewTables) {
    db.prepare("INSERT INTO kpi_readings (goal_id, kpi, value, unit, target, direction, source, recorded_at, recorded_by) VALUES (?, 'Zamanında hazır oranı', 92, '%', 90, 'atLeast', 'manual', ?, ?)")
      .run(h1.id, T0 + 4 * DAY, coord);
  }
  db.close();
  return { ...t, coord, yazar, hesap };
}

const measure = (r: PilotMetrics, id: string) => r.measures.find((m) => m.id === id)!;

describe('pilot metrics (C5-5): KÖ1–KÖ11 from an office database, read-only', () => {
  it('measures a known pilot week: every KÖ’s numbers, its threshold and whether it held', () => {
    const t = pilotWeek();
    const r = pilotMetrics(t.read(), { since: SINCE, until: UNTIL });
    expect(r.measures.map((m) => m.id)).toEqual(['KÖ1', 'KÖ2', 'KÖ3', 'KÖ4', 'KÖ5', 'KÖ6', 'KÖ7', 'KÖ8', 'KÖ9', 'KÖ10', 'KÖ11']);
    const got = Object.fromEntries(r.measures.map((m) => [m.id, [m.facts, m.pass]]));
    expect(got).toEqual({
      KÖ1: [{ turns: 2, questions: 8 }, true],
      KÖ2: [{ minutes: 18, steps: 4, ownerMessages: 0 }, true],
      KÖ3: [{ hours: expect.closeTo(19.53, 1), rounds: 1 }, true],
      KÖ4: [{ done: 2, withEvidence: 1, reviewed: 2, approvedWithin2: 1, selfReviews: 0 }, false],
      KÖ5: [{ outward: 2, unapproved: 1 }, false],
      KÖ6: [{ decided: 4, accepted: 3, approvalsDecided: 1, approvalsApproved: 1 }, true],
      KÖ7: [{ turns: 5, usd: 4, turnsPerWeek: expect.closeTo(4.97, 1), usdPerWeek: expect.closeTo(3.98, 1) }, true],
      KÖ8: [{ searches: 2, empty: 1 }, null],
      KÖ9: [{ toCoordinator: 2, toMembers: 1, plans: 1, plansByCoordinator: 1 }, false],
      KÖ10: [{ fired: 3, late: 1, maxDelaySec: 120, maxSkip: 1 }, false],
      KÖ11: [{ kpis: 2, short: 1 }, false],
    });
    expect(r.measures.every((m) => m.level === 'K4')).toBe(true);
    expect(measure(r, 'KÖ5').evidence).toContain('git push');
  });

  it('KÖ3, KÖ4 and KÖ7 are read through performanceReport, KÖ7 also through quota.usage — not counted again', () => {
    const t = pilotWeek();
    const db = t.read();
    const r = pilotMetrics(db, { since: SINCE, until: UNTIL });
    const report = performanceReport(db, { since: SINCE, now: UNTIL });
    expect(measure(r, 'KÖ7').facts).toMatchObject({ turns: report.total.turns, usd: report.total.usd });
    const quota = new QuotaTracker(db, new EventStore(db), () => UNTIL);
    for (const id of [t.coord, t.yazar]) {
      const total = quota.usage(id).total;
      expect(measure(r, 'KÖ7').evidence).toContain(`${total.turns} tur / $${Math.round(total.costUsd * 100) / 100}`);
    }
    const done = report.tasks.filter((x) => x.kind === 'work' && x.status === 'done');
    expect(measure(r, 'KÖ4').facts.done).toBe(done.length);
    expect(measure(r, 'KÖ4').facts.approvedWithin2).toBe(done.filter((x) => x.approvals > 0 && x.rounds <= 2).length);
  });

  it('without the approvals table (B9a), kpi_readings (B26) and blueprints (B5) — main today — those rows say “veri yok”, nothing throws', () => {
    const t = pilotWeek(false);
    const r = pilotMetrics(t.read(), { since: SINCE, until: UNTIL });
    expect(r.tables).toEqual({ approvals: false, kpiReadings: false, blueprints: false });
    const k5 = measure(r, 'KÖ5');
    expect(k5.facts).toEqual({ outward: 2, unapproved: null });
    expect(k5.pass).toBeNull();
    expect(k5.value).toContain('veri yok');
    expect(k5.level).toBe('K4 (tespit)');
    expect(measure(r, 'KÖ6').facts).toEqual({ decided: 4, accepted: 3, approvalsDecided: null, approvalsApproved: null });
    expect(measure(r, 'KÖ6').value).toContain('onay kaydı: veri yok');
    for (const id of ['KÖ2', 'KÖ11']) {
      expect(measure(r, id).pass, id).toBeNull();
      expect(measure(r, id).value, id).toMatch(/^veri yok/);
    }
    // Measures from main's own tables are unchanged.
    expect(measure(r, 'KÖ1').facts).toEqual({ turns: 2, questions: 8 });
    expect(measure(r, 'KÖ7').pass).toBe(true);
  });

  it('an office with nothing in the window says “veri yok” where there is nothing to measure, and writes nothing', () => {
    const t = office({ pilot: false });
    t.db.close();
    const before = createHash('sha256').update(readFileSync(t.file)).digest('hex');
    const r = pilotMetrics(t.read(), { since: SINCE, until: UNTIL });
    expect(r.measures.filter((m) => m.pass === null).map((m) => m.id)).toEqual(['KÖ1', 'KÖ2', 'KÖ3', 'KÖ4', 'KÖ5', 'KÖ6', 'KÖ8', 'KÖ10', 'KÖ11']);
    expect(createHash('sha256').update(readFileSync(t.file)).digest('hex')).toBe(before);
  });

  it('the markdown: the window, which tables were there, one row per KÖ with its K level; a “|” in a cell does not break the table', () => {
    const t = pilotWeek(false);
    const text = formatPilotMetrics(pilotMetrics(t.read(), { since: SINCE, until: UNTIL }));
    expect(text).toMatch(/^# Pilot ölçümü \(KÖ1–KÖ11\)/);
    expect(text).toContain('approvals tablosu yok (B9a)');
    const rows = text.split('\n').filter((l) => /^\| KÖ\d+ \|/.test(l));
    expect(rows).toHaveLength(11);
    for (const row of rows) expect(row.split(/(?<!\\)\|/).length, row).toBe(9);
    expect(rows[4]).toMatch(/\| veri yok \| K4 \(tespit\) \|/);
  });

  it('the script reads a database file read-only and prints the table; the file is unchanged', () => {
    const t = pilotWeek();
    const before = createHash('sha256').update(readFileSync(t.file)).digest('hex');
    const run = spawnSync(process.execPath, [SCRIPT, t.file, '--since', '2026-10-05', '--until', '2026-10-12'], { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain(`Veritabanı: ${t.file} (salt okunur)`);
    expect(run.stdout.split('\n').filter((l) => /^\| KÖ\d+ \|/.test(l))).toHaveLength(11);
    expect(createHash('sha256').update(readFileSync(t.file)).digest('hex')).toBe(before);
  });
});
