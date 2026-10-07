import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Employee, StoredEvent } from '@cc/shared';
import { Dispatcher, NOTICES_PREFIX } from '../src/company/dispatcher.ts';
import { DIGEST_HEADING } from '../src/company/notices.ts';
import { companyFor, METHOD } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup, tempDir, until, type TestSetup } from './helpers.ts';

/*
 * Economy scenario (plan "Ofis ekonomisi"): one simulated working day of a small office on the fake claude, counted
 * per employee — turns, the model each turn ran on and a modelled cost. Two runs:
 * - every switch off (the default): the day must be main's, turn for turn and message for message — compared with the
 *   baseline note's tables and with the messages and events recorded by this same test on main (the golden file);
 * - the economy on (all three switches): the plan's thresholds.
 *
 * Deterministic by construction: the dispatcher's clock and its deferred work belong to the test. Time jumps from one
 * event to the next (a discrete-event simulation) and after each event the office runs until it rests. A member's
 * task is one long turn: the fake claude holds it open (HOLD) until the test hands the task in at its simulated time,
 * so the member is really working meanwhile and idle-sleep times are the real ones. Digest hours are local wall-clock
 * hours, so every store runs on the simulated clock, from 09:00 on a fixed day.
 *
 * ECONOMY_MEASURE_OUT=<file> also writes the tables there as Markdown.
 */

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** Rough cost of one turn per model, sonnet = 1. It ignores context size and caching: a turn is a turn. */
const MODEL_WEIGHTS = { fable: 15, opus: 5, sonnet: 1, haiku: 0.2 } as const;
type Family = keyof typeof MODEL_WEIGHTS;
const familyOf = (model: string): Family | null => (Object.keys(MODEL_WEIGHTS) as Family[]).find((f) => model.toLowerCase().includes(f)) ?? null;
const RANK: Record<Family, number> = { haiku: 0, sonnet: 1, opus: 2, fable: 3 };

const NOTES = fileURLToPath(new URL('../../../docs/superpowers/notes/', import.meta.url));
/** The baseline measured on main (e2889e8): its tables, and the messages and events of the same day recorded on main. */
const BASELINE_NOTE = join(NOTES, '2026-10-07-economy-baseline.md');
const BASELINE_LOG = join(NOTES, '2026-10-07-economy-baseline.log.json');

/** The plan "Ofis ekonomisi" targets: the coordinator's turns for this day, and its modelled cost at most 30 % of main's (measured on e2889e8). */
const MAX_COORDINATOR_TURNS = 5;
const BASELINE_COORDINATOR_COST = 225;
const MAX_COORDINATOR_COST_SHARE = 0.3;
const TASKS = 10;
/** İş 1–5 go to Ada, 6–10 to Can: 6 easy, 3 medium, 1 hard. */
const DIFFICULTIES = ['easy', 'medium', 'easy', 'hard', 'easy', 'easy', 'medium', 'easy', 'medium', 'easy'] as const;
const TASK_MINUTES = { Ada: 50, Can: 47 } as const;
/** Can is stuck this far into their second task; Ada opens a proposal this far into her third. */
const STUCK_AFTER = 20;
const PROPOSAL_AFTER = 20;
/** The office ticks every minute; the simulation sweeps every 5 simulated minutes of the working day. */
const SWEEP_EVERY = 5;
const WORKDAY_MINUTES = 9 * 60;

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function allEvents(s: TestSetup): StoredEvent[] {
  const out: StoredEvent[] = [];
  for (let page = s.events.list({ limit: 5000 }); page.length; page = s.events.list({ after: page[page.length - 1]!.seq, limit: 5000 })) out.push(...page);
  return out;
}

/**
 * `economy`: the three switches on, the owner asks for the plan at 08:45 (on the owner model, as the API sends it) and
 * the tasks have a difficulty. Off: the day as the baseline on main — 09:00, the plan proposed and approved.
 */
