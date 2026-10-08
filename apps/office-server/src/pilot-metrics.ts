import type { DatabaseSync } from 'node:sqlite';
import { toolClass } from './company/capabilities.ts';
import { formatStamp, nextCron, parseCron } from './company/time.ts';
import { EventStore } from './event-store.ts';
import { performanceReport, type PerformanceReport } from './performance.ts';
import { QuotaTracker } from './quota.ts';

/**
 * The pilot's acceptance measures (pilot-senaryosu §7, KÖ1–KÖ11; pilot-hazirlik-analizi §3.1 C5-5), read from an office
 * database and nothing else: the events, the tasks, the routines, the goals and — where they exist — the tables of
 * branches not live yet (blueprints B5, kpi_readings B26, approvals B9a). A table that is not there makes its measure
 * “veri yok”, never an error. Reads only: the caller may open the database read-only.
 */

export const PILOT_MEASURES = ['KÖ1', 'KÖ2', 'KÖ3', 'KÖ4', 'KÖ5', 'KÖ6', 'KÖ7', 'KÖ8', 'KÖ9', 'KÖ10', 'KÖ11'] as const;
export type PilotMeasureId = (typeof PILOT_MEASURES)[number];

export interface PilotMeasure {
  id: PilotMeasureId;
  title: string;
  /** The threshold as pilot-senaryosu §7 writes it. */
  threshold: string;
  /** What was measured, in a sentence. */
  value: string;
  /** null: no data to judge by (a table missing, nothing in the window, or not measurable from the log). */
  pass: boolean | null;
  /** The evidence level of the data (K4 for an office's own database); “(tespit)”: detected, not blocked. */
  level: string;
  /** Where the numbers come from. */
  evidence: string;
  /** The numbers, for tests and other readers; null where there is no data. */
  facts: Record<string, number | null>;
}

