import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Employee, StoredEvent } from '@cc/shared';
import { DISALLOWED_TOOLS, gateHookCommand, sessionArgs } from '../src/claude/args.ts';
import { sessionDeny } from '../src/company/session-deny.ts';
import { deskDir } from '../src/desk.ts';
import { formatPilotMetrics, pilotMetrics } from '../src/pilot-metrics.ts';
import { METHOD } from './company-helpers.ts';
import { tempDir, until } from './helpers.ts';
import { pageHeaders } from './owner-helpers.ts';
import { COST_CAP_USD, PILOT_MODEL, PILOT_STUBS, STEP_TIMEOUT_MS, pilotCommand, pilotOffice, spentUsd, type PilotOffice } from './pilot-harness.ts';
import { LOCKED_TOOLS } from './real-session.ts';

/**
 * C5-4: the pilot end to end with the real claude CLI (pilot readiness §4, steps 1–8), on the C5-3 package
 * (fixtures/pilot-ajans/blueprint.json; PILOT_BLUEPRINT may point at another copy). Locked as pilot-harness.ts fixes it
 * (K1: pilot-bounds.test.ts): every session haiku, --strict-mcp-config with only the office and the test's two stubs,
 * outward built-ins gone, a throwaway data directory, ≤ $0.50. Synthetic data only; nothing is sent anywhere.
 *
 * Two cuts against cost, written in the record too: the package's first tasks are not installed (the coordinator opens
 * the one step 5 needs, from the package's text), and the members are stopped before the routines fire (step 6 checks
 * the firing, not the work). Step 6 runs last: moving the clock days ahead must not touch steps 7–8.
 * The management cycle runs as live: the coordinator gets its board between the steps (a plan approved, a hand-in, a
 * review, the clock moved), so a word to it waits for that turn to end; the record lists every cycle.
 * SMOKE_OUT=<file> writes the record (steps, KÖ, C5-5's table of KÖ1–KÖ11 on this run's database, cost, cycles, sessions,
 * journal); PILOT_DB_OUT=<file> keeps a copy of that database (synthetic only) to run scripts/pilot-metrics.ts on again.
 * PILOT_SPENT_BEFORE_USD: what earlier runs of the task spent; the ceiling counts it.
 */
const enabled = process.env.OFFICE_SMOKE === '1';
const PACKAGE = process.env.PILOT_BLUEPRINT ?? fileURLToPath(new URL('./fixtures/pilot-ajans/blueprint.json', import.meta.url));
const SPENT_BEFORE = Number(process.env.PILOT_SPENT_BEFORE_USD ?? '0');

const FOUNDER = 'Altı müşterili küçük bir sosyal medya ajansıyız (sentetik: Kıyı Ajans). Müşterilerimiz için haftalık içerik takvimi, gönderi metinleri ve aylık rapor hazırlıyoruz; yayın ve gönderimi ben yapıyorum.';
/** The founder's answers (scripted, synthetic), by onboarding question id. */
const ANSWERS: Record<string, unknown> = {
  name: 'Kıyı Ajans (sentetik)',
  sector: 'sosyal medya ajansı',
  products: ['haftalık içerik takvimi', 'gönderi metinleri', 'aylık müşteri raporu'],
  segments: ['altı küçük işletme müşterisi: pastane, diş kliniği, yoga stüdyosu, kahve durağı, butik otel, çiçekçi (hepsi uydurma)'],
  channels: ['Instagram', 'LinkedIn', 'tavsiye'],
  goals: ['altı müşterinin haftalık takvimi her Cuma 17:00’ye kadar hazır', 'aylık raporlar ayın 3. iş gününe kadar'],
  success: ['takvim ve raporlar zamanında, kurucunun onayıyla'],
  tools: { email: ['Gmail'], social: ['Instagram', 'LinkedIn'], payment: ['yok'], accounting: ['yok'], ecommerce: ['yok'], other: ['Canva'] },
  budget: 'aylık 60 USD',
  limits: ['yayın, gönderim ve harcama yalnız kurucunun onayıyla'],
  pricing: 'müşteri başına aylık sabit ücret',
  platforms: ['Instagram', 'LinkedIn'],
  brandVoice: 'her müşterinin kendi marka dili el kitabında',
  legal: ['KVKK'],
  timezone: 'Europe/Istanbul',
  country: 'Türkiye',
  languages: ['Türkçe'],
  kpis: ['zamanında hazır oranı', 'ilk geçişte onay oranı'],
};