async function simulateDay(cfg: { economy: boolean }) {
  const start = new Date(2026, 9, 7, cfg.economy ? 8 : 9, cfg.economy ? 45 : 0).getTime();
  let clock = start;
  const now = () => clock;
  const s = setup(8, now);
  const holdDir = tempDir('fake-claude-hold-');
  const f = fakeEngine(s, { env: { FAKE_CLAUDE_HOLD_DIR: holdDir }, engine: { now, modelPolicyEnabled: () => c.budget.constitution().modelPolicyEnabled } });
  const c = companyFor(s, f, undefined, now);
  if (cfg.economy) c.budget.setConstitution({ digestEnabled: true, modelPolicyEnabled: true, difficultyModelsEnabled: true });
  const deferred: Array<() => void> = [];
  const dispatcher = new Dispatcher({
    events: s.events, roster: s.roster, tasks: c.tasks, notices: c.notices, plans: c.plans, company: c.company, engine: f.engine, budget: c.budget,
    now: () => clock, defer: (fn) => void deferred.push(fn), tickMs: 25,
  });
  cleanups.push(dispatcher.start(), f.cleanup, s.cleanup);

  const coord = c.company.hireCoordinator();
  const ada = c.company.hire(coord.id, { name: 'Ada', role: 'Geliştirici' });
  const can = c.company.hire(coord.id, { name: 'Can', role: 'Geliştirici' });
  const propose = () => c.company.propose(coord.id, { method: METHOD, title: 'Sürüm 1', goal: 'On işlik bir sürüm', approach: 'İki geliştirici, beşer iş' }).id;
  let planId = cfg.economy ? '' : propose();

  let order = 0;
  const agenda: Array<{ at: number; order: number; run: () => void }> = [];
  const at = (when: number, run: () => void) => void agenda.push({ at: when, order: order++, run });
  const held = new Set<string>();
  const release = (id: string) => {
    held.delete(id);
    writeFileSync(join(holdDir, s.roster.get(id).sessionId), '');
  };
  const deliveries = new Map<string, number>();
  const coordinatorTurns: Array<{ at: number; text: string; source: 'owner' | 'system' }> = [];
  let proposalId = '';

  // What each one does in a turn, by what the turn brought (the fake claude only answers; the test plays the tools).
  const coordinatorTurn = (text: string, source: 'owner' | 'system') => {
    coordinatorTurns.push({ at: clock, text, source });
    if (source === 'owner') {
      planId = propose();
      at(start + 15 * MIN, () => c.company.approve(planId));
    }
    if (text.includes('Plan onaylandı')) {
      for (let i = 1; i <= TASKS; i += 1) {
        const assignee = i <= TASKS / 2 ? ada.id : can.id;
        c.company.createTask(coord.id, {
          assignee, title: `İş ${i}`, description: `Sürümün ${i}. parçası. HOLD`, done: ['Testler yeşil'], planId, difficulty: cfg.economy ? DIFFICULTIES[i - 1] : undefined,
        });
      }
    }
    if (text.includes('görevinde takıldı')) for (const t of c.tasks.list({ statuses: ['blocked'] })) c.company.assign(coord.id, t.id, ada.id);
    if (text.includes('proposalDecide') && proposalId) c.company.decideProposal(coord.id, proposalId, { decision: 'accept', note: 'Olur.' });
    // The reminder's wording: with the digest it is a line of the digest, without it the notice it was on main.
    if (/Günlük (rapor|özet) zamanı/.test(text)) c.company.report(coord.id, 'On iş bitti; biri takıldı ve Ada’ya geçti; bir fikir kabul edildi.');
  };
  const memberTurn = (e: Employee, text: string) => {
    const taskId = /Görev no: (\S+)/.exec(text)?.[1];
    if (!taskId) return; // notices only: read them, nothing to do
    held.add(e.id);
    const n = (deliveries.get(e.id) ?? 0) + 1;
    deliveries.set(e.id, n);
    if (e.id === can.id && n === 2) {
      at(clock + STUCK_AFTER * MIN, () => {
        c.company.update(e.id, taskId, { blocked: true, note: 'Test ortamına erişimim yok.' });
        release(e.id);
      });
      return;
    }
    if (e.id === ada.id && n === 3) {
      at(clock + PROPOSAL_AFTER * MIN, () => {
        proposalId = c.company.openProposal(e.id, { kind: 'idea', title: 'Ortak test verisi', text: 'Her iş kendi verisini kuruyor; bir ortak set zaman kazandırır.' }).id;
      });
    }
    at(clock + TASK_MINUTES[e.name as keyof typeof TASK_MINUTES] * MIN, () => {
      c.company.finish(e.id, taskId, { summary: 'Bitti, testler yeşil.', outputs: [], learned: '' });
      release(e.id);
    });
  };

  let seen = 0;
  const react = () => {
    for (let page = s.events.list({ after: seen, limit: 5000 }); page.length; page = s.events.list({ after: seen, limit: 5000 })) {
      for (const e of page) {
        seen = e.seq;
        if (e.event.type !== 'message.user' || !e.employeeId) continue;
        if (e.employeeId === coord.id) coordinatorTurn(e.event.text, e.event.source);
        else if (e.event.source === 'system') memberTurn(s.roster.get(e.employeeId), e.event.text);
      }
    }
  };
  const resting = () => {
    react();
    return s.roster.list().every((e) => e.lifecycle === 'sleeping' || held.has(e.id) || f.engine.ready(e.id));
  };
  /** Runs the dispatcher's deferred work until the office rests: no turn running, nothing new happening. */
  const settle = async () => {
    for (let round = 0; round < 500; round += 1) {
      await until(resting, 10_000);
      const before = s.events.lastSeq();
      for (const fn of deferred.splice(0)) fn();
      await pause(10);
      if (s.events.lastSeq() === before && resting()) return;
    }
    throw new Error('the office never came to rest');
  };
  const sweepAt = async (when: number) => {
    clock = when;
    deferred.push(() => dispatcher.sweep());
    await settle();
  };

  await until(() => [coord, ada, can].every((e) => f.engine.ready(e.id)), 10_000);
  if (cfg.economy) {
    // 08:45: the owner asks the coordinator for a plan; the API's hint: the owner model, never below the coordinator's own.
    const owner = c.budget.constitution().coordinatorModels.owner as Family;
    f.engine.send(coord.id, 'Sürüm 1 için on işlik bir plan öner.', 'owner', { model: RANK[owner] > RANK[coord.model as Family] ? owner : coord.model });
  } else c.company.approve(planId);
  await sweepAt(start);
  for (let m = SWEEP_EVERY; m <= WORKDAY_MINUTES; m += SWEEP_EVERY) at(start + m * MIN, () => undefined);
  while (agenda.length) {
    agenda.sort((x, y) => x.at - y.at || x.order - y.order);
    const next = agenda.shift()!;
    clock = next.at;
    next.run();
    await sweepAt(next.at);
  }
  // The next morning's digest hour: nothing is waiting, so nobody gets a turn. (The dispatcher's own tick runs too.)
  clock = start + DAY + MIN;
  await pause(100);
  await sweepAt(clock);

  return { s, c, start, coordinatorTurns, people: [coord, ada, can] };
}

