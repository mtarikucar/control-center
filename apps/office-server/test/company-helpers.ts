import { DEFAULT_CONSTITUTION, type QuotaState } from '@cc/shared';
import { Budget } from '../src/company/budget.ts';
import { ConstitutionStore, SpendStore } from '../src/company/budget-store.ts';
import { Company } from '../src/company/company.ts';
import { CompanyStateStore, GoalStore } from '../src/company/goal-store.ts';
import { Memory } from '../src/company/memory.ts';
import { ProposalStore } from '../src/company/proposal-store.ts';
import { DecisionStore, EmployeeNoteStore, NoteStore, PlaybookStore } from '../src/company/memory-store.ts';
import { Scheduling } from '../src/company/scheduling.ts';
import { NoticeStore, PlanStore, ScheduleStore, TaskStore } from '../src/company/store.ts';
import type { FakeEngine } from './engine-helpers.ts';
import type { TestSetup } from './helpers.ts';

/** The company layer over a test setup and a fake engine, wired like main.ts; `now` (optional) is every store's clock. */
export function companyFor(s: TestSetup, f: FakeEngine, characters: string[] = ['coder', 'designer', 'manager'], now?: () => number) {
  const tasks = new TaskStore(s.db, now);
  const plans = new PlanStore(s.db, now);
  const notices = new NoticeStore(s.db, now);
  const schedules = new ScheduleStore(s.db, now);
  const proposals = new ProposalStore(s.db, now);
  const goals = new GoalStore(s.db, now);
  const state = new CompanyStateStore(s.db);
  const memory = new Memory({
    roster: s.roster, events: s.events, notices, tasks, plans, dataDir: s.dataDir,
    decisions: new DecisionStore(s.db, now), playbook: new PlaybookStore(s.db, now), notes: new NoteStore(s.db, now), employeeNotes: new EmployeeNoteStore(s.db, now),
  });
  let quotaState: QuotaState | null = null;
  // The approval flow is what most tests are about (tests of full autonomy set it themselves); written to the store
  // directly so no budget.changed event joins the log (the economy scenario compares the log with main's).
  const constitutionStore = new ConstitutionStore(s.db);
  constitutionStore.set({ autonomy: 'plans' });
  const budget = new Budget({
    constitution: constitutionStore, spend: new SpendStore(s.db, now), tasks, plans, roster: s.roster, events: s.events, notices,
    quota: { state: () => quotaState }, deskCount: 8, now,
  });
  const reloaded: string[] = [];
  // A fake office clock: counts how often a time change asked it to re-arm.
  let touched = 0;
  const clock = { touch: () => void (touched += 1) };
  const company = new Company({
    roster: s.roster, events: s.events, tasks, plans, notices, dataDir: s.dataDir, hire: (i) => f.engine.hire(i), characters: () => characters, memory, constitution: () => budget.constitution(), proposals, goals, state,
    reload: (id) => void reloaded.push(id), schedules, clock, now,
  });
  const scheduling = new Scheduling({ db: s.db, tasks, schedules, notices, company, state, events: s.events, constitution: () => budget.constitution(), now });
  /** A restarted office's due-processor on the same database. */
  const freshScheduling = () => new Scheduling({ db: s.db, tasks, schedules, notices, company, state, events: s.events, constitution: () => budget.constitution(), now });
  /** Makes the return of one task throw (a failing due item for the clock tests). */
  const breakReturnOf = (taskId: string) => {
    const real = company.returnFromPark.bind(company);
    company.returnFromPark = (id: string, at: number) => {
      if (id === taskId) throw new Error('bozuk dönüş');
      return real(id, at);
    };
  };
  return {
    tasks, plans, notices, memory, company, reloaded, budget, proposals, goals, state, schedules, scheduling, freshScheduling, breakReturnOf,
    /** How often the fake clock was touched so far (a function: the tests spread this object, which would freeze a getter). */
    clockTouches: () => touched,
    setQuota: (q: QuotaState | null) => {
      quotaState = q;
    },
  };
}

/** A valid plan method for tests that are not about methods (planPropose requires one, spec §5.1). */
export const METHOD = {
  workType: 'general',
  stages: [
    { name: 'Yap', role: 'çalışan', review: false },
    { name: 'Kontrol', role: 'koordinatör', review: true },
  ],
  checks: ['Bitti tanımı karşılandı'],
} as const satisfies import('@cc/shared').PlanMethod;

/** The owner approves each plan (autonomy 'plans'): for tests about the approval flow, which the default 'free' skips. */
export const PLANS_ONLY = (): import('@cc/shared').Constitution => ({ ...DEFAULT_CONSTITUTION, autonomy: 'plans' });
