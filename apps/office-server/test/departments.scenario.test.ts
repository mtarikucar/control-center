import { afterEach, describe, expect, it } from 'vitest';
import { OWNER } from '@cc/shared';
import { Agenda } from '../src/company/agenda.ts';
import { buildBoard } from '../src/company/board.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { QuotaTracker } from '../src/quota.ts';
import { companyFor, METHOD } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

describe('departments — the whole flow (spec §6.2)', () => {
  it('two departments carry a plan’s streams: notices, a stream plan, a reviewed task, a report, a pass between departments, the board, a head let go', async () => {
    const s = setup(12);
    const f = fakeEngine(s);
    cleanups.push(f.cleanup, s.cleanup);
    const c = companyFor(s, f, ['coder', 'designer', 'manager'], undefined, undefined, { departments: true });
    // companyFor's budget counts 8 desks: the fixture stays within them.
    c.budget.setConstitution({ autonomy: 'free', maxEmployees: 8 });
    const departments = c.departments!;
    const coordinator = c.company.hireCoordinator('sonnet');
    const tools = officeTools({
      company: c.company, roster: s.roster, tasks: c.tasks, characters: () => ['coder'], memory: c.memory, budget: c.budget,
      engine: { sleep: async () => undefined, wake: () => undefined, sideQuestion: async () => ({ ok: true, answer: '' }) },
      plans: () => c.plans.list(), agenda: { text: () => '' }, departments,
    });
    const call = async (who: string, name: string, args: Record<string, unknown>) => String(await tools.find((x) => x.name === name)!.run({ employee: s.roster.get(who) } as never, args));
    const said = (id: string) => c.notices.pending(id).map((n) => `${n.topic}: ${n.text}`).join('\n');

    // 1. Two departments from templates, each with a head; a head hires into their own.
    const selin = c.company.hire(coordinator.id, { name: 'Selin', role: 'r' });
    await call(coordinator.id, 'departmentCreate', { template: 'yazilim-otomasyon', head: 'Selin' });
    const yaz = departments.find('Yazılım ve Otomasyon')!;
    const mert = c.company.hire(selin.id, { name: 'Mert', template: 'gelistirici', role: '' });
    const pzr = departments.create(OWNER, { template: 'pazarlama' });
    const pelin = c.company.hire(OWNER, { name: 'Pelin', role: 'r', departmentId: pzr.id, head: true });
    expect(s.roster.get(mert.id)).toMatchObject({ departmentId: yaz.id, reportsTo: selin.id });

    // 2. The coordinator's plan gives a stream to each department.
    const reply = await call(coordinator.id, 'planPropose', {
      title: 'Site', goal: 'Yeni site', approach: 'a', method: METHOD,
      streams: [{ id: 'api', title: 'API', owner: 'departman: Yazılım ve Otomasyon' }, { id: 'tanitim', title: 'Tanıtım', owner: 'Pazarlama', dependsOn: ['api'] }],
    });
    expect(reply).toMatch(/API → Yazılım ve Otomasyon departmanı; Tanıtım → Pazarlama departmanı/);
    const plan = c.plans.list()[0]!;

    // 3. Each head hears its stream; Selin plans hers and opens a reviewed task.
    expect(said(selin.id)).toMatch(/stream\.assigned: “Site” planının “API” akışı \(api\) Yazılım ve Otomasyon departmanının/);
    expect(said(pelin.id)).toMatch(/stream\.assigned: “Site” planının “Tanıtım” akışı \(tanitim\) Pazarlama departmanının/);
    await call(selin.id, 'streamPlan', { planId: plan.id, streamId: 'api', text: 'Uç noktalar, sonra testler.' });
    const created = await call(selin.id, 'taskCreate', { assignee: 'Mert', title: 'Uç noktalar', planId: plan.id, streamId: 'api', reviewer: 'Selin' });
    const taskId = /Görev açıldı: (\S+)/.exec(created)![1]!;

    // 4. Mert hands in, Selin approves: the stream is done, Selin reports.
    c.company.start(taskId);
    c.company.finish(mert.id, taskId, { summary: 'bitti', outputs: [], learned: '' });
    const review = c.tasks.list({ assignee: selin.id }).find((t) => t.kind === 'review')!;
    c.company.reviewDecide(selin.id, review.id, { decision: 'approve' });
    expect(said(selin.id)).toMatch(/stream\.done: “Site” planının “API” akışının açık görevi kalmadı/);
    await call(selin.id, 'streamReport', { planId: plan.id, streamId: 'api', summary: 'Uç noktalar hazır.', evidence: ['pnpm test geçti'], next: 'Tanıtım başlayabilir' });
    expect(said(coordinator.id)).toMatch(/stream\.report: Selin “Site” planının “API” akışını raporladı: Uç noktalar hazır\./);

    // 5. Pazarlama asks Yazılım ve Otomasyon for a form: it reaches Selin.
    expect(await call(pelin.id, 'taskPass', { to: 'Yazılım ve Otomasyon', title: 'İletişim formu' })).toMatch(/Yazılım ve Otomasyon departmanına gitti: başkanı Selin/);
    expect(c.tasks.list({ assignee: selin.id }).find((t) => t.title === 'İletişim formu')!.description).toMatch(/^Yazılım ve Otomasyon departmanına/);

    // 6. The board shows both departments, the finished stream and its report.
    const agenda = new Agenda({ roster: s.roster, tasks: c.tasks, schedules: c.schedules, company: c.company, budget: c.budget });
    const deps = { db: s.db, events: s.events, roster: s.roster, company: c.company, tasks: c.tasks, plans: c.plans, state: c.state, agenda, budget: c.budget, proposals: c.proposals, quota: new QuotaTracker(s.db, s.events), kpis: c.kpis, departments };
    const board = buildBoard(deps, { since: 0, now: Date.now() });
    expect(board.text).toMatch(/- Yazılım ve Otomasyon — başkan Selin · 2 kişi .*akışlar: api \(bitti\).*son rapor: “Uç noktalar hazır\.”/);
    expect(board.text).toMatch(/- Pazarlama — başkan Pelin · 1 kişi .*akışlar: tanitim \(planlı\)/);

    // 7. Selin is let go: her department is headless; its finished stream is not returned; Pazarlama keeps its head.
    s.roster.update(selin.id, { lifecycle: 'archived' });
    c.company.releaseTasksOf(selin.id);
    expect(departments.get(yaz.id).headId).toBeNull();
    expect(s.roster.get(mert.id).reportsTo).toBeNull();
    expect(said(coordinator.id)).not.toMatch(/stream\.returned/);
    expect(departments.get(pzr.id).headId).toBe(pelin.id);
  });
});
