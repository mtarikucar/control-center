import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OWNER, type Plan } from '@cc/shared';
import { createApi } from '../src/api.ts';
import { Company } from '../src/company/company.ts';
import { Dispatcher } from '../src/company/dispatcher.ts';
import { NoticeStore, PlanStore, TaskStore } from '../src/company/store.ts';
import { Engine } from '../src/engine.ts';
import { TokenRegistry } from '../src/mcp/tokens.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { QuotaTracker } from '../src/quota.ts';
import { setup, until, waitFor } from './helpers.ts';

const enabled = process.env.OFFICE_SMOKE === '1';

describe.skipIf(!enabled)('company with the real claude CLI (coordinator on sonnet, a hired writer)', () => {
  it('need → plan card → approval → hire and task → handed in', async () => {
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
    const company = new Company({ roster: s.roster, events: s.events, tasks, plans, notices, dataDir: s.dataDir, hire: (i) => engine.hire(i), characters, memory, reload: (id) => engine.reload(id) });
    const api = createApi(
      { engine, roster: s.roster, events: s.events, quota: new QuotaTracker(s.db, s.events), mcp: { tokens, tools: officeTools({ company, roster: s.roster, tasks, characters, memory }) }, company: { service: company, tasks, plans, memory } },
      { allowedOrigins: [] },
    );
    await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(api.server.address() as AddressInfo).port}/mcp`;
    const stop = new Dispatcher({ events: s.events, roster: s.roster, tasks, notices, plans, company, engine }).start();
    try {
      const coordinator = company.hireCoordinator('sonnet');
      engine.send(
        coordinator.id,
        'Ofis klasörüne NOTES.md adında, ofisin ne olduğunu iki cümleyle anlatan bir dosya yazdırmak istiyorum. Önce planPropose ile bir plan kartı aç. Onaydan sonra işi kendin yapma: hire ile haiku modelli bir yazar al ve görevi ona ver. Seçtiğin yaklaşımı decisionRecord ile karar defterine de kaydet.',
      );
      const proposed = await waitFor(s.events, (e) => e.event.type === 'plan.changed' && e.event.change === 'proposed', { timeoutMs: 300_000 });
      const plan = (proposed.event as { plan: Plan }).plan;
      company.approve(plan.id);
      const created = await waitFor(s.events, (e) => e.event.type === 'task.changed' && e.event.change === 'created', { after: proposed.seq, timeoutMs: 600_000 });
      const finished = await waitFor(s.events, (e) => e.event.type === 'task.changed' && e.event.change === 'finished', { after: created.seq, timeoutMs: 900_000 });
      const writer = s.roster.list().find((e) => e.id !== coordinator.id);
      expect(writer, 'the coordinator hired someone').toBeDefined();
      expect((finished.event as { task: { assignee: string; result: { summary: string } | null } }).task).toMatchObject({ assignee: writer!.id });
      const handed = (finished.event as { task: { id: string; result: { archive?: string } | null } }).task;
      expect(handed.result?.archive, 'the hand-in was archived').toMatch(/^company\/archive\//);
      expect(existsSync(join(s.dataDir, handed.result!.archive!, 'teslim.md'))).toBe(true);
      await waitFor(s.events, (e) => e.event.type === 'decision.recorded', { timeoutMs: 300_000 });
      // The owner lets the writer go: a hand-over first, then the office fires them.
      company.beginHandover(writer!.id);
      await until(() => s.roster.get(writer!.id).lifecycle === 'archived', 600_000);
      const out = tasks.list({ assignee: writer!.id, statuses: ['done'] }).find((t) => t.kind === 'handover');
      expect(out?.result?.summary, 'the hand-over was handed in').toBeTruthy();
      expect(company.coordinator()?.id).toBe(coordinator.id);
      expect(OWNER).toBe('owner');
    } finally {
      stop();
      await engine.shutdown();
      await api.close();
      s.cleanup();
    }
  }, 1_900_000);
});