interface StepRecord {
  step: string;
  kö: string;
  usd: number;
  turns: number;
  seconds: number;
  checks: string[];
  error?: string;
}

describe.skipIf(!enabled)('pilot end to end with the real claude CLI (C5-4; locked, haiku, throwaway data, ≤ $0.50)', () => {
  it('steps 1–8: onboarding, the blueprint installed, closed mode on the desks, a reviewed task, KPI and retro, memory search, a routine firing', { timeout: 3_600_000 }, async () => {
    if (!existsSync(PACKAGE)) throw new Error(`C5-3 paketi yok: ${PACKAGE} (PILOT_BLUEPRINT ile başka bir kopya verilebilir).`);
    const pkg = JSON.parse(readFileSync(PACKAGE, 'utf8')) as {
      roles: Array<{ key: string; name: string }>; playbook: unknown[]; goals: Array<{ key: string; title: string; kpis?: Array<{ name: string }> }>; routines: Array<{ key: string; title: string }>;
      tasks: Array<{ key: string; title: string; description: string; done: string[]; role?: string; reviewer?: string | null }>; closedMode?: { deny: string[] };
    };
    const blueprint = { ...pkg, tasks: [], closedMode: { deny: [...(pkg.closedMode?.deny ?? []), 'mcp__probe_shut'] } };
    const first = pkg.tasks.find((t) => t.key === 'icerik-takvimi-pastane') ?? pkg.tasks[0]!;
    // Write and Edit are locked here: the package's file items become the same items as text in the evidence (run 2 showed
    // the Editor rightly sending back a calendar that was not a file, and the Writer blocked).
    const textDone = first.done.map((d) =>
      d.replace(/^takvim\.csv'de 6 satır/, 'Kanıtta takvim.csv içeriği CSV metni olarak: 6 satır').replace(/^6 metin dosyası/, 'Kanıtta 6 gönderi metni'),
    );

    if (!(SPENT_BEFORE >= 0 && SPENT_BEFORE < COST_CAP_USD)) throw new Error(`PILOT_SPENT_BEFORE_USD geçersiz ya da tavanı doldurmuş: ${process.env.PILOT_SPENT_BEFORE_USD}`);
    const o: PilotOffice = await pilotOffice({ spentBefore: SPENT_BEFORE });
    const since = o.now();
    const record: StepRecord[] = [];
    /** Each KÖ the run measures: its threshold met or not. A measurement, not a gate: the steps go on either way. */
    const kö: Array<{ id: string; measured: string; met: boolean }> = [];
    const measure = (id: string, measured: string, met: boolean) => kö.push({ id, measured, met });
    let overCap = false;
    const watch = o.events.subscribe((e) => {
      if (e.event.type !== 'turn.finished' || overCap || SPENT_BEFORE + spentUsd(o) <= COST_CAP_USD) return;
      overCap = true;
      for (const x of o.roster.list()) void o.engine.stop(x.id).catch(() => undefined);
    });
    const events = (after = 0) => o.events.list({ after, limit: 1_000_000 });
    const turns = (after: number) => events(after).filter((e) => e.event.type === 'turn.finished').length;
    const wait = async (what: string, check: () => boolean, ms = STEP_TIMEOUT_MS) => {
      try {
        await until(() => overCap || check(), ms);
      } catch {
        throw new Error(`zaman aşımı (${ms / 1000} sn): ${what}`);
      }
      if (overCap) throw new Error(`Maliyet tavanı aşıldı ($${SPENT_BEFORE.toFixed(4)} önceki + $${spentUsd(o).toFixed(4)} bu koşu > $${COST_CAP_USD}); bütün oturumlar durduruldu.`);
    };
    const step = async (name: string, kö: string, fn: (checks: string[]) => Promise<void>) => {
      const usd0 = spentUsd(o);
      const seq0 = o.events.lastSeq();
      const t0 = Date.now();
      const checks: string[] = [];
      try {
        await fn(checks);
        record.push({ step: name, kö, usd: spentUsd(o) - usd0, turns: turns(seq0), seconds: Math.round((Date.now() - t0) / 1000), checks });
      } catch (err) {
        record.push({ step: name, kö, usd: spentUsd(o) - usd0, turns: turns(seq0), seconds: Math.round((Date.now() - t0) / 1000), checks, error: err instanceof Error ? err.message : String(err) });
        throw err;
      }
      o.checkCost();
    };
    /** As the owner's page sends it (Origin, Sec-Fetch-Site, the page's nonce). */
    const owner = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
      const headers = { 'content-type': 'application/json', ...(await pageHeaders(o.port)) };
      return new Promise((resolve, reject) => {
        const req = httpRequest({ host: '127.0.0.1', port: o.port, method, path, headers }, (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null }));
        });
        req.on('error', reject);
        req.write(JSON.stringify(body ?? {}));
        req.end();
      });
    };
    const idle = (who: Employee) => wait(`${who.name} boşta`, () => o.engine.ready(who.id));
    /** The owner's word, once they are free: a turn that began meanwhile (the coordinator's cycle) answers 409, and the word waits for its end. */
    const say = async (to: Employee, text: string) => {
      for (let i = 0; ; i++) {
        await idle(to);
        const { status } = await owner('POST', `/api/employees/${to.id}/messages`, { text });
        if (status === 202) return;
        expect(status).toBe(409);
        if (i >= 20) throw new Error(`${to.name} 20 denemede boşalmadı`);
        await new Promise((r) => setTimeout(r, 1_000));
      }
    };
    /** The result of the first call of an office tool by `who` after `after`. */
    const toolResult = async (who: Employee, tool: string, after: number): Promise<string> => {
      const started = () => events(after).find((e) => e.employeeId === who.id && e.event.type === 'tool.started' && e.event.name === `mcp__office__${tool}`);
      let finished: StoredEvent | undefined;
      await wait(`${who.name}: ${tool}`, () => {
        const s = started();
        if (!s || s.event.type !== 'tool.started') return false;
        const id = s.event.toolUseId;
        finished = events(s.seq).find((e) => e.event.type === 'tool.finished' && e.event.toolUseId === id);
        return finished !== undefined;
      });
      return finished!.event.type === 'tool.finished' ? finished!.event.output : '';
    };

    let coordinator!: Employee;
    let plan!: { id: string };
    try {
      // 1 — the office and the coordinator; the bounds on the real CLI: one session with the exact arguments, killed at init.
      await step('1 ofis, koordinatör, kilitli açılış', '—', async (checks) => {
        coordinator = o.company.hireCoordinator(PILOT_MODEL);
        const office = JSON.stringify({ mcpServers: { office: { type: 'http', url: `http://127.0.0.1:${o.port}/mcp`, headers: { Authorization: `Bearer ${o.tokens.issue(coordinator.id)}` } } } });
        const args = [...pilotCommand(), ...sessionArgs({ model: PILOT_MODEL, sessionId: crypto.randomUUID(), resume: false, mcpConfig: office, hook: gateHookCommand(), disallowed: sessionDeny({ capabilities: [], seen: [], closedServers: [] }) })];
        const init = await initOf(args.slice(1), tempDir('pilot-init-'));
        const tools = init.tools as string[];
        const servers = (init.mcp_servers as Array<{ name: string; status: string }>).map((m) => `${m.name} ${m.status}`).sort();
        expect(servers).toEqual(['office connected', ...PILOT_STUBS.map((s) => `${s} connected`)].sort());
        for (const t of [...LOCKED_TOOLS, ...DISALLOWED_TOOLS]) expect(tools).not.toContain(t);
        checks.push(`kilitli açılış: claude ${String(init.claude_code_version)}; sunucular ${servers.join(', ')}; ${tools.length} araç, LOCKED_TOOLS ve DISALLOWED_TOOLS yok`);
        // The probe's token took the coordinator's (one token per employee): start the session again, with a fresh one.
        o.engine.reload(coordinator.id);
        await wait('koordinatörün oturumu yeni jetonla açıldı', () => o.engine.ready(coordinator.id));
      });

      // 2 — the founder's sentence; the coordinator runs the onboarding; the scripted founder answers each round on the page.
      await step('2 onboarding (betikli kurucu)', 'KÖ1', async (checks) => {
        const after = o.events.lastSeq();
        await say(coordinator, `${FOUNDER}\n\nBu bir deneme kurulumu. Önce işimizi öğren: onboardingStart ile başla (description: yukarıdaki ilk cümle). Sonra soruları onboardingNext ile sor; cevaplarımı ekrandan vereceğim. Her cevaptan sonra onboardingNext ile devam et; zorunlu sorular bitince onboardingFinish çağır. Onboarding araçlarından başka araç kullanma.`);
        const answered = new Set<number>();
        await wait('onboarding bitti', () => {
          for (const e of events(after)) {
            if (e.event.type === 'onboarding.changed' && e.event.change === 'round' && e.event.round && !answered.has(e.seq)) {
              answered.add(e.seq);
              const answers = Object.fromEntries(e.event.round.questions.filter((q) => q in ANSWERS).map((q) => [q, ANSWERS[q]]));
              if (Object.keys(answers).length > 0) void owner('POST', '/api/onboarding/answers', { answers });
            }
          }
          return events(after).some((e) => e.event.type === 'onboarding.changed' && e.event.change === 'finished');
        });
        const rounds = events(after).flatMap((e) => (e.event.type === 'onboarding.changed' && e.event.change === 'round' && e.event.round ? [e.event.round] : []));
        const asked = rounds.reduce((n, r) => n + r.questions.length, 0);
        checks.push(`tur ${rounds.length} (≤ 2), soru ${asked} (≤ 10): ${rounds.map((r) => r.questions.join(', ')).join(' | ')}`);
        expect(o.company.onboarding().complete).toBe(true);
        const assumed = Object.values(o.company.profile().sections).flatMap((s) => (s ? s.assumedFields.map((f) => `${s.section}.${f}`) : []));
        checks.push(`varsayılan alanlar: ${assumed.length ? assumed.join(', ') : 'yok'}`);
        measure('KÖ1', `onboarding ${rounds.length} tur, ${asked} soru (eşik ≤ 2 tur, ≤ 10 soru)`, rounds.length <= 2 && asked <= 10);
      });

      // 3 — the package as a blueprint plan; the owner approves it on the page; the coordinator reads and installs it.
      await step('3 blueprint: öneri, sahibi onayı, kurulum', 'KÖ2', async (checks) => {
        await idle(coordinator);
        const proposed = o.blueprints.propose(coordinator.id, blueprint);
        plan = proposed.plan;
        expect(proposed.plan.status).toBe('draft');
        const after = o.events.lastSeq();
        expect((await owner('POST', `/api/plans/${plan.id}/approve`)).status).toBe(200);
        const approvedAt = o.now();
        await idle(coordinator);
        await say(coordinator, `Kurulum planını onayladım (planId ${plan.id}). blueprintRead ile oku, sonra blueprintApply ile kur. Başka araç kullanma.`);
        await toolResult(coordinator, 'blueprintApply', after);
        await wait('3 üye işe alındı', () => events(after).filter((e) => e.event.type === 'employee.hired').length >= pkg.roles.length);
        const installed = events(after).filter((e) => ['employee.hired', 'playbook.updated', 'goal.changed', 'schedule.changed'].includes(e.event.type));
        const count = (type: string, change?: string) => installed.filter((e) => e.event.type === type && (change === undefined || (e.event as { change?: string }).change === change)).length;
        const took = Math.round(((installed.at(-1)?.ts ?? approvedAt) - approvedAt) / 1000);
        checks.push(`onaydan son kurulum olayına ${took} sn (≤ 30 dk)`);
        checks.push(`employee.hired ${count('employee.hired')}, playbook.updated ${count('playbook.updated')}, goal.changed set ${count('goal.changed', 'set')}, schedule.changed created ${count('schedule.changed', 'created')}`);
        expect(count('employee.hired')).toBe(pkg.roles.length);
        expect(count('playbook.updated')).toBe(pkg.playbook.length);
        expect(count('goal.changed', 'set')).toBe(pkg.goals.length);
        expect(count('schedule.changed', 'created')).toBe(pkg.routines.length);
        const again = o.blueprints.apply(coordinator.id, plan.id);
        expect(again.steps.every((s) => s.result === 'skipped')).toBe(true);
        measure('KÖ2', `onaydan kurulumun sonuna ${took} sn; ikinci kurulum sıfır yeni adım (eşik ≤ 30 dk)`, took <= 1800);
        checks.push(`ikinci blueprintApply: ${again.steps.length} adımın hepsi 'skipped' (sıfır yeni adım)`);
      });

      const members = () => o.roster.list().filter((e) => e.kind !== 'coordinator');
      // 4 — every member's session: probe_shut closed by the desk file, probe_open open; one cheap turn each to report it.
      await step('4 kapalı kip: üyelerin oturumları', 'KÖ5 (kapalı kip)', async (checks) => {
        const after = o.events.lastSeq();
        for (const m of members()) {
          await idle(m);
          await say(m, 'Tek kelimeyle "hazır" yaz. Araç kullanma.');
        }
        await wait('her üyenin oturumu açıldı ve turu bitti', () => members().every((m) => events(after).some((e) => e.employeeId === m.id && e.event.type === 'turn.finished')));
        for (const m of members()) {
          // Their latest session (a cycle may have given them work, and their session, before this step).
          const s = events().findLast((e) => e.employeeId === m.id && e.event.type === 'session.started')!;
          const mcp = s.event.type === 'session.started' ? s.event.mcp : [];
          const tools = (name: string) => mcp.find((x) => x.name === name)?.tools ?? null;
          checks.push(`${m.name}: model ${s.event.type === 'session.started' ? s.event.model : '?'}; sunucular ${mcp.map((x) => `${x.name}(${x.tools ?? '?'})`).join(', ')}`);
          expect(mcp.map((x) => x.name).sort()).toEqual(['office', ...PILOT_STUBS].sort());
          expect(tools('probe_shut')).toBe(0);
          expect(tools('probe_open')).toBe(1);
        }
        const view = o.blueprints.read(plan.id);
        const shut = view.closedMode.flatMap((d) => d.rules.filter((r) => r.rule === 'mcp__probe_shut').map((r) => `${d.name}: ${r.check}`));
        checks.push(`blueprintRead kapalı kip (mcp__probe_shut): ${shut.join('; ')}`);
        expect(shut.length).toBe(pkg.roles.length);
        expect(shut.every((l) => l.endsWith('verified'))).toBe(true);
        const outward = events().filter((e) => e.event.type === 'tool.started' && /send|publish|post|deploy|charge|delete/i.test(e.event.name));
        checks.push(`yayın/gönderim kalıbına uyan tool.started: ${outward.length} (K3'te böyle araç zaten yok; bu kipi doğrular, kapıyı değil)`);
        expect(outward).toEqual([]);
        measure('KÖ5 (kapalı kip)', `üç masada mcp__probe_shut doğrulandı, yayın/gönderim tool.started ${outward.length} (kipi doğrular, kapıyı değil)`, true);
      });

      // 5 — a plan under H1; the coordinator opens the package's Pastane task with the Editor as reviewer; it is done and reviewed.
      let h1Plan!: { id: string; title: string };
      await step('5 görev, teslim, inceleme', 'KÖ3, KÖ4', async (checks) => {
        const h1 = o.company.goals().find((g) => g.title === pkg.goals[0]!.title)!;
        h1Plan = o.company.propose(coordinator.id, { method: METHOD, title: 'Pastane Ada: haftalık takvim (sentetik)', goal: 'H1 için ilk takvim', approach: 'Yazar yazar, Editör inceler.', goalId: h1.id });
        expect((await owner('POST', `/api/plans/${h1Plan.id}/approve`)).status).toBe(200);
        const writer = members().find((m) => m.name === pkg.roles.find((r) => r.key === 'icerik-yazari')?.name)!;
        const editor = members().find((m) => m.name === pkg.roles.find((r) => r.key === 'editor')?.name)!;
        const after = o.events.lastSeq();
        await idle(coordinator);
        await say(coordinator, [
          `“${h1Plan.title}” planında (planId ${h1Plan.id}) taskCreate ile bir görev aç:`,
          `başlık: ${first.title}`,
          `açıklama: ${first.description} Not: bu denemede dosya yazma araçları kapalı; takvim ve metinler dosya değil, kanıt satırlarında metin olarak teslim edilir (her kanıt satırı en çok 1000 karakter).`,
          `bitti maddeleri: ${JSON.stringify(textDone)}`,
          `atanan: ${writer.name}; inceleyen: ${editor.name}. Başka araç kullanma.`,
        ].join('\n'));
        // By its title (a cycle may open other tasks in the plan too); the plan's only work task if the title was reworded.
        const task = () => {
          const work = o.tasks.list({ statuses: ['waiting', 'in_progress', 'review', 'blocked', 'done'] }).filter((t) => t.planId === h1Plan.id && t.kind === 'work');
          return work.find((t) => t.title.trim() === first.title.trim()) ?? (work.length === 1 ? work[0] : undefined);
        };
        await wait('görev açıldı', () => task() !== undefined);
        await wait('görev bitti (inceleme onayıyla), takıldı ya da 2 turu aştı', () => {
          const t = task()!;
          return t.status === 'done' || t.status === 'blocked' || (t.round ?? 0) > 2;
        });
        const t = task()!;
        const evidence = t.result?.evidence?.length ?? 0;
        checks.push(`görev ${t.status}, tur ${t.round}, atanan ${o.company.nameOf(t.assignee)}, inceleyen ${t.reviewer ? o.company.nameOf(t.reviewer) : '-'}, kanıt ${evidence} / bitti maddesi ${t.done.length}`);
        measure('KÖ3', `görev ${t.status}, tur ${t.round} (eşik: inceleme onayıyla bitti, ≤ 2 tur)`, t.status === 'done' && (t.round ?? 0) <= 2);
        measure('KÖ4', `inceleyen ≠ atanan: ${t.reviewer !== null && t.reviewer !== t.assignee}; kanıt ${evidence} / bitti ${t.done.length}`, t.reviewer !== null && t.reviewer !== t.assignee && (t.status !== 'done' || evidence >= t.done.length));
        // Mechanics: the coordinator opened it as asked, someone else reviews it.
        expect(t.reviewer).not.toBe(t.assignee);
        checks.push(`görev açıldıktan sonra tur: ${turns(after)}`);
      });

      // 7 — the coordinator records an H1 reading by hand and assesses the plan; the retro carries the KPI table.
      await step('7 KPI okuması ve retro', 'KÖ11', async (checks) => {
        const h1 = o.company.goals().find((g) => g.title === pkg.goals[0]!.title)!;
        const kpi = h1.kpis.find((k) => k.source === 'manual')!;
        const after = o.events.lastSeq();
        await idle(coordinator);
        await say(coordinator, `kpiRecord ile “${h1.title}” hedefinin (goalId ${h1.id}) “${kpi.name}” KPI'sına 92 yaz (not: K3 denemesi, sentetik). Sonra planRetro ile “${h1Plan.title}” planını (planId ${h1Plan.id}) kısaca değerlendir. Başka araç kullanma.`);
        const recorded = await toolResult(coordinator, 'kpiRecord', after);
        const retro = await toolResult(coordinator, 'planRetro', after);
        const readings = o.db.prepare('SELECT kpi, value, source FROM kpi_readings ORDER BY id').all() as unknown as Array<{ kpi: string; value: number | null; source: string }>;
        checks.push(`kpiRecord: ${recorded.replace(/\s+/g, ' ').slice(0, 160)}`);
        checks.push(`kpi_readings: ${readings.map((r) => `${r.kpi} ${r.value ?? 'veri yok'} (${r.source})`).join('; ')}`);
        expect(readings.filter((r) => r.source === 'manual')).toHaveLength(1);
        const note = o.memory.notes(undefined, 100).map((n) => n.note).find((n) => n.title === `Değerlendirme: ${h1Plan.title}`);
        checks.push(`retro notunda KPI tablosu: ${note?.text.includes("## KPI'lar") ? 'var' : 'YOK'}; araç cevabında: ${retro.includes("KPI'lar:") ? 'var' : 'yok'}`);
        expect(note?.text).toContain("## KPI'lar");
        measure('KÖ11', `kpi_readings ${readings.length} satır (1 elle), retro notunda KPI tablosu`, true);
      });

      // 8 — the coordinator searches the memory for the Pastane brand voice.
      await step('8 hafıza araması', 'KÖ8', async (checks) => {
        const after = o.events.lastSeq();
        await idle(coordinator);
        await say(coordinator, 'memorySearch ile "marka dili pastane" ara (query tam bu). Başka araç kullanma; sonucu bir cümleyle yaz.');
        const found = await toolResult(coordinator, 'memorySearch', after);
        const top = found.split('\n').filter((l) => l.startsWith('• ')).slice(0, 3);
        checks.push(`ilk 3: ${top.map((l) => l.slice(0, 120)).join(' | ')}`);
        const hit = top.some((l) => /Marka dili — Pastane/i.test(l));
        measure('KÖ8', `"marka dili pastane" aramasında Pastane marka dili ilk 3'te: ${hit ? 'evet' : 'hayır'}`, hit);
      });

      // 6 — last: the members stop (no work on the routine's task), the clock moves to the weekly report's time, it fires.
      await step('6 rutin (saat ilerletilir, en sonda)', 'KÖ10', async (checks) => {
        for (const m of members()) await o.engine.stop(m.id);
        const weekly = o.schedules.list({ planId: plan.id, statuses: ['active'] }).find((s) => s.title === pkg.routines[0]!.title)!;
        const due = weekly.nextRunAt!;
        o.advance(due - o.now() + 5_000);
        const after = o.events.lastSeq();
        o.clock.runNow();
        await wait('rutin tetiklendi', () => events(after).some((e) => e.event.type === 'schedule.changed' && e.event.change === 'fired' && e.event.schedule.id === weekly.id));
        const fired = events(after).find((e) => e.event.type === 'schedule.changed' && e.event.change === 'fired' && e.event.schedule.id === weekly.id)!;
        const fresh = o.schedules.list({ planId: plan.id }).find((s) => s.id === weekly.id)!;
        checks.push(`“${weekly.title}” ${weekly.cron}: tetiklenme ${Math.round((fired.ts - due) / 1000)} sn sapma (±60), skipCount ${fresh.skipCount}`);
        measure('KÖ10', `rutin cron zamanından ${Math.round((fired.ts - due) / 1000)} sn sapmayla tetiklendi, skipCount ${fresh.skipCount} (eşik ±60 sn, 0)`, Math.abs(fired.ts - due) <= 60_000 && fresh.skipCount === 0);
        expect(o.tasks.list({ statuses: ['waiting', 'in_progress'] }).some((t) => t.scheduleId === weekly.id)).toBe(true);
      });
    } finally {
      watch();
      const total = spentUsd(o);
      const sessions = events().flatMap((e) => (e.event.type === 'session.started' ? [`${o.company.nameOf(e.employeeId ?? '')}: ${e.event.model}; ${e.event.mcp.map((m) => `${m.name} ${m.status}(${m.tools ?? '?'})`).join(', ')}`] : []));
      const cycles = events().flatMap((e) => (e.event.type === 'management.cycle' ? [e.event] : []));
      const lost = events().filter((e) => e.event.type === 'management.cycle.lost').length;
      const tasks = o.tasks.list({ limit: 1000 });
      // Step 9 of the readiness plan: C5-5's script on this run's database, its level K3.
      let table: string;
      try {
        table = formatPilotMetrics(pilotMetrics(o.db, { since, until: o.now() + 1, level: 'K3' }));
      } catch (err) {
        table = `pilotMetrics hata verdi: ${err instanceof Error ? err.message : String(err)}`;
      }
      if (process.env.PILOT_DB_OUT) o.db.exec(`VACUUM INTO '${process.env.PILOT_DB_OUT.replaceAll("'", "''")}'`);
      const lines = [
        `# Pilot K3 kaydı — ${new Date().toISOString()}`,
        `bu koşu: $${total.toFixed(4)}; önceki koşular: $${SPENT_BEFORE.toFixed(4)}; toplam $${(SPENT_BEFORE + total).toFixed(4)} (tavan $${COST_CAP_USD}), tur: ${turns(0)}`,
        '',
        '| Adım | KÖ | Maliyet | Tur | Süre | Durum |',
        '|---|---|---|---|---|---|',
        ...record.map((r) => `| ${r.step} | ${r.kö} | $${r.usd.toFixed(4)} | ${r.turns} | ${r.seconds} sn | ${r.error ? `HATA: ${r.error}` : 'geçti'} |`),
        '',
        '| KÖ | Ölçülen (K3) | Eşik |',
        '|---|---|---|',
        ...kö.map((k) => `| ${k.id} | ${k.measured} | ${k.met ? 'tuttu' : 'TUTMADI'} |`),
        '',
        ...record.flatMap((r) => [`## ${r.step}`, ...r.checks.map((c) => `- ${c}`), ...(r.error ? [`- HATA: ${r.error}`] : []), '']),
        '## KÖ1–KÖ11: C5-5 pilotMetrics, bu koşunun veritabanı (K3)',
        table,
        '',
        `## Yönetim döngüleri (${cycles.length}; kapanan ${cycles.filter((c) => c.closed).length}; panosu ulaşmayan ${lost})`,
        ...cycles.map((c) => `- ${c.closed ? 'kapandı' : 'KAPANMADI'}; model ${c.model ?? '?'}; $${(c.costUsd ?? 0).toFixed(4)}; tetikleyiciler: ${c.triggers.map((t) => `${t.kind}${t.note ? ` (${t.note})` : ''}`).join(', ')}; değişiklikler: ${c.changes.join('; ') || '-'}`),
        '',
        `## Görevler (${tasks.length})`,
        ...tasks.map((t) => `- ${t.kind} “${t.title}” ${t.status}; ${o.company.nameOf(t.assignee)}${t.reviewer ? `, inceleyen ${o.company.nameOf(t.reviewer)}` : ''}`),
        '',
        '## Oturum raporları (session.started)',
        ...[...new Set(sessions)].map((s) => `- ${s}`),
        '',
        '## Günlük',
        ...events().flatMap(({ employeeId, event: e }) => {
          const who = employeeId ? o.company.nameOf(employeeId) : 'ofis';
          const short = (t: string) => t.replace(/\s+/g, ' ').slice(0, 200);
          if (e.type === 'tool.started') return [`${who} araç ${e.name} ${short(JSON.stringify(e.input))}`];
          if (e.type === 'tool.finished') return [`${who}   ${e.isError ? 'HATA ' : ''}${short(e.output)}`];
          if (e.type === 'message.assistant') return [`${who} yanıt ${short(e.text)}`];
          if (e.type === 'turn.finished') return [`${who} tur ${e.subtype} $${e.costUsd.toFixed(4)}`];
          if (e.type === 'error') return [`${who} hata ${short(e.message)}`];
          return [];
        }),
      ];
      if (process.env.SMOKE_OUT) writeFileSync(process.env.SMOKE_OUT, `${lines.join('\n')}\n`);
      console.log(lines.slice(0, 16 + record.length + kö.length).join('\n'));
      await o.stop();
    }
  });
});

/** The system/init of a session opened with `args` (the CLI's own, `claude` first stripped), killed when it arrives. */
async function initOf(args: string[], cwd: string): Promise<Record<string, unknown>> {
  const child = spawn('claude', args, { cwd, stdio: ['pipe', 'pipe', 'ignore'] });
  let init: Record<string, unknown> | null = null;
  const done = new Promise<void>((resolve) => {
    let buf = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      for (const line of buf.split('\n')) {
        try {
          const o = JSON.parse(line) as Record<string, unknown>;
          if (o.type === 'system' && o.subtype === 'init') {
            init = o;
            child.kill('SIGKILL');
            resolve();
          }
        } catch {
          // partial line
        }
      }
    });
  });
  await new Promise((r) => setTimeout(r, 4_000));
  child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: 'Reply with the single word ok.' } })}\n`);
  await Promise.race([done, new Promise((r) => setTimeout(r, 90_000))]);
  child.kill('SIGKILL');
  if (!init) throw new Error('kilitli açılışta init gelmedi');
  return init;
}
