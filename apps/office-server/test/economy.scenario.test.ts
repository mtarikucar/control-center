import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Employee, StoredEvent } from '@cc/shared';
import { Dispatcher, NOTICES_PREFIX } from '../src/company/dispatcher.ts';
import { DIGEST_HEADING } from '../src/company/notices.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup, tempDir, until, type TestSetup } from './helpers.ts';

/*
 * Economy scenario (plan "Ofis ekonomisi"): one simulated working day of a small office on the fake claude, counted
 * per employee — turns, the model each turn ran on and a modelled cost. It only reports; later tasks add thresholds.
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

/** The plan "Ofis ekonomisi" target: the coordinator's turns for this day (the baseline on main was 14). */
const MAX_COORDINATOR_TURNS = 5;
const TASKS = 10;
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

async function simulateDay() {
  const start = new Date(2026, 9, 7, 9, 0).getTime();
  let clock = start;
  const now = () => clock;
  const s = setup(8, now);
  const holdDir = tempDir('fake-claude-hold-');
  const f = fakeEngine(s, { env: { FAKE_CLAUDE_HOLD_DIR: holdDir } });
  const c = companyFor(s, f, undefined, now);
  const deferred: Array<() => void> = [];
  const dispatcher = new Dispatcher({
    events: s.events, roster: s.roster, tasks: c.tasks, notices: c.notices, plans: c.plans, company: c.company, engine: f.engine, budget: c.budget,
    now: () => clock, defer: (fn) => void deferred.push(fn), tickMs: 25,
  });
  cleanups.push(dispatcher.start(), f.cleanup, s.cleanup);

  const coord = c.company.hireCoordinator();
  const ada = c.company.hire(coord.id, { name: 'Ada', role: 'Geliştirici' });
  const can = c.company.hire(coord.id, { name: 'Can', role: 'Geliştirici' });
  const plan = c.company.propose(coord.id, { title: 'Sürüm 1', goal: 'On işlik bir sürüm', approach: 'İki geliştirici, beşer iş' });

  let order = 0;
  const agenda: Array<{ at: number; order: number; run: () => void }> = [];
  const at = (when: number, run: () => void) => void agenda.push({ at: when, order: order++, run });
  const held = new Set<string>();
  const release = (id: string) => {
    held.delete(id);
    writeFileSync(join(holdDir, s.roster.get(id).sessionId), '');
  };
  const deliveries = new Map<string, number>();
  const coordinatorTurns: Array<{ at: number; text: string }> = [];
  let proposalId = '';

  // What each one does in a turn, by what the turn brought (the fake claude only answers; the test plays the tools).
  const coordinatorTurn = (text: string) => {
    coordinatorTurns.push({ at: clock, text });
    if (text.includes('Plan onaylandı')) {
      for (let i = 1; i <= TASKS; i += 1) {
        const assignee = i <= TASKS / 2 ? ada.id : can.id;
        c.company.createTask(coord.id, { assignee, title: `İş ${i}`, description: `Sürümün ${i}. parçası. HOLD`, done: ['Testler yeşil'], planId: plan.id });
      }
    }
    if (text.includes('görevinde takıldı')) for (const t of c.tasks.list({ statuses: ['blocked'] })) c.company.assign(coord.id, t.id, ada.id);
    if (text.includes('proposalDecide') && proposalId) c.company.decideProposal(coord.id, proposalId, { decision: 'accept', note: 'Olur.' });
    if (text.includes('Günlük rapor zamanı')) c.company.report(coord.id, 'On iş bitti; biri takıldı ve Ada’ya geçti; bir fikir kabul edildi.');
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
        if (e.event.type !== 'message.user' || e.event.source !== 'system' || !e.employeeId) continue;
        if (e.employeeId === coord.id) coordinatorTurn(e.event.text);
        else memberTurn(s.roster.get(e.employeeId), e.event.text);
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

  // 09:00: everyone is in, the owner approves the plan.
  await until(() => [coord, ada, can].every((e) => f.engine.ready(e.id)), 10_000);
  c.company.approve(plan.id);
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

interface Row {
  name: string;
  kind: string;
  model: string;
  turns: number;
  sessions: number;
}

/** Turns per employee and model: a turn runs on the model its session reported at start (else the roster's). */
function measure(s: TestSetup, people: Employee[]): Row[] {
  const rows = new Map<string, Row>();
  const sessions = new Map<string, number>();
  const modelNow = new Map<string, string>();
  for (const e of allEvents(s)) {
    const id = e.employeeId;
    if (!id) continue;
    if (e.event.type === 'session.started') {
      sessions.set(id, (sessions.get(id) ?? 0) + 1);
      const family = familyOf(e.event.model);
      if (family) modelNow.set(id, family);
    } else if (e.event.type === 'turn.finished') {
      const who = people.find((p) => p.id === id)!;
      const model = modelNow.get(id) ?? who.model;
      const key = `${id}|${model}`;
      const row = rows.get(key) ?? { name: who.name, kind: who.kind, model, turns: 0, sessions: 0 };
      row.turns += 1;
      rows.set(key, row);
    }
  }
  return people.flatMap((p) =>
    [...rows.entries()].filter(([key]) => key.startsWith(`${p.id}|`)).map(([, row]) => ({ ...row, sessions: sessions.get(p.id) ?? 0 })),
  );
}

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
function causesOf(text: string): string {
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
  const minutes = Math.round((at - start) / MIN);
  const day = Math.floor(minutes / (24 * 60));
  const inDay = (minutes % (24 * 60)) + 9 * 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${day ? 'ertesi gün ' : ''}${pad(Math.floor(inDay / 60) % 24)}:${pad(inDay % 60)}`;
}

const HEADER = `# Ekonomi ölçümü — senaryo testi

\`apps/office-server/test/economy.scenario.test.ts\` üretir: sahte claude ile bir simüle iş günü — 1 koordinatör (fable) + 2 üye
(sonnet), 1 onaylı plan, 10 görev; bir üye bir görevde takılır (koordinatör işi diğerine verir), biri bir fikir açar (koordinatör
kabul eder), günlük rapor hatırlatması gelir (anayasa varsayılanı: özet saatleri 9 ve 17; hatırlatma 17:00 özetiyle), ertesi sabahın
özet saati de geçer. Eşik: koordinatör turu ≤ 5 (main tabanı 14). Yeniden üretmek için (repo kökünden):

    ECONOMY_MEASURE_OUT=$PWD/docs/superpowers/notes/economy-measure.md pnpm --filter @cc/office-server exec vitest run test/economy.scenario.test.ts

- Tur = \`turn.finished\` olayı. Model = turun oturumunun açılışta bildirdiği model (sahte claude \`--model\`'i bildirir), yoksa kadrodaki model.
- Modellenmiş maliyet = Σ tur × ağırlık(model); ağırlıklar fable 15, opus 5, sonnet 1, haiku 0.2. Kaba bir ölçü: bağlam boyutunu ve
  önbelleği yok sayar, her tur aynı sayılır.
- Oturum = açılan claude oturumu (\`session.started\`): boşta 30 dk kalan uyur, uyanınca yeni oturum açar (soğuk başlangıç).
`;

function report(rows: Row[], coordinatorTurns: Array<{ at: number; text: string }>, start: number): string {
  const cost = (r: Row) => r.turns * MODEL_WEIGHTS[r.model as Family];
  const kind: Record<string, string> = { coordinator: 'koordinatör', lead: 'lider', member: 'üye' };
  const n = (x: number) => String(Math.round(x * 10) / 10);
  const lines = [
    '| Çalışan | Rol | Model | Tur | Oturum | Ağırlık | Modellenmiş maliyet |',
    '|---|---|---|---:|---:|---:|---:|',
    ...rows.map((r) => `| ${r.name} | ${kind[r.kind] ?? r.kind} | ${r.model} | ${r.turns} | ${r.sessions} | ${n(MODEL_WEIGHTS[r.model as Family])} | ${n(cost(r))} |`),
    `| **Toplam** | | | **${rows.reduce((a, r) => a + r.turns, 0)}** | | | **${n(rows.reduce((a, r) => a + cost(r), 0))}** |`,
    '',
    'Koordinatöre tur açan olaylar (simüle saat):',
    '',
    '| # | Saat | Neden |',
    '|---:|---|---|',
    ...coordinatorTurns.map((t, i) => `| ${i + 1} | ${clockText(t.at, start)} | ${causesOf(t.text)} |`),
  ];
  return lines.join('\n');
}

describe('economy scenario', () => {
  it('a simulated day: turns, models and modelled cost per employee (reports only)', async () => {
    const { s, c, start, coordinatorTurns, people } = await simulateDay();

    const tasks = c.tasks.list({ limit: 100 });
    expect(tasks).toHaveLength(TASKS);
    expect(tasks.every((t) => t.status === 'done')).toBe(true);
    const events = allEvents(s);
    expect(events.filter((e) => e.event.type === 'company.report')).toHaveLength(1);
    expect(events.some((e) => e.event.type === 'proposal.changed' && e.event.change === 'accepted')).toBe(true);
    // One system message, one turn: nothing was queued behind a running turn.
    const systemMessages = events.filter((e) => e.event.type === 'message.user' && e.event.source === 'system').length;
    expect(events.filter((e) => e.event.type === 'turn.finished')).toHaveLength(systemMessages);

    const rows = measure(s, people);
    expect(rows.map((r) => r.name)).toEqual(['Koordinatör', 'Ada', 'Can']);
    // Members take one turn per task they get (Ada 5 + the one taken from Can, Can 5): notices ride along.
    expect(rows.map((r) => r.turns).slice(1)).toEqual([6, 5]);
    const table = report(rows, coordinatorTurns, start);
    console.log(`\nEkonomi senaryosu — bir simüle gün\n\n${table}\n`);
    const out = process.env.ECONOMY_MEASURE_OUT;
    if (out) {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, `${HEADER}\n${table}\n`);
    }
    expect(rows[0]!.turns).toBeLessThanOrEqual(MAX_COORDINATOR_TURNS);
  }, 60_000);
});
