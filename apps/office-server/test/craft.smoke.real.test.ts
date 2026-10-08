import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OWNER, type Plan } from '@cc/shared';
import { createApi } from '../src/api.ts';
import { Agenda } from '../src/company/agenda.ts';
import { Company } from '../src/company/company.ts';
import { Dispatcher } from '../src/company/dispatcher.ts';
import { SearchIndex } from '../src/company/search.ts';
import { NoticeStore, PlanStore, ScheduleStore, TaskStore } from '../src/company/store.ts';
import { Engine } from '../src/engine.ts';
import { TokenRegistry } from '../src/mcp/tokens.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { QuotaTracker } from '../src/quota.ts';
import { setup, until, waitFor } from './helpers.ts';

const enabled = process.env.OFFICE_SMOKE === '1';

describe.skipIf(!enabled)('the coordination craft with the real claude CLI (coordinator on sonnet)', () => {
  it('a non-software need → a plan with a method → a writer and a separate reviewer → closed only on approval, with evidence', async () => {
    const s = setup();
    const tokens = new TokenRegistry();
    let url = '';
    const engine = new Engine({ roster: s.roster, events: s.events, dataDir: s.dataDir, claudeCommand: ['claude'], mcp: { url: () => url, tokens } });
    const index = new SearchIndex(s.db);
    const tasks = new TaskStore(s.db, Date.now, index);
    const plans = new PlanStore(s.db);
    const notices = new NoticeStore(s.db);
    const characters = () => ['coder', 'designer'];
    const { DecisionStore, EmployeeNoteStore, NoteStore, PlaybookStore } = await import('../src/company/memory-store.ts');
    const { Memory } = await import('../src/company/memory.ts');
    const memory = new Memory({ roster: s.roster, events: s.events, notices, tasks, plans, dataDir: s.dataDir, index, decisions: new DecisionStore(s.db, Date.now, index), playbook: new PlaybookStore(s.db, Date.now, index), notes: new NoteStore(s.db, Date.now, index), employeeNotes: new EmployeeNoteStore(s.db) });
    const { Budget } = await import('../src/company/budget.ts');
    const { ConstitutionStore, SpendStore } = await import('../src/company/budget-store.ts');
    const quota = new QuotaTracker(s.db, s.events);
    const constitutionStore = new ConstitutionStore(s.db);
    // This scenario is about the owner's approval: each plan waits for it.
    constitutionStore.set({ autonomy: 'plans' });
    const budget = new Budget({ constitution: constitutionStore, spend: new SpendStore(s.db), tasks, plans, roster: s.roster, events: s.events, notices, quota, deskCount: 8 });
    const { ProposalStore } = await import('../src/company/proposal-store.ts');
    const proposals = new ProposalStore(s.db);
    const company = new Company({ roster: s.roster, events: s.events, tasks, plans, notices, dataDir: s.dataDir, hire: (i) => engine.hire(i), characters, memory, reload: (id) => engine.reload(id), constitution: () => budget.constitution(), proposals });
    const api = createApi(
      { engine, roster: s.roster, events: s.events, quota, mcp: { tokens, tools: officeTools({ company, roster: s.roster, tasks, characters, memory, budget, engine, plans: () => plans.list(), agenda: new Agenda({ roster: s.roster, tasks, schedules: new ScheduleStore(s.db), company, budget }) }) }, company: { service: company, tasks, plans, memory, budget, proposals } },
      { allowedOrigins: [] },
    );
    await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(api.server.address() as AddressInfo).port}/mcp`;
    const stop = new Dispatcher({ events: s.events, roster: s.roster, tasks, notices, plans, company, engine }).start();
    try {
      // A need that is not software: the coordinator plans it as content, with someone other than the writer checking it.
      const coordinator = company.hireCoordinator('sonnet');
      engine.send(
        coordinator.id,
        'Ofis yazılımımız için tek paragraflık kısa bir tanıtım metni istiyorum (metin.md). Bir yazar ve ayrı bir editör işe al (ikisi de haiku); metni yazar yazsın, editör kontrol etsin. Bana sormadan plan kartını öner.',
      );
      const proposed = await waitFor(s.events, (e) => e.event.type === 'plan.changed' && e.event.change === 'proposed', { timeoutMs: 300_000 });
      const plan = (proposed.event as { plan: Plan }).plan;
      expect(plan.method?.workType, 'a content plan').toBe('content');
      expect(plan.method?.stages.some((st) => st.review), 'a reviewed stage').toBe(true);
      company.approve(plan.id);
      // The coordinator opens the writing task with the editor as its reviewer.
      await until(() => tasks.list({ planId: plan.id }).some((t) => t.kind === 'work' && Boolean(t.reviewer)), 600_000);
      const work = tasks.list({ planId: plan.id }).find((t) => t.kind === 'work' && Boolean(t.reviewer))!;
      expect(work.reviewer).not.toBe(work.assignee);
      // It closes only after a review task by someone else was approved.
      await until(() => tasks.get(work.id).status === 'done', 900_000);
      const reviews = tasks.list({ planId: plan.id }).filter((t) => t.kind === 'review' && t.reviewOf === work.id);
      const approved = reviews.find((r) => r.result?.review?.decision === 'approve');
      expect(approved, 'an approved review').toBeTruthy();
      expect(approved!.assignee).not.toBe(work.assignee);
      expect(tasks.get(work.id).finishedAt!).toBeGreaterThanOrEqual(approved!.finishedAt!);
      expect(tasks.get(work.id).result?.evidence?.length ?? 0).toBeGreaterThanOrEqual(work.done.length);
      console.log(
        `\ncraft smoke: plan ${plan.method?.workType} ${plan.method?.stages.map((st) => `${st.name}${st.review ? '*' : ''}`).join(' → ')}; ` +
          `${reviews.length} review round(s): ${reviews.map((r) => r.result?.summary).join(' | ')}\n`,
      );
      expect(OWNER).toBe('owner');
    } finally {
      stop();
      await engine.shutdown();
      await api.close();
      s.cleanup();
    }
  }, 1_900_000);
});
