import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createApi } from '../src/api.ts';
import { Agenda } from '../src/company/agenda.ts';
import { BlueprintStore } from '../src/company/blueprint-store.ts';
import { Blueprints } from '../src/company/blueprint.ts';
import { unclassifiedTools } from '../src/company/capabilities.ts';
import { Company } from '../src/company/company.ts';
import { CompanyStateStore, GoalStore } from '../src/company/goal-store.ts';
import { IntegrationRegistry } from '../src/company/integrations.ts';
import { OnboardingStore } from '../src/company/onboarding-store.ts';
import { ProfileStore } from '../src/company/profile-store.ts';
import { NoticeStore, PlanStore, ScheduleStore, TaskStore } from '../src/company/store.ts';
import { Engine } from '../src/engine.ts';
import { TokenRegistry } from '../src/mcp/tokens.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { QuotaTracker } from '../src/quota.ts';
import { setup, until } from './helpers.ts';
import { LOCKED_ARGS } from './real-session.ts';

const enabled = process.env.OFFICE_SMOKE === '1';
const STUB = fileURLToPath(new URL('./fixtures/mcp-stub.mjs', import.meta.url));
/** The only tools the session may use: the office's own, and Claude Code's loader for deferred tool schemas. */
const allowed = (name: string) => name.startsWith('mcp__office__') || name === 'ToolSearch';
/** Besides the office's server, one stub of the test's own (one harmless tool): no connector of the owner's. */
const STUB_CONFIG = JSON.stringify({ mcpServers: { probe_open: { command: process.execPath, args: [STUB, 'probe_open'] } } });