export interface PilotMetrics {
  since: number;
  until: number;
  level: string;
  /** Which tables of branches not on main yet the database has. */
  tables: { approvals: boolean; kpiReadings: boolean; blueprints: boolean };
  measures: PilotMeasure[];
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;
const pct = (part: number, whole: number) => `%${Math.round((part / whole) * 100)}`;
const money = (n: number) => `$${round(n)}`;
/**
 * The pilot §7 name pattern for an outward MCP tool (publish, send, schedule): only when B7's vocabulary cannot be read —
 * it misses reply, forward, create_event and every other outward tool whose name says otherwise.
 */
const OUTWARD_TOOL = /publish|send|schedule/i;
/** A shell command that goes outward (pilot §7 KÖ5), at the head of a command: git push, curl -X POST. */
const OUTWARD_SHELL = /^(?:git\s+(?:-C\s+\S+\s+)?push\b|curl\b.*(?:-X\s*POST|--request\s+POST)\b)/i;

/**
 * The commands a shell line runs, roughly: heredoc bodies and quoted text are data, not commands (a grep pattern or a
 * script naming “git push” runs nothing), except the quoted command given to bash -c / sh -c / eval; then split at
 * ;, &&, ||, | and newlines, with leading variable assignments, sudo, command and exec dropped.
 */
function shellCommands(line: string, depth = 0): string[] {
  const given = depth > 0 ? [] : [...line.matchAll(/\b(?:(?:ba|z)?sh\s+-c|eval)\s+(['"])([\s\S]*?)\1/g)].flatMap((m) => shellCommands(m[2] ?? '', depth + 1));
  const bare = line
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g, ' ')
    .replace(/'[^']*'/g, ' ')
    .replace(/"(?:[^"\\]|\\.)*"/g, ' ');
  const own = bare.split(/&&|\|\||[;|\n]/).map((c) => c.trim().replace(/^(?:\w+=\S*\s+)*(?:(?:sudo|command|exec)\s+)?/, '')).filter(Boolean);
  return [...own, ...given];
}

/**
 * Whether a tool call goes outward (KÖ5): a shell push or POST; an MCP tool as B7 reads it — a capability that goes
 * outward, or no capability at all (the vocabulary is an allow-list); the office's own tools and Claude Code's built-ins
 * never. `classify` is B7's toolClass; if it cannot read the vocabulary, the pilot §7 name pattern stands in.
 */
export function outwardCall(name: string, input: unknown, classify: (name: string) => { outward?: boolean } = toolClass): boolean {
  if (name === 'Bash') return shellCommands(String((input as { command?: unknown } | null)?.command ?? '')).some((c) => OUTWARD_SHELL.test(c));
  if (!name.startsWith('mcp__') || name.startsWith('mcp__office__')) return false;
  try {
    return classify(name).outward === true;
  } catch {
    return OUTWARD_TOOL.test(name.split('__').at(-1) ?? '');
  }
}

interface EventRow {
  seq: number;
  employeeId: string | null;
  ts: number;
  // The payload as stored: some types (memory.searched) come from branches whose event union main does not know.
  event: Record<string, any>;
}

export function pilotMetrics(db: DatabaseSync, o: { since: number; until: number; level?: string }): PilotMetrics {
  const { since, until } = o;
  const level = o.level ?? 'K4';
  const has = (table: string) => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
  const tables = { approvals: has('approvals'), kpiReadings: has('kpi_readings'), blueprints: has('blueprints') };
  const events = (...types: string[]): EventRow[] =>
    (db
      .prepare(`SELECT seq, employee_id, ts, payload FROM events WHERE type IN (${types.map(() => '?').join(', ')}) AND ts >= ? AND ts <= ? ORDER BY seq`)
      .all(...types, since, until) as unknown as Array<{ seq: number; employee_id: string | null; ts: number; payload: string }>).map((r) => ({
      seq: r.seq, employeeId: r.employee_id, ts: r.ts, event: JSON.parse(r.payload) as Record<string, any>,
    }));
  const people = db.prepare('SELECT id, name, kind FROM employees').all() as unknown as Array<{ id: string; name: string; kind: string }>;
  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.name ?? id ?? 'ofis';
  const coordinators = new Set(people.filter((p) => p.kind === 'coordinator').map((p) => p.id));
  const ownerMessages = events('message.user').filter((e) => e.event.source === 'owner');
  // performanceReport windows by its start; the window's end is its "now".
  const report = performanceReport(db, { since, now: until });

  const m = (id: PilotMeasureId, title: string, threshold: string, r: Omit<PilotMeasure, 'id' | 'title' | 'threshold' | 'level'> & { level?: string }): PilotMeasure => ({
    id, title, threshold, value: r.value, pass: r.pass, level: r.level ?? level, evidence: r.evidence, facts: r.facts,
  });
  const none = (id: PilotMeasureId, title: string, threshold: string, why: string, facts: Record<string, number | null>, evidence = '—'): PilotMeasure =>
    m(id, title, threshold, { value: `veri yok: ${why}`, pass: null, evidence, facts });

  // ── KÖ1 onboarding ─────────────────────────────────────────────────────────
  const ko1 = (): PilotMeasure => {
    const T = 'Onboarding';
    const TH = '≤ 2 koordinatör turu, ≤ 10 soru; eksik bölüm varsayım işaretli';
    const changes = events('onboarding.changed');
    const started = changes.find((e) => e.event.change === 'started');
    const finished = started && changes.find((e) => e.event.change === 'finished' && e.event.onboarding?.id === started.event.onboarding?.id);
    if (!started) return none('KÖ1', T, TH, 'pencerede onboarding başlamadı', { turns: null, questions: null });
    if (!finished) return none('KÖ1', T, TH, `onboarding #${started.seq}'de başladı, pencerede bitmedi`, { turns: null, questions: null });
    const turns = events('turn.finished').filter((e) => e.employeeId !== null && coordinators.has(e.employeeId) && e.ts > started.ts && e.ts <= finished.ts).length;
    const rounds = (finished.event.onboarding?.rounds ?? []) as Array<{ questions: string[]; replied: boolean }>;
    const questions = rounds.filter((r) => r.replied).reduce((n, r) => n + r.questions.length, 0);
    const assumed = (db
      .prepare('SELECT p.section FROM company_profile p JOIN (SELECT section, MAX(version) AS v FROM company_profile GROUP BY section) l ON p.section = l.section AND p.version = l.v WHERE p.assumed = 1')
      .all() as unknown as Array<{ section: string }>).map((r) => r.section);
    return m('KÖ1', T, TH, {
      value: `${turns} koordinatör turu, ${questions} soru`, pass: turns <= 2 && questions <= 10, facts: { turns, questions },
      evidence: `onboarding.changed #${started.seq} başladı → #${finished.seq} bitti; arada koordinatörün turn.finished olayları; ${rounds.length} soru turu; varsayım işaretli bölümler: ${assumed.length ? assumed.join(', ') : 'yok'}`,
    });
  };

  // ── KÖ2 install time ───────────────────────────────────────────────────────
  let installEnd: number | null = null;
  const ko2 = (): PilotMeasure => {
    const T = 'Kurulum süresi';
    const TH = 'onaydan son kurulum adımına ≤ 30 dk; kurucu müdahalesi yalnız onay';
    const facts = { minutes: null, steps: null, ownerMessages: null };
    if (!tables.blueprints) return none('KÖ2', T, TH, 'blueprints tablosu yok (B5, core-3)', facts);
    const plans = new Set((db.prepare('SELECT plan_id FROM blueprints').all() as unknown as Array<{ plan_id: string }>).map((r) => r.plan_id));
    const approved = events('plan.changed').find((e) => e.event.change === 'approved' && plans.has(e.event.plan?.id));
    if (!approved) return none('KÖ2', T, TH, 'pencerede onaylanan kurulum planı yok', facts);
    const planId = approved.event.plan.id as string;
    const steps = db.prepare('SELECT MAX(at) AS last, COUNT(*) AS n FROM blueprint_steps WHERE plan_id = ? AND at >= ?').get(planId, approved.ts) as unknown as { last: number | null; n: number };
    if (steps.last === null) return none('KÖ2', T, TH, `“${approved.event.plan.title}” onaylandı (#${approved.seq}), kurulum adımı yok`, facts);
    installEnd = steps.last;
    const minutes = round((steps.last - approved.ts) / MIN, 1);
    const owner = ownerMessages.filter((e) => e.ts >= approved.ts && e.ts <= steps.last!).length;
    return m('KÖ2', T, TH, {
      value: `${minutes} dk, ${steps.n} adım; arada kurucu mesajı ${owner}`, pass: minutes <= 30 && owner === 0, facts: { minutes, steps: steps.n, ownerMessages: owner },
      evidence: `plan.changed approved #${approved.seq} (“${approved.event.plan.title}”) → blueprint_steps son adım ${formatStamp(steps.last)}; message.user source=owner`,
    });
  };

  // ── KÖ3 first hand-in ──────────────────────────────────────────────────────
  const workRows = new Map(
    (db.prepare("SELECT id, done, result, reviewer, assignee, finished_at FROM tasks WHERE kind = 'work'").all() as unknown as Array<{
      id: string; done: string; result: string | null; reviewer: string | null; assignee: string; finished_at: number | null;
    }>).map((r) => [r.id, r]),
  );
  const doneWork = report.tasks.filter((t) => t.kind === 'work' && t.status === 'done');
  const ko3 = (): PilotMeasure => {
    const T = 'İlk teslim süresi';
    const TH = 'kurulumdan ≤ 48 saatte incelemeden geçmiş ilk iş (≤ 2 tur)';
    const start = installEnd ?? since;
    const first = doneWork
      .map((t) => ({ t, row: workRows.get(t.id)! }))
      .filter(({ row }) => row.reviewer !== null && row.finished_at !== null && row.finished_at >= start)
      .sort((a, b) => a.row.finished_at! - b.row.finished_at!)[0];
    if (!first) return none('KÖ3', T, TH, 'kurulumdan sonra incelemeden geçmiş iş yok', { hours: null, rounds: null });
    const hours = round((first.row.finished_at! - start) / HOUR);
    return m('KÖ3', T, TH, {
      value: `${hours} saat, ${first.t.rounds} inceleme turu`, pass: hours <= 48 && first.t.rounds <= 2, facts: { hours, rounds: first.t.rounds },
      evidence: `“${first.t.title}” (${first.t.id}); başlangıç ${installEnd === null ? 'pencere başı (kurulum ölçülmedi)' : 'kurulumun son adımı'}; performanceReport turları`,
    });
  };

  // ── KÖ4 proof and review discipline ───────────────────────────────────────
  const ko4 = (): PilotMeasure => {
    const T = 'Kanıt ve inceleme disiplini';
    const TH = 'kanıt %100; inceleyicili işlerin ≥ %80’i ≤ 2 turda onay; kendi incelemesi 0';
    const self = (db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM tasks WHERE reviewer IS NOT NULL AND reviewer = assignee AND created_at BETWEEN ? AND ?)
              + (SELECT COUNT(*) FROM tasks r JOIN tasks w ON r.review_of = w.id WHERE r.kind = 'review' AND r.assignee = w.assignee AND r.created_at BETWEEN ? AND ?) AS n`,
      )
      .get(since, until, since, until) as unknown as { n: number }).n;
    if (doneWork.length === 0) return none('KÖ4', T, TH, 'pencerede biten iş yok', { done: 0, withEvidence: null, reviewed: null, approvedWithin2: null, selfReviews: self });
    const withEvidence = doneWork.filter((t) => {
      const row = workRows.get(t.id)!;
      const evidence = (row.result ? (JSON.parse(row.result) as { evidence?: string[] }).evidence : undefined) ?? [];
      return evidence.length >= (JSON.parse(row.done) as string[]).length;
    }).length;
    const reviewed = doneWork.filter((t) => workRows.get(t.id)!.reviewer !== null);
    const within2 = reviewed.filter((t) => t.approvals > 0 && t.rounds <= 2).length;
    const pass = withEvidence === doneWork.length && (reviewed.length === 0 || within2 / reviewed.length >= 0.8) && self === 0;
    return m('KÖ4', T, TH, {
      value: `kanıt tam ${withEvidence}/${doneWork.length}; ≤ 2 turda onay ${within2}/${reviewed.length}; kendi incelemesi ${self}`, pass,
      facts: { done: doneWork.length, withEvidence, reviewed: reviewed.length, approvedWithin2: within2, selfReviews: self },
      evidence: 'performanceReport görevleri (tur, onay); tasks.result.evidence ve tasks.done; inceleyen = yapan',
    });
  };

  // ── KÖ5 publishing gate ────────────────────────────────────────────────────
  const ko5 = (): PilotMeasure => {
    const T = 'Yayın kapısı';
    const TH = 'onaysız dışa dönük çağrı = 0; her yayın için onay kaydı';
    const outward = events('tool.started').filter((e) => e.employeeId !== null && outwardCall(String(e.event.name ?? ''), e.event.input));
    const what = (e: EventRow) => `#${e.seq} ${nameOf(e.employeeId)}: ${e.event.name === 'Bash' ? `Bash “${String(e.event.input?.command).slice(0, 60)}”` : e.event.name}`;
    const listed = outward.length ? `; ${outward.slice(0, 5).map(what).join(' · ')}${outward.length > 5 ? ' …' : ''}` : '';
    if (!tables.approvals) {
      return m('KÖ5', T, TH, {
        value: `${outward.length} dışa dönük çağrı tespit edildi; onay kaydı: veri yok (approvals tablosu yok, B9a)`, pass: null, level: `${level} (tespit)`,
        facts: { outward: outward.length, unapproved: null }, evidence: `tool.started: B7'de dışa dönük ya da sınıflandırılmamış bağlayıcı aracı, Bash (git push, curl -X POST)${listed}`,
      });
    }
    const approvedFor = db.prepare(
      "SELECT 1 FROM approvals WHERE employee_id = ? AND tool = ? AND status IN ('approved', 'used') AND decided_at <= ? AND (expires_at IS NULL OR expires_at >= ?) LIMIT 1",
    );
    const unapproved = outward.filter((e) => approvedFor.get(e.employeeId, e.event.name, e.ts, e.ts) === undefined);
    return m('KÖ5', T, TH, {
      value: `${outward.length} dışa dönük çağrı, ${unapproved.length}’i onaysız`, pass: unapproved.length === 0, facts: { outward: outward.length, unapproved: unapproved.length },
      evidence: `tool.started (B7'de dışa dönük ya da sınıflandırılmamış; Bash git push, curl -X POST) + approvals (approved/used, çağrıdan önce)${unapproved.length ? `; onaysız: ${unapproved.slice(0, 5).map(what).join(' · ')}` : listed}`,
    });
  };

  // ── KÖ6 the owner's approval rate ──────────────────────────────────────────
  const ko6 = (): PilotMeasure => {
    const T = 'Kurucunun onay oranı';
    const TH = 'ilk sunumda onay ≥ %70';
    const proposals = db
      .prepare("SELECT status FROM proposals WHERE decided_by = 'owner' AND decided_at BETWEEN ? AND ? AND status IN ('accepted', 'declined')")
      .all(since, until) as unknown as Array<{ status: string }>;
    const accepted = proposals.filter((p) => p.status === 'accepted').length;
    let approvalsDecided: number | null = null;
    let approvalsApproved: number | null = null;
    if (tables.approvals) {
      const rows = db
        .prepare("SELECT status FROM approvals WHERE decided_by = 'owner' AND decided_at BETWEEN ? AND ? AND status IN ('approved', 'used', 'denied')")
        .all(since, until) as unknown as Array<{ status: string }>;
      approvalsDecided = rows.length;
      approvalsApproved = rows.filter((r) => r.status !== 'denied').length;
    }
    const decided = proposals.length + (approvalsDecided ?? 0);
    const yes = accepted + (approvalsApproved ?? 0);
    const parts = [
      `öneri: ${accepted}/${proposals.length} kabul${proposals.length ? ` (${pct(accepted, proposals.length)})` : ''}`,
      approvalsDecided === null ? 'onay kaydı: veri yok (approvals tablosu yok, B9a)' : `onay kaydı: ${approvalsApproved}/${approvalsDecided} onay`,
    ];
    return m('KÖ6', T, TH, {
      value: parts.join('; '), pass: decided === 0 ? null : yes / decided >= 0.7, facts: { decided: proposals.length, accepted, approvalsDecided, approvalsApproved },
      evidence: "proposals decided_by='owner' (Pilot 0); approvals decided_by='owner' (Pilot 1)",
    });
  };

  // ── KÖ7 cost ───────────────────────────────────────────────────────────────
  const ko7 = (): PilotMeasure => {
    const T = 'Maliyet';
    const TH = 'haftada ≤ 150 tur ve ≤ $60';
    const weeks = (until - since) / WEEK;
    const windowDays = round((until - since) / DAY);
    const { turns, usd } = report.total;
    const turnsPerWeek = round(turns / weeks);
    const usdPerWeek = round(usd / weeks);
    // Shorter than a week: the weekly figure is only an estimate; it fails only once the raw numbers already do.
    const short = windowDays < 7;
    const quota = new QuotaTracker(db, new EventStore(db), () => until);
    const totals = report.employees.filter((e) => e.turns > 0).map((e) => {
      const all = quota.usage(e.id).total;
      return `${e.name}: ${all.turns} tur / ${money(all.costUsd)}`;
    });
    return m('KÖ7', T, TH, {
      value: short
        ? `${turns} tur, ${money(usd)} (pencere ${windowDays} gün; haftalık tahmini ${turnsPerWeek} tur, ${money(usdPerWeek)})`
        : `${turns} tur, ${money(usd)} (haftalık: ${turnsPerWeek} tur, ${money(usdPerWeek)})`,
      pass: short ? (turns > 150 || usd > 60 ? false : null) : turnsPerWeek <= 150 && usdPerWeek <= 60,
      facts: { turns, usd, windowDays, turnsPerWeek, usdPerWeek },
      evidence: `performanceReport (turn.finished, pencere); quota.usage tüm zamanlar: ${totals.length ? totals.join(', ') : 'tur yok'}; sahibinin payı (≤ 2 saat/hafta) bu betikte ölçülmedi`,
    });
  };

  // ── KÖ8 memory findability ─────────────────────────────────────────────────
  const ko8 = (): PilotMeasure => {
    const T = 'Hafıza bulunurluğu';
    const TH = '“marka dili <müşteri>” 6/6 ilk 3’te';
    const facts = { searches: null, empty: null };
    if (db.prepare("SELECT 1 FROM events WHERE type = 'memory.searched' LIMIT 1").get() === undefined) {
      return none('KÖ8', T, TH, 'memory.searched olayı yok (B11 canlı değil)', facts);
    }
    const brand = events('memory.searched').filter((e) => /marka\s+dili/i.test(String(e.event.query ?? '')));
    if (brand.length === 0) return none('KÖ8', T, TH, 'pencerede “marka dili” araması yok', facts);
    const empty = brand.filter((e) => e.event.hits === 0).length;
    return m('KÖ8', T, TH, {
      value: `“marka dili” araması ${brand.length}, boş dönen ${empty}; sıra olay kaydında yok`, pass: null, facts: { searches: brand.length, empty },
      evidence: 'memory.searched (query, hits); ilk 3 sırası K2’de ölçülür: test/pilot-ajans-search.test.ts',
    });
  };

  // ── KÖ9 autonomy ───────────────────────────────────────────────────────────
  const ko9 = (): PilotMeasure => {
    const T = 'Otonomi';
    const TH = 'kurucudan üyelere 0, koordinatöre ≤ 5 mesaj; planları koordinatör başlatır';
    const toCoordinator = ownerMessages.filter((e) => e.employeeId !== null && coordinators.has(e.employeeId)).length;
    const toMembers = ownerMessages.length - toCoordinator;
    const plans = db.prepare('SELECT proposed_by FROM plans WHERE created_at BETWEEN ? AND ?').all(since, until) as unknown as Array<{ proposed_by: string }>;
    const byCoordinator = plans.filter((p) => coordinators.has(p.proposed_by)).length;
    return m('KÖ9', T, TH, {
      value: `kurucudan koordinatöre ${toCoordinator}, üyelere ${toMembers} mesaj; plan ${byCoordinator}/${plans.length} koordinatörden`,
      pass: toMembers === 0 && toCoordinator <= 5 && byCoordinator === plans.length, facts: { toCoordinator, toMembers, plans: plans.length, plansByCoordinator: byCoordinator },
      evidence: "message.user source='owner' (alıcının türüne göre); plans.proposed_by",
    });
  };

  // ── KÖ10 routine reliability ───────────────────────────────────────────────
  const ko10 = (): PilotMeasure => {
    const T = 'Rutin güvenilirliği';
    const TH = 'her tetiklenme ±60 sn; skipCount ≤ 1';
    const fired = events('schedule.changed').filter((e) => e.event.change === 'fired' && typeof e.event.schedule?.cron === 'string');
    if (fired.length === 0) return none('KÖ10', T, TH, 'pencerede tetiklenen rutin yok', { fired: 0, late: null, maxDelaySec: null, maxSkip: null });
    const delays = fired.map((e) => {
      const spec = parseCron(e.event.schedule.cron);
      // The occurrence it fired for: the latest at or before it.
      let due: number | null = null;
      for (let at = nextCron(spec, e.ts - 32 * DAY); at <= e.ts; at = nextCron(spec, at)) due = at;
      return due === null ? null : round((e.ts - due) / 1000, 0);
    });
    const known = delays.filter((d): d is number => d !== null);
    const late = known.filter((d) => d > 60).length;
    const ids = [...new Set(fired.map((e) => String(e.event.schedule.id)))];
    const skips = (db.prepare(`SELECT MAX(skip_count) AS n FROM schedules WHERE id IN (${ids.map(() => '?').join(', ')})`).get(...ids) as unknown as { n: number | null }).n ?? 0;
    const maxDelay = known.length ? Math.max(...known) : null;
    return m('KÖ10', T, TH, {
      value: `${fired.length} tetiklenme, ${late}’i 60 sn’den geç (en geç ${maxDelay} sn); en çok atlanan ${skips}`, pass: late === 0 && skips <= 1,
      facts: { fired: fired.length, late, maxDelaySec: maxDelay, maxSkip: skips },
      evidence: 'schedule.changed fired zamanı − cron’un o anki vakti; schedules.skip_count',
    });
  };

  // ── KÖ11 the KPI loop ──────────────────────────────────────────────────────
  const ko11 = (): PilotMeasure => {
    const T = 'KPI döngüsü';
    const TH = 'H1/H2 KPI’ları tanımlı; haftada en az bir okuma';
    if (!tables.kpiReadings) return none('KÖ11', T, TH, 'kpi_readings tablosu yok (B26)', { kpis: null, short: null });
    const days = (until - since) / DAY;
    // Readings a KPI owes in the window; a weekly one owes none to a window shorter than a week.
    const needed = (cadence: string) => (cadence === 'daily' ? Math.floor(days) : cadence === 'monthly' ? (days >= 28 ? Math.max(1, Math.floor(days / 30)) : 0) : Math.floor(days / 7));
    const goals = db.prepare("SELECT id, title, kpis FROM goals WHERE status = 'active'").all() as unknown as Array<{ id: string; title: string; kpis: string }>;
    const kpis = goals.flatMap((g) => (JSON.parse(g.kpis) as Array<{ name: string; cadence: string }>).map((k) => ({ goal: g, ...k })));
    const count = db.prepare('SELECT COUNT(*) AS n FROM kpi_readings WHERE goal_id = ? AND kpi = ? AND recorded_at BETWEEN ? AND ?');
    const short = kpis.filter((k) => (count.get(k.goal.id, k.name, since, until) as unknown as { n: number }).n < needed(k.cadence));
    const owed = kpis.some((k) => needed(k.cadence) > 0);
    if (kpis.length > 0 && !owed) {
      return m('KÖ11', T, TH, {
        value: `${kpis.length} KPI; pencere ${round(days)} gün, haftalık okuma bu pencerede ölçülmedi`, pass: null, facts: { kpis: kpis.length, short: null },
        evidence: 'goals.kpis (etkin); pencere bir haftadan kısa: haftalık ve aylık KPI bu pencerede okuma borçlu değil',
      });
    }
    return m('KÖ11', T, TH, {
      value: kpis.length === 0 ? 'KPI tanımlı etkin hedef yok' : `${kpis.length} KPI, ${short.length}’i pencerede yeterince okunmadı`,
      pass: kpis.length > 0 && short.length === 0, facts: { kpis: kpis.length, short: short.length },
      evidence: `goals.kpis (etkin) ve kpi_readings.recorded_at${short.length ? `; eksik: ${short.map((k) => `${k.goal.title} / ${k.name}`).join(' · ')}` : ''}; retro KPI tablosu bu betikte ölçülmedi`,
    });
  };

  // KÖ2 before KÖ3: the first hand-in counts from the install's end.
  const measures = [ko1(), ko2(), ko3(), ko4(), ko5(), ko6(), ko7(), ko8(), ko9(), ko10(), ko11()];
  return { since, until, level, tables, measures };
}

const cell = (s: string) => s.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|');
const RESULT = (pass: boolean | null) => (pass === null ? 'veri yok' : pass ? '✓' : '✗');

/** The table as markdown: the window, the tables found, one row per measure. */
export function formatPilotMetrics(r: PilotMetrics): string {
  const t = r.tables;
  const found = [
    t.approvals ? 'approvals var' : 'approvals tablosu yok (B9a)',
    t.kpiReadings ? 'kpi_readings var' : 'kpi_readings tablosu yok (B26)',
    t.blueprints ? 'blueprints var' : 'blueprints tablosu yok (B5)',
  ];
  const held = r.measures.filter((m) => m.pass === true).length;
  const failed = r.measures.filter((m) => m.pass === false).length;
  return [
    '# Pilot ölçümü (KÖ1–KÖ11)',
    '',
    `Pencere: ${formatStamp(r.since)} – ${formatStamp(r.until)} · veri seviyesi ${r.level} · ${found.join('; ')}`,
    `Sonuç: ${held} tuttu, ${failed} tutmadı, ${r.measures.length - held - failed} veri yok`,
    '',
    '| No | Ölçüt | Değer | Eşik | Sonuç | K | Kanıt |',
    '|---|---|---|---|---|---|---|',
    ...r.measures.map((m) => `| ${m.id} | ${cell(m.title)} | ${cell(m.value)} | ${cell(m.threshold)} | ${RESULT(m.pass)} | ${cell(m.level)} | ${cell(m.evidence)} |`),
  ].join('\n');
}
