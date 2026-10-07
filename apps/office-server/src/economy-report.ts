import type { DatabaseSync } from 'node:sqlite';
import { NOTICES_PREFIX, NUDGE_PREFIX } from './company/dispatcher.ts';
import { DIGEST_HEADING } from './company/notices.ts';
import { CONTINUE_AFTER_CRASH, CONTINUE_AFTER_LIMIT } from './engine.ts';

/**
 * The economy plan's live measures (acceptance R1–R6), read from an office database without writing to it: turns,
 * money and tokens per employee and per hand-in, why the coordinator's turns came, models, how fast notices reach their
 * reader and how many wait, and the quality signals (stuck and requeued tasks, plan durations). Works on databases from
 * before the plan (no notice kinds, no task difficulty) too.
 */

export interface Window {
  since: number;
  until: number;
}

export interface Usage {
  turns: number;
  sideAnswers: number;
  usd: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export interface EconomyReport {
  window: Window;
  schemaVersion: number;
  handIns: number;
  /** `models`: turns per model, from the model the CLI announced for the turn (system init; the real CLI sends it every turn). */
  employees: Array<{ id: string; name: string; kind: string; model: string; usage: Usage; models: Record<string, number> }>;
  total: Usage;
  coordinator: { turns: number; usd: number; causes: Record<string, number>; noticeLines: Record<string, number> } | null;
  /** `coordinatorTurnsNotOwner`: the acceptance R1 measure — the owner's own messages are not the plan's to reduce. */
  perHandIn: { turns: number | null; coordinatorTurns: number | null; coordinatorTurnsNotOwner: number | null; coordinatorUsd: number | null; usd: number | null; tokens: number | null };
  quality: { started: number; blocked: number; blockedRate: number | null; requeued: number; plansReopened: number; planHours: number[] };
  /** Minutes from written to delivered; `whileFree`: only notices written while their reader was not in a turn (R3). */
  latency: Record<'decision' | 'info', { count: number; p50: number | null; p95: number | null; whileFree: { count: number; p95: number | null } }>;
  pending: Record<'decision' | 'info', { count: number; oldestMinutes: number | null }>;
  /** The engine's own reports (error events): messages it could not deliver or dropped, and model switches that failed. */
  incidents: { lostMessages: number; failedSwitches: number };
}

interface EventRow {
  seq: number;
  employee_id: string | null;
  ts: number;
  type: string;
  payload: string;
}

const zero = (): Usage => ({ turns: 0, sideAnswers: 0, usd: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });

const FAMILIES = ['fable', 'opus', 'sonnet', 'haiku'];
const familyOf = (model: string) => FAMILIES.find((f) => model.toLowerCase().includes(f)) ?? model;

/** What opened a coordinator turn, from the message that started it. */
export function causeOf(text: string, source: string): string {
  if (source === 'owner') return 'sahibinin mesajı';
  if (text.startsWith(NOTICES_PREFIX)) return 'karar notu';
  if (text.startsWith('## Görev:')) return 'görev';
  if (text.startsWith(NUDGE_PREFIX)) return 'hatırlatma';
  if (text.startsWith(DIGEST_HEADING)) return 'özet';
  if (text === CONTINUE_AFTER_CRASH || text === CONTINUE_AFTER_LIMIT) return 'devam (çökme/limit)';
  return 'diğer';
}

/** What a notice line in a coordinator turn was about (before the plan every notice was one of these lines). */
export function noticeLineOf(line: string): string {
  if (/Görev bitti|^- “.+” \(.+\): /.test(line)) return 'teslim';
  if (/takıldı/.test(line)) return 'takılma';
  if (/teslim etmedi/.test(line)) return 'duran iş';
  if (/Plan onaylandı|planı onaylamadı|revizyonunu onaylamadı|açık görevi kalmadı/.test(line)) return 'plan';
  if (/öneri|talebi|proposalDecide/i.test(line)) return 'öneri';
  if (/Günlük (özet|rapor) zamanı/.test(line)) return 'rapor hatırlatması';
  if (/kota payı/.test(line)) return 'sahibinin payı';
  return 'diğer';
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

const columns = (db: DatabaseSync, table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

export function economyReport(db: DatabaseSync, w: Window): EconomyReport {
  const schemaVersion = (db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null }).v ?? 0;
  const people = db.prepare('SELECT id, name, kind, model FROM employees ORDER BY created_at').all() as Array<{ id: string; name: string; kind: string; model: string }>;
  const coordinatorIds = new Set(people.filter((p) => p.kind === 'coordinator').map((p) => p.id));
  // Everything before the window too: a turn's model comes from its session's start, which may be earlier.
  const events = db.prepare('SELECT seq, employee_id, ts, type, payload FROM events WHERE ts < ? ORDER BY seq').all(w.until) as unknown as EventRow[];

  const usage = new Map<string, Usage>();
  const models = new Map<string, Record<string, number>>();
  const modelNow = new Map<string, string>();
  const lastMessage = new Map<string, { text: string; source: string }>();
  const causes: Record<string, number> = {};
  const noticeLines: Record<string, number> = {};
  let coordinatorTurns = 0;
  let coordinatorUsd = 0;
  const started = new Set<string>();
  const startedEver = new Set<string>();
  const blocked = new Set<string>();
  const requeued = new Set<string>();
  let plansReopened = 0;
  const incidents = { lostMessages: 0, failedSwitches: 0 };
  const planHours: number[] = [];
  const inWindow = (ts: number) => ts >= w.since && ts < w.until;
  /** Each employee's lifecycle changes in time order, to tell whether they were in a turn when a notice was written. */
  const lifecycles = new Map<string, Array<{ ts: number; to: string }>>();

  for (const row of events) {
    const id = row.employee_id;
    const ev = JSON.parse(row.payload) as Record<string, unknown> & { type: string };
    if (ev.type === 'lifecycle.changed' && id) lifecycles.set(id, [...(lifecycles.get(id) ?? []), { ts: row.ts, to: String(ev.to) }]);
    if (ev.type === 'session.started' && id) {
      modelNow.set(id, familyOf(String(ev.model ?? '')));
    } else if (ev.type === 'message.user' && id) {
      lastMessage.set(id, { text: String(ev.text ?? ''), source: String(ev.source ?? '') });
    } else if (ev.type === 'turn.started' && id && coordinatorIds.has(id) && inWindow(row.ts)) {
      const opener = lastMessage.get(id) ?? { text: '', source: '' };
      const cause = causeOf(opener.text, opener.source);
      causes[cause] = (causes[cause] ?? 0) + 1;
      if (cause === 'karar notu') {
        const lines = opener.text.split('\n\n')[0]!.split('\n').slice(1);
        for (const line of lines) noticeLines[noticeLineOf(line)] = (noticeLines[noticeLineOf(line)] ?? 0) + 1;
      }
    } else if ((ev.type === 'turn.finished' || ev.type === 'side.answer') && id && inWindow(row.ts)) {
      const u = usage.get(id) ?? zero();
      const t = (ev.usage ?? {}) as Record<string, number>;
      if (ev.type === 'turn.finished') u.turns += 1;
      else u.sideAnswers += 1;
      u.usd += Number(ev.costUsd ?? 0);
      u.input += t.inputTokens ?? 0;
      u.output += t.outputTokens ?? 0;
      u.cacheRead += t.cacheReadTokens ?? 0;
      u.cacheCreation += t.cacheCreationTokens ?? 0;
      usage.set(id, u);
      if (ev.type === 'turn.finished') {
        const model = modelNow.get(id) ?? people.find((p) => p.id === id)?.model ?? '?';
        const m = models.get(id) ?? {};
        m[model] = (m[model] ?? 0) + 1;
        models.set(id, m);
        if (coordinatorIds.has(id)) {
          coordinatorTurns += 1;
          coordinatorUsd += Number(ev.costUsd ?? 0);
        }
      }
    } else if (ev.type === 'task.changed') {
      const task = ev.task as { id: string; status: string; approvedAt?: number };
      if (ev.change === 'started') startedEver.add(task.id);
      if (!inWindow(row.ts)) continue;
      if (ev.change === 'started') started.add(task.id);
      if (task.status === 'blocked') blocked.add(task.id);
      // Back in a queue after it had started: given to someone else or put back.
      if (task.status === 'waiting' && startedEver.has(task.id) && (ev.change === 'assigned' || ev.change === 'updated')) requeued.add(task.id);
    } else if (ev.type === 'error' && inWindow(row.ts)) {
      const message = String(ev.message ?? '');
      if (/teslim edilemedi|iptal edildi|yeniden gönderilemedi/.test(message)) incidents.lostMessages += 1;
      if (/modelinde açılamadı/.test(message)) incidents.failedSwitches += 1;
    } else if (ev.type === 'plan.changed' && inWindow(row.ts)) {
      const plan = ev.plan as { approvedAt: number | null };
      if (ev.change === 'reopened') plansReopened += 1;
      if (ev.change === 'done' && plan.approvedAt) planHours.push((row.ts - plan.approvedAt) / 3_600_000);
    }
  }

  const handIns = (db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status = 'done' AND finished_at >= ? AND finished_at < ?").get(w.since, w.until) as { n: number }).n;
  const total = zero();
  for (const u of usage.values()) for (const k of Object.keys(total) as Array<keyof Usage>) total[k] += u[k];
  const per = (n: number) => (handIns > 0 ? n / handIns : null);

  const kinds = columns(db, 'notices').includes('kind');
  const kindOf = kinds ? 'kind' : "'decision'";
  const latency = {} as EconomyReport['latency'];
  const working = (id: string, at: number) => {
    let state = '';
    for (const c of lifecycles.get(id) ?? []) if (c.ts <= at) state = c.to;
    return state === 'working';
  };
  const pending = { decision: { count: 0, oldestMinutes: null }, info: { count: 0, oldestMinutes: null } } as EconomyReport['pending'];
  for (const kind of ['decision', 'info'] as const) {
    const rows = db
      .prepare(`SELECT employee_id AS id, created_at AS at, delivered_at - created_at AS ms FROM notices WHERE ${kindOf} = ? AND delivered_at >= ? AND delivered_at < ?`)
      .all(kind, w.since, w.until) as Array<{ id: string; at: number; ms: number }>;
    const delivered = rows.map((r) => r.ms / 60_000);
    const free = rows.filter((r) => !working(r.id, r.at)).map((r) => r.ms / 60_000);
    latency[kind] = { count: delivered.length, p50: percentile(delivered, 50), p95: percentile(delivered, 95), whileFree: { count: free.length, p95: percentile(free, 95) } };
    const waiting = db
      .prepare(`SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM notices WHERE ${kindOf} = ? AND created_at < ? AND (delivered_at IS NULL OR delivered_at >= ?)`)
      .get(kind, w.until, w.until) as { n: number; oldest: number | null };
    pending[kind] = { count: waiting.n, oldestMinutes: waiting.oldest === null ? null : (w.until - waiting.oldest) / 60_000 };
  }

  return {
    window: w,
    schemaVersion,
    handIns,
    employees: people.map((p) => ({ ...p, usage: usage.get(p.id) ?? zero(), models: models.get(p.id) ?? {} })),
    total,
    coordinator: coordinatorIds.size ? { turns: coordinatorTurns, usd: coordinatorUsd, causes, noticeLines } : null,
    perHandIn: {
      turns: per(total.turns),
      coordinatorTurns: per(coordinatorTurns),
      coordinatorTurnsNotOwner: per(coordinatorTurns - (causes['sahibinin mesajı'] ?? 0)),
      coordinatorUsd: per(coordinatorUsd),
      usd: per(total.usd),
      tokens: per(total.input + total.output + total.cacheRead + total.cacheCreation),
    },
    quality: { started: started.size, blocked: blocked.size, blockedRate: started.size ? blocked.size / started.size : null, requeued: requeued.size, plansReopened, planHours },
    latency,
    pending,
    incidents,
  };
}

const num = (n: number | null, digits = 2) => (n === null ? '—' : String(Math.round(n * 10 ** digits) / 10 ** digits));
const pad = (n: number) => String(n).padStart(2, '0');
const when = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const counts = (r: Record<string, number>) =>
  Object.entries(r)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ') || '—';

export function formatReport(r: EconomyReport): string {
  const tokens = (u: Usage) => u.input + u.output + u.cacheRead + u.cacheCreation;
  const lines = [
    `Pencere: ${when(r.window.since)} – ${when(r.window.until)} · şema sürümü ${r.schemaVersion}`,
    `Örneklem: ${r.handIns} teslim, ${r.total.turns} tur, ${r.employees.filter((e) => e.usage.turns > 0).length} çalışan.`,
    '',
    '| Çalışan | Rol | Tur | Yan cevap | USD | Token (giriş/çıkış/önbellek okuma/yazma) | Modeller (tur) |',
    '|---|---|---:|---:|---:|---|---|',
    ...r.employees
      .filter((e) => e.usage.turns > 0 || e.usage.sideAnswers > 0)
      .map((e) => `| ${e.name} | ${e.kind} | ${e.usage.turns} | ${e.usage.sideAnswers} | ${num(e.usage.usd)} | ${e.usage.input}/${e.usage.output}/${e.usage.cacheRead}/${e.usage.cacheCreation} | ${counts(e.models)} |`),
    `| **Toplam** | | **${r.total.turns}** | ${r.total.sideAnswers} | **${num(r.total.usd)}** | ${tokens(r.total)} | |`,
    '',
    `Teslim başına: ${num(r.perHandIn.turns)} tur · koordinatör ${num(r.perHandIn.coordinatorTurns)} tur (sahibinin mesajları hariç ${num(r.perHandIn.coordinatorTurnsNotOwner)}) · koordinatör $${num(r.perHandIn.coordinatorUsd)} · toplam $${num(r.perHandIn.usd)} · ${num(r.perHandIn.tokens, 0)} token.`,
  ];
  if (r.coordinator) {
    lines.push(
      `Koordinatör: ${r.coordinator.turns} tur, $${num(r.coordinator.usd)}. Turu açan: ${counts(r.coordinator.causes)}.`,
      `Koordinatör turlarındaki karar notu satırları: ${counts(r.coordinator.noticeLines)}.`,
    );
  }
  lines.push(
    `Kalite: başlayan ${r.quality.started} görev, takılan ${r.quality.blocked} (oran ${num(r.quality.blockedRate)}), kuyruğa dönen ${r.quality.requeued}, yeniden açılan plan ${r.quality.plansReopened}, biten plan süresi (saat) ${r.quality.planHours.map((h) => num(h, 1)).join(', ') || '—'}.`,
    `Not gecikmesi (oluşma → tura girme, dk): karar ${r.latency.decision.count} not, p50 ${num(r.latency.decision.p50, 1)}, p95 ${num(r.latency.decision.p95, 1)}; alıcı turda değilken yazılan ${r.latency.decision.whileFree.count} not, p95 ${num(r.latency.decision.whileFree.p95, 1)} · bilgi ${r.latency.info.count} not, p50 ${num(r.latency.info.p50, 1)}, p95 ${num(r.latency.info.p95, 1)}.`,
    `Pencere sonunda bekleyen not: karar ${r.pending.decision.count} (en eski ${num(r.pending.decision.oldestMinutes, 0)} dk) · bilgi ${r.pending.info.count} (en eski ${num(r.pending.info.oldestMinutes, 0)} dk).`,
    `Olaylar: kaybolan/iptal mesaj bildirimi ${r.incidents.lostMessages} · başarısız model geçişi ${r.incidents.failedSwitches}.`,
  );
  if (r.schemaVersion < 6) lines.push('', 'Şema 6 öncesi: not türü yok, bütün notlar karar sayıldı.');
  return lines.join('\n');
}

/** "2026-10-07" is local midnight; anything else as Date reads it. */
export function parseWhen(value: string): number {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const ms = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).getTime() : new Date(value).getTime();
  if (Number.isNaN(ms)) throw new Error(`Tarih anlaşılmadı: ${value}`);
  return ms;
}