const uuids = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/**
 * What the day said and did, comparable across runs: every message (ids masked), and each one's events in order.
 * (Events of different people interleave as their processes answer; each one's own sequence is fixed.)
 */
function logOf(s: TestSetup, people: Employee[]) {
  const who = (id: string | null) => people.find((p) => p.id === id)?.name ?? '-';
  const all = allEvents(s);
  const events: Record<string, string[]> = {};
  for (const e of all) (events[who(e.employeeId)] ??= []).push(e.event.type);
  return {
    messages: all.flatMap((e) => (e.event.type === 'message.user' ? [`${who(e.employeeId)} · ${e.event.source} · ${e.event.text.replace(uuids, '<id>')}`] : [])),
    events,
  };
}

/** The data rows of the first Markdown table after `heading` in `text`. */
function tableAfter(text: string, heading: string): string[] {
  const lines = text.split('\n');
  const from = lines.findIndex((l) => l.startsWith(heading));
  const rows: string[] = [];
  for (const line of lines.slice(from + 1)) {
    if (line.startsWith('|')) rows.push(line.trim());
    else if (rows.length) break;
  }
  return rows.slice(2);
}

interface Turn {
  employeeId: string;
  /** The model the turn's session reported at start (else the roster's). */
  model: string;
  /** The message that opened the turn. */
  opener: string;
}