describe.skipIf(!enabled)('core 3 with the real claude CLI (coordinator on haiku, a throwaway data dir, only the office’s server and a stub)', () => {
  it('the coordinator calls roleTemplates, capabilitiesRead and blueprintRead once — B6, B7 and B5 read in a real session, nothing written outside', { timeout: 600_000 }, async () => {
    const s = setup();
    const tokens = new TokenRegistry();
    let url = '';
    const engine = new Engine({ roster: s.roster, events: s.events, dataDir: s.dataDir, claudeCommand: ['claude', ...LOCKED_ARGS, '--mcp-config', STUB_CONFIG], mcp: { url: () => url, tokens } });
    const tasks = new TaskStore(s.db);
    const plans = new PlanStore(s.db);
    const notices = new NoticeStore(s.db);
    const schedules = new ScheduleStore(s.db);
    const characters = () => ['coder', 'manager'];
    const { DecisionStore, EmployeeNoteStore, NoteStore, PlaybookStore } = await import('../src/company/memory-store.ts');
    const { Memory } = await import('../src/company/memory.ts');
    const memory = new Memory({ roster: s.roster, events: s.events, notices, tasks, plans, dataDir: s.dataDir, decisions: new DecisionStore(s.db), playbook: new PlaybookStore(s.db), notes: new NoteStore(s.db), employeeNotes: new EmployeeNoteStore(s.db) });
    const { Budget } = await import('../src/company/budget.ts');
    const { ConstitutionStore, SpendStore } = await import('../src/company/budget-store.ts');
    const quota = new QuotaTracker(s.db, s.events);
    const budget = new Budget({ constitution: new ConstitutionStore(s.db), spend: new SpendStore(s.db), tasks, plans, roster: s.roster, events: s.events, notices, quota, deskCount: 8 });
    const { ProposalStore } = await import('../src/company/proposal-store.ts');
    const proposals = new ProposalStore(s.db);
    const company = new Company({
      roster: s.roster, events: s.events, tasks, plans, notices, dataDir: s.dataDir, hire: (i) => engine.hire(i), characters, memory, reload: (id) => engine.reload(id),
      constitution: () => budget.constitution(), proposals, goals: new GoalStore(s.db), state: new CompanyStateStore(s.db), schedules,
      profile: new ProfileStore(s.db), onboarding: new OnboardingStore(s.db),
    });
    const integrations = new IntegrationRegistry({ db: s.db, roster: s.roster, events: s.events });
    const blueprints = new Blueprints({ company, roster: s.roster, tasks, plans, schedules, memory, store: new BlueprintStore(s.db), integrations, constitution: () => budget.constitution() });
    const agenda = new Agenda({ roster: s.roster, tasks, schedules, company, budget });
    const api = createApi(
      {
        engine, roster: s.roster, events: s.events, quota,
        mcp: { tokens, tools: officeTools({ company, roster: s.roster, tasks, characters, memory, budget, engine, plans: () => plans.list(), agenda, integrations, blueprints }) },
        company: { service: company, tasks, plans, memory, budget, proposals, agenda, integrations, blueprints },
      },
      { allowedOrigins: [] },
    );
    await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(api.server.address() as AddressInfo).port}/mcp`;
    const short = (text: string) => text.replace(/\s+/g, ' ').slice(0, 300);
    const journal = () =>
      s.events
        .list({ limit: 100_000 })
        .flatMap(({ event: e }) => {
          if (e.type === 'session.started') return [`oturum ${e.model}, ${e.mcp.length} MCP sunucusu: ${e.mcp.map((m) => `${m.name} ${m.status} (${m.tools ?? '?'} araç)`).join(', ')}`];
          if (e.type === 'tool.started') return [`araç ${e.name} ${short(JSON.stringify(e.input))}`];
          if (e.type === 'tool.finished') return [`  ${e.isError ? 'HATA ' : ''}${short(e.output)}`];
          if (e.type === 'message.assistant') return [`yanıt ${short(e.text)}`];
          if (e.type === 'turn.finished') return [`tur bitti ${e.subtype} ${e.numTurns} adım $${e.costUsd.toFixed(4)} (girdi ${e.usage.inputTokens}, çıktı ${e.usage.outputTokens}, önbellek okuma ${e.usage.cacheReadTokens}, önbellek yazma ${e.usage.cacheCreationTokens})`];
          if (e.type === 'error') return [`hata ${short(e.message)}`];
          return [];
        })
        .join('\n');
    try {
      const coordinator = company.hireCoordinator('haiku');
      // A blueprint to read (B5): the profile first, then a one-role setup; nothing is installed, no one is hired.
      for (const [section, fields] of [['identity', { name: 'Fırın', sector: 'gıda' }], ['offer', { products: ['ekşi maya ekmek'] }], ['customers', { segments: ['mahalle'], channels: ['dükkan'] }], ['goals', { goals: ['haftalık satış'] }], ['success', { done: ['düzenli müşteri'] }], ['tools', { email: ['yok'] }], ['constraints', { budget: '0', other: ['yayın kararı sahibinde'] }]] as const) {
        company.profileUpdate(coordinator.id, { section, fields, assumed: false });
      }
      const { plan } = blueprints.propose(coordinator.id, {
        title: 'Kurulum: Fırın', summary: 'Mahallede ekşi maya ekmek ve kurabiye satan küçük bir fırın.',
        roles: [{ key: 'satis', name: 'Ada', template: 'satis-asistani' }], playbook: [], goals: [], routines: [], tasks: [],
        closedMode: { deny: ['mcp__probe_open'] },
      });
      engine.send(
        coordinator.id,
        `Bu bir araç denemesi. Şu üç ofis aracını sırayla, her birini yalnız bir kez çağır: (1) roleTemplates (argümansız) (2) capabilitiesRead (argümansız) (3) blueprintRead, planId: "${plan.id}". Başka hiçbir araç çağırma; hiçbir şey yazma ya da gönderme. Bitince bana tek cümleyle ne gördüğünü yaz.`,
        'owner',
      );
      await until(() => s.events.list({ limit: 100_000 }).some((e) => e.employeeId === coordinator.id && e.event.type === 'turn.finished'), 540_000);
      const events = s.events.list({ limit: 100_000 });
      const sessions = events.flatMap((e) => (e.event.type === 'session.started' ? [e.event.mcp] : []));
      const tools = events.flatMap((e) => (e.event.type === 'tool.started' ? [e.event.name] : []));
      const cost = events.reduce((n, e) => n + (e.event.type === 'turn.finished' ? e.event.costUsd : 0), 0);
      console.log(`K3 KAYDI\n${journal()}\nçağrılan araçlar: ${tools.join(', ')}\ntoplam maliyet (CLI'nin bildirdiği): $${cost.toFixed(4)}\nK3 KAYDI SONU`);
      // The session's own report: the office's server and the stub, nothing of the owner's.
      expect(sessions.length).toBeGreaterThan(0);
      for (const mcp of sessions) {
        expect(mcp.map((m) => m.name).sort()).toEqual(['office', 'probe_open']);
        expect(mcp.find((m) => m.name === 'office')!.tools).toBeGreaterThan(0);
      }
      expect(tools.filter((n) => !allowed(n))).toEqual([]);
      for (const name of ['roleTemplates', 'capabilitiesRead', 'blueprintRead']) expect(tools, name).toContain(`mcp__office__${name}`);
      // Each of the three answered without error.
      const finished = new Map(events.flatMap((e) => (e.event.type === 'tool.finished' ? [[e.event.toolUseId, e.event] as const] : [])));
      for (const e of events) {
        if (e.event.type === 'tool.started' && e.event.name.startsWith('mcp__office__')) expect(finished.get(e.event.toolUseId)?.isError, e.event.name).toBe(false);
      }
      // B7 read the real session: the stub's tool is unclassified; B5's blueprint was read, not installed: nobody was hired.
      expect(unclassifiedTools(integrations.list())).toEqual([expect.objectContaining({ server: 'probe_open', unclassified: ['mcp__probe_open__ping'] })]);
      // (The default constitution is full autonomy: the plan started on proposal. The read installs nothing.)
      expect(blueprints.read(plan.id).steps.map((x) => [x.step, x.state])).toEqual([['role:satis', 'pending']]);
      expect(s.roster.list().map((e) => e.name)).toEqual(['Koordinatör']);
    } catch (err) {
      console.log(`K3 KAYDI (hata)\n${journal()}\nK3 KAYDI SONU`);
      throw err;
    } finally {
      await engine.shutdown();
      await api.close();
      s.cleanup();
    }
  });
});
