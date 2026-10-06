import { Company } from '../src/company/company.ts';
import { Memory } from '../src/company/memory.ts';
import { DecisionStore, EmployeeNoteStore, NoteStore, PlaybookStore } from '../src/company/memory-store.ts';
import { NoticeStore, PlanStore, TaskStore } from '../src/company/store.ts';
import type { FakeEngine } from './engine-helpers.ts';
import type { TestSetup } from './helpers.ts';

/** The company layer over a test setup and a fake engine, wired like main.ts. */
export function companyFor(s: TestSetup, f: FakeEngine, characters: string[] = ['coder', 'designer', 'manager']) {
  const tasks = new TaskStore(s.db);
  const plans = new PlanStore(s.db);
  const notices = new NoticeStore(s.db);
  const memory = new Memory({
    roster: s.roster, events: s.events, notices, tasks, plans, dataDir: s.dataDir,
    decisions: new DecisionStore(s.db), playbook: new PlaybookStore(s.db), notes: new NoteStore(s.db), employeeNotes: new EmployeeNoteStore(s.db),
  });
  const reloaded: string[] = [];
  const company = new Company({
    roster: s.roster, events: s.events, tasks, plans, notices, dataDir: s.dataDir, hire: (i) => f.engine.hire(i), characters: () => characters, memory,
    reload: (id) => void reloaded.push(id),
  });
  return { tasks, plans, notices, memory, company, reloaded };
}