interface Row {
  name: string;
  kind: string;
  model: string;
  turns: number;
  /** Sessions started on this model (a model switch or a wake starts one). */
  sessions: number;
}

/** Every turn with its model and the message that opened it (one message, one turn: the test checks it). */
function turnsOf(s: TestSetup, people: Employee[]): { turns: Turn[]; sessions: Map<string, number> } {
  const turns: Turn[] = [];
  const sessions = new Map<string, number>();
  const modelNow = new Map<string, string>();
  const openers = new Map<string, string[]>();
  for (const e of allEvents(s)) {
    const id = e.employeeId;
    if (!id) continue;
    if (e.event.type === 'session.started') {
      const model = familyOf(e.event.model) ?? people.find((p) => p.id === id)!.model;
      modelNow.set(id, model);
      sessions.set(`${id}|${model}`, (sessions.get(`${id}|${model}`) ?? 0) + 1);
    } else if (e.event.type === 'message.user') openers.set(id, [...(openers.get(id) ?? []), e.event.text]);
    else if (e.event.type === 'turn.finished') {
      turns.push({ employeeId: id, model: modelNow.get(id) ?? people.find((p) => p.id === id)!.model, opener: openers.get(id)?.shift() ?? '' });
    }
  }
  return { turns, sessions };
}

/** Turns per employee and model, strongest model first. */
function rowsOf(turns: Turn[], sessions: Map<string, number>, people: Employee[]): Row[] {
  return people.flatMap((p) =>
    (Object.keys(MODEL_WEIGHTS) as Family[])
      .map((model) => ({ name: p.name, kind: p.kind, model, turns: turns.filter((t) => t.employeeId === p.id && t.model === model).length, sessions: sessions.get(`${p.id}|${model}`) ?? 0 }))
      .filter((r) => r.turns > 0),
  );
}

const costOf = (rows: Row[]) => rows.reduce((sum, r) => sum + r.turns * MODEL_WEIGHTS[r.model as Family], 0);

/** Decision notices that open a coordinator turn (on main every notice did, hand-ins and the plan's end too). */
const CAUSES: Array<[string, string]> = [
  ['Plan onaylandı', 'plan onayı'],
  ['Görev bitti', 'teslim'],
  ['görevinde takıldı', 'takılma'],
  ['proposalDecide', 'öneri'],
  ['Günlük özet zamanı', 'rapor hatırlatması'],
  ['açık görevi kalmadı', 'plan bitti'],
  ['teslim etmedi', 'hatırlatmaya rağmen açık iş'],
];

/** Why a coordinator turn came: its decision notices, and what its digest carried (groups and the report reminder). */
function causesOf(text: string, source: 'owner' | 'system'): string {
  if (source === 'owner') return 'sahibinin mesajı';
  const blockEnd = text.indexOf('\n\n');
  const decisions = text.startsWith(NOTICES_PREFIX) ? text.slice(0, blockEnd < 0 ? undefined : blockEnd).split('\n') : [];
  const found = decisions.flatMap((line) => CAUSES.filter(([needle]) => line.includes(needle)).map(([, cause]) => cause));
  const digest = text.indexOf(DIGEST_HEADING);
  if (digest >= 0) {
    const part = text.slice(digest);
    const groups = [...part.matchAll(/^(.+) \((\d+)\):$/gm)].map((m) => `${m[1]} ${m[2]}`);
    found.push(`özet${groups.length ? ` (${groups.join(', ')})` : ''}`);
    if (part.includes('Günlük rapor zamanı')) found.push('rapor hatırlatması');
  }
  return found.length ? found.join(' + ') : 'diğer';
}

