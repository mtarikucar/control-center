import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { type Goal, type Plan } from '@cc/shared';
import { createApi } from '../src/api.ts';
import { Agenda } from '../src/company/agenda.ts';
import { Company } from '../src/company/company.ts';
import { Dispatcher } from '../src/company/dispatcher.ts';
import { CompanyStateStore, GoalStore } from '../src/company/goal-store.ts';
import { Pulse } from '../src/company/pulse.ts';
import { NoticeStore, PlanStore, ScheduleStore, TaskStore } from '../src/company/store.ts';
import { Engine } from '../src/engine.ts';
import { TokenRegistry } from '../src/mcp/tokens.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { QuotaTracker } from '../src/quota.ts';
import { setup, waitFor } from './helpers.ts';

const enabled = process.env.OFFICE_SMOKE === '1';

describe.skipIf(!enabled)('the coordinator as project manager with the real claude CLI (coordinator on sonnet)', () => {
  it('a mission and no goal → the pulse → a goal and a plan the coordinator starts itself → the owner pauses and nothing more is handed out', async () => {
    const s = setup();
    const tokens = new TokenRegistry();
    let url = '';
    const engine = new Engine({ roster: s.roster, events: s.events, dataDir: s.dataDir, claudeCommand: ['claude'], mcp: { url: () => url, tokens } });
    const tasks = new TaskStore(s.db);
    const plans = new PlanStore(s.db);
    const notices = new NoticeStore(s.db);
    const characters = () => ['coder', 'designer'];
    const { DecisionStore, EmployeeNoteStore, NoteStore, PlaybookStore } = await import('../src/company/memory-store.ts');
    const { Memory } = await import('../src/company/memory.ts');
    const memory = new Memory({ roster: s.roster, events: s.events, notices, tasks, plans, dataDir: s.dataDir, decisions: new DecisionStore(s.db), playbook: new PlaybookStore(s.db), notes: new NoteStore(s.db), employeeNotes: new EmployeeNoteStore(s.db) });
    const { Budget } = await import('../src/company/budget.ts');
    const { ConstitutionStore, SpendStore } = await import('../src/company/budget-store.ts');
    const quota = new QuotaTracker(s.db, s.events);
    const constitutionStore = new ConstitutionStore(s.db);
    // Full autonomy (the default, set explicitly here): the coordinator starts its own plans.
    constitutionStore.set({ autonomy: 'free' });
    const budget = new Budget({ constitution: constitutionStore, spend: new SpendStore(s.db), tasks, plans, roster: s.roster, events: s.events, notices, quota, deskCount: 8 });
    const { ProposalStore } = await import('../src/company/proposal-store.ts');
    const proposals = new ProposalStore(s.db);
    const goals = new GoalStore(s.db);
    const state = new CompanyStateStore(s.db);
    const company = new Company({ roster: s.roster, events: s.events, tasks, plans, notices, dataDir: s.dataDir, hire: (i) => engine.hire(i), characters, memory, reload: (id) => engine.reload(id), constitution: () => budget.constitution(), proposals, goals, state });
    const api = createApi(
      { engine, roster: s.roster, events: s.events, quota, mcp: { tokens, tools: officeTools({ company, roster: s.roster, tasks, characters, memory, budget, engine, plans: () => plans.list(), agenda: new Agenda({ roster: s.roster, tasks, schedules: new ScheduleStore(s.db), company, budget }) }) }, company: { service: company, tasks, plans, memory, budget, proposals } },
      { allowedOrigins: [] },
    );
    await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(api.server.address() as AddressInfo).port}/mcp`;
    // The brief (the mission) is written before the office starts, so the first pulse already sees it.
    const coordinator = company.hireCoordinator('sonnet');
    company.updateBrief(coordinator.id, '# Şirket\n\nMisyon: küçük işletmelere ofis yazılımımızı tanıtmak. Şu an tek ürün var; tanıtım metni ve kısa bir SSS yok.\n');
    const pulse = new Pulse({ company, roster: s.roster, goals, state, plans, tasks, notices, budget });
    const stop = new Dispatcher({ events: s.events, roster: s.roster, tasks, notices, plans, company, engine, budget, pulse, tickMs: 5_000 }).start();
    try {
      // A company with a mission and no goals: the pulse tells the coordinator, who sets a goal and starts a plan itself.
      const goalSet = await waitFor(s.events, (e) => e.event.type === 'goal.changed' && e.event.change === 'set', { timeoutMs: 600_000 });
      const goal = (goalSet.event as { goal: Goal }).goal;
      expect(goal.why.length).toBeGreaterThan(0);
      expect(goal.done.length).toBeGreaterThan(0);
      const started = await waitFor(s.events, (e) => e.event.type === 'plan.changed' && e.event.change === 'approved', { timeoutMs: 600_000 });
      const plan = (started.event as { plan: Plan }).plan;
      expect(plan).toMatchObject({ approvedBy: 'coordinator', goalId: goal.id });
      expect(plan.method?.stages.length).toBeGreaterThanOrEqual(2);
      console.log(`\npm smoke: goal “${goal.title}” (${goal.done.join('; ')}); plan “${plan.title}” ${plan.method?.workType} started by the coordinator\n`);
      // The owner pauses: the office hands out nothing more.
      company.pause();
      const at = s.events.lastSeq();
      await new Promise((r) => setTimeout(r, 20_000));
      expect(s.events.list({ limit: 100_000 }).filter((e) => e.seq > at && e.event.type === 'task.changed' && e.event.change === 'started')).toHaveLength(0);
    } finally {
      stop();
      await engine.shutdown();
      await api.close();
      s.cleanup();
    }
  }, 1_900_000);
});
