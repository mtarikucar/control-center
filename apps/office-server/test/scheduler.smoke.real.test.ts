import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { OWNER } from '@cc/shared';
import { createApi } from '../src/api.ts';
import { Agenda } from '../src/company/agenda.ts';
import { Clock } from '../src/company/clock.ts';
import { Company } from '../src/company/company.ts';
import { Dispatcher } from '../src/company/dispatcher.ts';
import { CompanyStateStore, GoalStore } from '../src/company/goal-store.ts';
import { dueLabel, Scheduling } from '../src/company/scheduling.ts';
import { NoticeStore, PlanStore, ScheduleStore, TaskStore } from '../src/company/store.ts';
import { Engine } from '../src/engine.ts';
import { TokenRegistry } from '../src/mcp/tokens.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { QuotaTracker } from '../src/quota.ts';
import { setup, until } from './helpers.ts';

const enabled = process.env.OFFICE_SMOKE === '1';

describe.skipIf(!enabled)('the office scheduler with the real claude CLI (coordinator on sonnet)', () => {
  it('the coordinator parks a waiting task → its slot is free and the next task is delivered → the clock brings the parked one back at its time', { timeout: 900_000 }, async () => {
    const s = setup();
    const tokens = new TokenRegistry();
    let url = '';
    const engine = new Engine({ roster: s.roster, events: s.events, dataDir: s.dataDir, claudeCommand: ['claude'], mcp: { url: () => url, tokens } });
    const tasks = new TaskStore(s.db);
    const plans = new PlanStore(s.db);
    const notices = new NoticeStore(s.db);
    const schedules = new ScheduleStore(s.db);
    const characters = () => ['coder', 'designer'];
    const { DecisionStore, EmployeeNoteStore, NoteStore, PlaybookStore } = await import('../src/company/memory-store.ts');
    const { Memory } = await import('../src/company/memory.ts');
    const memory = new Memory({ roster: s.roster, events: s.events, notices, tasks, plans, dataDir: s.dataDir, decisions: new DecisionStore(s.db), playbook: new PlaybookStore(s.db), notes: new NoteStore(s.db), employeeNotes: new EmployeeNoteStore(s.db) });
    const { Budget } = await import('../src/company/budget.ts');
    const { ConstitutionStore, SpendStore } = await import('../src/company/budget-store.ts');
    const quota = new QuotaTracker(s.db, s.events);
    const constitutionStore = new ConstitutionStore(s.db);
    // Full autonomy: nothing here waits for the owner's approval.
    constitutionStore.set({ autonomy: 'free' });
    const budget = new Budget({ constitution: constitutionStore, spend: new SpendStore(s.db), tasks, plans, roster: s.roster, events: s.events, notices, quota, deskCount: 8 });
    const { ProposalStore } = await import('../src/company/proposal-store.ts');
    const proposals = new ProposalStore(s.db);
    const goals = new GoalStore(s.db);
    const state = new CompanyStateStore(s.db);
    const company = new Company({ roster: s.roster, events: s.events, tasks, plans, notices, dataDir: s.dataDir, hire: (i) => engine.hire(i), characters, memory, reload: (id) => engine.reload(id), constitution: () => budget.constitution(), proposals, goals, state, schedules });
    // Wired as in main.ts; the safety tick is 5 s so a return is never late by more than that.
    const scheduling = new Scheduling({ db: s.db, tasks, schedules, notices, company, state, events: s.events, constitution: () => budget.constitution() });
    const clock = new Clock({ scheduling, state, events: s.events, label: (now) => dueLabel(tasks, schedules, company, now), safetyMs: 5_000 });
    company.attachClock(clock);
    const agenda = new Agenda({ roster: s.roster, tasks, schedules, company, budget, clock });
    const api = createApi(
      { engine, roster: s.roster, events: s.events, quota, mcp: { tokens, tools: officeTools({ company, roster: s.roster, tasks, characters, memory, budget, engine, plans: () => plans.list(), agenda }) }, company: { service: company, tasks, plans, memory, budget, proposals, clock, agenda } },
      { allowedOrigins: [] },
    );
    await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(api.server.address() as AddressInfo).port}/mcp`;
    const stopDispatcher = new Dispatcher({ events: s.events, roster: s.roster, tasks, notices, plans, company, engine, budget, clock }).start();
    const stopClock = clock.start();
    // The database lives in memory: what happened is printed before it goes, passed or not.
    const time = (ms: number) => new Date(ms).toLocaleTimeString('tr-TR');
    const short = (text: string) => text.replace(/\s+/g, ' ').slice(0, 240);
    const journal = () =>
      s.events
        .list({ limit: 100_000 })
        .flatMap(({ ts, event: e }) => {
          if (e.type === 'task.changed') return [`${time(ts)} görev ${e.change} “${e.task.title}” → ${e.task.status}${e.task.notBefore ? ` (dönüş ${time(e.task.notBefore)})` : ''}`];
          if (e.type === 'tool.started') return [`${time(ts)} araç ${e.name} ${short(JSON.stringify(e.input))}`];
          if (e.type === 'tool.finished') return [`${time(ts)}   ${e.isError ? 'HATA ' : ''}${short(e.output)}`];
          if (e.type === 'message.assistant') return [`${time(ts)} yanıt ${short(e.text)}`];
          if (e.type === 'turn.finished') return [`${time(ts)} tur bitti ${e.subtype} ${e.numTurns} adım $${e.costUsd.toFixed(4)}`];
          if (e.type === 'clock.error' || e.type === 'error') return [`${time(ts)} ${e.type} ${short(JSON.stringify(e))}`];
          return [];
        })
        .join('\n');
    try {
      const coordinator = company.hireCoordinator('sonnet');
      engine.send(
        coordinator.id,
        'Bir ölçüm penceresi beklememiz gerekiyor: "Adım 1 penceresi" adıyla kendine bir görev aç, sonra o görevi taskPark ile +2m sonrasına "pencere dolsun" gerekçesiyle park et ve bana park ettiğini tek cümleyle yaz. Başka bir şey yapma.',
        'owner',
      );
      await until(() => tasks.list({ assignee: coordinator.id, statuses: ['parked'] }).length === 1, 300_000);
      const parked = tasks.list({ assignee: coordinator.id, statuses: ['parked'] })[0]!;
      expect(parked.parkedReason).toContain('pencere');
      // The slot is free: a second task is delivered at once.
      const other = company.createTask(OWNER, { assignee: coordinator.id, title: 'Sıradaki iş: tek kelimeyle "tamam" diye teslim et' });
      await until(() => tasks.get(other.id).status !== 'waiting', 300_000);
      // The clock brings the parked task back at its time and the coordinator gets it.
      await until(() => tasks.get(parked.id).status !== 'parked', 300_000);
      expect(['waiting', 'in_progress', 'done']).toContain(tasks.get(parked.id).status);
      console.log(`\nscheduler smoke: parked “${parked.title}” (${parked.parkedReason}) returned as ${tasks.get(parked.id).status}\n`);
    } finally {
      console.log(`\nscheduler smoke journal:\n${journal()}\n`);
      stopClock();
      stopDispatcher();
      await engine.shutdown();
      await api.close();
      s.cleanup();
    }
  });
});