function clockText(at: number, start: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.toDateString() === new Date(start).toDateString() ? '' : 'ertesi gün '}${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const HEADER = `# Ekonomi ölçümü — senaryo testi

\`apps/office-server/test/economy.scenario.test.ts\` üretir: sahte claude ile bir simüle iş günü — 1 koordinatör (fable) + 2 üye
(sonnet). 08:45'te sahibi koordinatörden plan ister, 09:00'da onaylar; 10 görev (6 kolay, 3 orta, 1 zor); bir üye bir görevde
takılır (koordinatör işi diğerine verir), biri bir fikir açar (koordinatör kabul eder), günlük rapor hatırlatması gelir
(anayasa varsayılanı: özet saatleri 9 ve 17; hatırlatma 17:00 özetiyle), ertesi sabahın özet saati de geçer. Eşikler:
koordinatör turu ≤ 5; koordinatörün modellenmiş maliyeti main tabanının (225) en çok %30'u; hiçbir görev zorluğunun
modelinden güçlü bir modelde koşmaz. Yeniden üretmek için (repo kökünden):

    ECONOMY_MEASURE_OUT=$PWD/docs/superpowers/notes/economy-measure.md pnpm --filter @cc/office-server exec vitest run test/economy.scenario.test.ts

- Tur = \`turn.finished\` olayı. Model = turun oturumunun açılışta bildirdiği model (sahte claude \`--model\`'i bildirir), yoksa kadrodaki model.
- Modellenmiş maliyet = Σ tur × ağırlık(model); ağırlıklar fable 15, opus 5, sonnet 1, haiku 0.2. Kaba bir ölçü: bağlam boyutunu ve
  önbelleği yok sayar, her tur aynı sayılır.
- Oturum = o modelde açılan claude oturumu (\`session.started\`): uyanış ya da model değişimi yeni oturum açar (soğuk başlangıç).
`;

/** The table per employee and model, and why each coordinator turn came, on which model (`coordinatorModels`, in order). */
type CoordinatorTurn = { at: number; text: string; source: 'owner' | 'system' };

/** Turns, sessions and modelled cost per employee and model, with the total (the baseline note's table). */
function employeeTable(rows: Row[]): string[] {
  const cost = (r: Row) => r.turns * MODEL_WEIGHTS[r.model as Family];
  const kind: Record<string, string> = { coordinator: 'koordinatör', lead: 'lider', member: 'üye' };
  const n = (x: number) => String(Math.round(x * 10) / 10);
  return [
    '| Çalışan | Rol | Model | Tur | Oturum | Ağırlık | Modellenmiş maliyet |',
    '|---|---|---|---:|---:|---:|---:|',
    ...rows.map((r) => `| ${r.name} | ${kind[r.kind] ?? r.kind} | ${r.model} | ${r.turns} | ${r.sessions} | ${n(MODEL_WEIGHTS[r.model as Family])} | ${n(cost(r))} |`),
    `| **Toplam** | | | **${rows.reduce((a, r) => a + r.turns, 0)}** | | | **${n(rows.reduce((a, r) => a + cost(r), 0))}** |`,
  ];
}

/** Why each coordinator turn came, when; with `models`, on which model too. */
function timelineTable(coordinatorTurns: CoordinatorTurn[], start: number, models?: string[]): string[] {
  return [
    models ? '| # | Saat | Neden | Model |' : '| # | Saat | Neden |',
    models ? '|---:|---|---|---|' : '|---:|---|---|',
    ...coordinatorTurns.map((t, i) => `| ${i + 1} | ${clockText(t.at, start)} | ${causesOf(t.text, t.source)} |${models ? ` ${models[i] ?? '?'} |` : ''}`),
  ];
}

function report(rows: Row[], coordinatorModels: string[], coordinatorTurns: CoordinatorTurn[], start: number): string {
  return [...employeeTable(rows), '', 'Koordinatöre tur açan olaylar (simüle saat):', '', ...timelineTable(coordinatorTurns, start, coordinatorModels)].join('\n');
}

describe('economy scenario', () => {
  it('R10: with every switch off the day is main’s — the baseline note’s tables, and main’s messages and events one by one', async () => {
    const { s, start, coordinatorTurns, people } = await simulateDay({ economy: false });
    const log = logOf(s, people);
    // ECONOMY_GOLDEN_OUT=<file>: write the log (how the golden was recorded on main).
    if (process.env.ECONOMY_GOLDEN_OUT) writeFileSync(process.env.ECONOMY_GOLDEN_OUT, `${JSON.stringify(log, null, 1)}\n`);
    const { turns, sessions } = turnsOf(s, people);
    const table = employeeTable(rowsOf(turns, sessions, people));
    const timeline = timelineTable(coordinatorTurns, start);
    console.log(`\nEkonomi senaryosu — anahtarlar kapalı\n\n${[...table, '', ...timeline].join('\n')}\n`);
    const baseline = readFileSync(BASELINE_NOTE, 'utf8');
    expect(table.slice(2)).toEqual(tableAfter(baseline, '## Taban (main, 2026-10-07)'));
    expect(timeline.slice(2)).toEqual(tableAfter(baseline, 'Zaman çizelgesi'));
    const golden = JSON.parse(readFileSync(BASELINE_LOG, 'utf8')) as ReturnType<typeof logOf>;
    expect(log.messages).toEqual(golden.messages);
    expect(log.events).toEqual(golden.events);
  }, 60_000);

  it('the economy on: turns, models and modelled cost per employee, within the plan’s thresholds', async () => {
    const { s, c, start, coordinatorTurns, people } = await simulateDay({ economy: true });

    const tasks = c.tasks.list({ limit: 100 });
    expect(tasks).toHaveLength(TASKS);
    expect(tasks.every((t) => t.status === 'done')).toBe(true);
    const events = allEvents(s);
    expect(events.filter((e) => e.event.type === 'company.report')).toHaveLength(1);
    expect(events.some((e) => e.event.type === 'proposal.changed' && e.event.change === 'accepted')).toBe(true);
    // One message, one turn: nothing was queued behind a running turn.
    expect(events.filter((e) => e.event.type === 'turn.finished')).toHaveLength(events.filter((e) => e.event.type === 'message.user').length);

    const { turns, sessions } = turnsOf(s, people);
    const [coord, ...members] = people;
    // Members take one turn per task they get (Ada 5 + the one taken from Can, Can 5): notices ride along.
    expect(members.map((m) => turns.filter((t) => t.employeeId === m.id).length)).toEqual([6, 5]);
    const rows = rowsOf(turns, sessions, people);
    const table = report(rows, turns.filter((t) => t.employeeId === coord!.id).map((t) => t.model), coordinatorTurns, start);
    console.log(`\nEkonomi senaryosu — bir simüle gün\n\n${table}\n`);
    const out = process.env.ECONOMY_MEASURE_OUT;
    if (out) {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, `${HEADER}\n${table}\n`);
    }
    const coordinatorRows = rows.filter((r) => r.kind === 'coordinator');
    expect(turns.filter((t) => t.employeeId === coord!.id)).toHaveLength(coordinatorTurns.length);
    expect(coordinatorTurns.length).toBeLessThanOrEqual(MAX_COORDINATOR_TURNS);
    expect(costOf(coordinatorRows)).toBeLessThanOrEqual(BASELINE_COORDINATOR_COST * MAX_COORDINATOR_COST_SHARE);
    // No task runs on a model above its difficulty's.
    const difficultyModels = c.budget.constitution().difficultyModels;
    const taskTurns = turns.flatMap((t) => {
      const id = /Görev no: (\S+)/.exec(t.opener)?.[1];
      return id ? [{ ...t, task: c.tasks.get(id) }] : [];
    });
    expect(taskTurns).toHaveLength(11);
    for (const t of taskTurns) {
      expect(MODEL_WEIGHTS[t.model as Family], `${t.task.title} (${t.task.difficulty})`).toBeLessThanOrEqual(MODEL_WEIGHTS[difficultyModels[t.task.difficulty!]]);
    }
  }, 60_000);
});
