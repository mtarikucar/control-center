import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createApi } from '../src/api.ts';
import { Agenda } from '../src/company/agenda.ts';
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
/** The only tools the session may use: the office's own, and Claude Code's loader for deferred tool schemas. */
const allowed = (name: string) => name.startsWith('mcp__office__') || name === 'ToolSearch';
// Closed before anything runs (review, Kerem round 1): only the office's own server, no outward built-in (real-session.ts).

describe.skipIf(!enabled)('core 2 with the real claude CLI (coordinator on haiku, a throwaway data dir, only the office’s server)', () => {
  it('the coordinator calls onboardingStart, onboardingRead and integrationsList once — no connector of the owner’s is even in the session', { timeout: 600_000 }, async () => {
    const s = setup();
    const tokens = new TokenRegistry();
    let url = '';
    const engine = new Engine({ roster: s.roster, events: s.events, dataDir: s.dataDir, claudeCommand: ['claude', ...LOCKED_ARGS], mcp: { url: () => url, tokens } });
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
    const agenda = new Agenda({ roster: s.roster, tasks, schedules, company, budget });
    const api = createApi(
      { engine, roster: s.roster, events: s.events, quota, mcp: { tokens, tools: officeTools({ company, roster: s.roster, tasks, characters, memory, budget, engine, plans: () => plans.list(), agenda, integrations }) }, company: { service: company, tasks, plans, memory, budget, proposals, agenda, integrations } },
      { allowedOrigins: [] },
    );
    await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(api.server.address() as AddressInfo).port}/mcp`;
    // The database lives in memory: what happened is printed before it goes, passed or not.
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
      engine.send(
        coordinator.id,
        'Bu bir araç denemesi. Şu üç ofis aracını sırayla, her birini yalnız bir kez çağır: (1) onboardingStart, description: "Mahallede ekşi maya ekmek ve kurabiye satan küçük bir fırınız." (2) onboardingRead (3) integrationsList. Başka hiçbir araç çağırma; soruları sahibine sorma. Bitince bana tek cümleyle ne gördüğünü yaz.',
        'owner',
      );
      await until(() => s.events.list({ limit: 100_000 }).some((e) => e.employeeId === coordinator.id && e.event.type === 'turn.finished'), 540_000);
      // The session's own report, written before any tool ran: the office's server only, with its tools in the session.
      const sessions = s.events.list({ limit: 100_000 }).flatMap((e) => (e.event.type === 'session.started' ? [e.event.mcp] : []));
      expect(sessions.length).toBeGreaterThan(0);
      for (const mcp of sessions) {
        expect(mcp.map((m) => m.name)).toEqual(['office']);
        expect(mcp[0]!.tools).toBeGreaterThan(0);
      }
      const tools = s.events.list({ limit: 100_000 }).flatMap((e) => (e.event.type === 'tool.started' ? [e.event.name] : []));
      const cost = s.events.list({ limit: 100_000 }).reduce((n, e) => n + (e.event.type === 'turn.finished' ? e.event.costUsd : 0), 0);
      console.log(`K3 KAYDI\n${journal()}\nçağrılan araçlar: ${tools.join(', ')}\ntoplam maliyet (CLI'nin bildirdiği): $${cost.toFixed(4)}\nK3 KAYDI SONU`);
      expect(tools.filter((n) => !allowed(n))).toEqual([]);
      for (const name of ['onboardingStart', 'onboardingRead', 'integrationsList']) expect(tools, name).toContain(`mcp__office__${name}`);
      expect(company.onboarding().onboarding).toMatchObject({ status: 'active', description: 'Mahallede ekşi maya ekmek ve kurabiye satan küçük bir fırınız.' });
      expect(company.profile().sections.identity).toMatchObject({ assumedFields: [] });
      // B3 read the session this very coordinator opened: every connector it reported (the office's) is in the registry, open.
      const reported = s.events.list({ limit: 100_000 }).flatMap((e) => (e.event.type === 'session.started' ? e.event.mcp.map((m) => m.name) : []));
      expect(integrations.list().map((i) => i.name).sort()).toEqual([...new Set(reported)].sort());
      expect(integrations.get('office').desks).toEqual([expect.objectContaining({ status: 'connected', open: true, closedBy: null })]);
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
