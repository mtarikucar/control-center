# Office Scheduler Implementation Plan (part 2 of 2: Tasks 5–9)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Part 1 (goal, architecture, constraints, rulings, review focus, file structure, Tasks 1–4) is `2026-10-07-office-scheduler.md`; its Global Constraints and Spec rulings apply to every task here.

**Spec:** `docs/superpowers/specs/2026-10-07-office-scheduler-design.md`.

---

### Task 5: Tools and owner API for park, start time, due date

**Files:**
- Modify: `apps/office-server/src/mcp/tools.ts`, `apps/office-server/src/api.ts`
- Test: `apps/office-server/test/mcp-tools.test.ts`, `apps/office-server/test/company-api.test.ts`

**Interfaces:**
- Consumes: `Company.parkTask / unparkTask / ownerPrioritize`, `TaskInput.startAfter / dueAt` (Task 3); `formatWhen` (Task 2).
- Produces: MCP tools `taskPark(taskId, until, reason)` (everyone), `taskUnpark(taskId)` (leads + coordinator); `taskCreate`/`taskPass` args `startAfter`, `dueAt`; routes `POST /api/tasks/:id/park {until, reason}`, `POST /api/tasks/:id/release`, `POST /api/tasks/:id/prioritize`; `TASK_ROUTE` regex.

- [ ] **Step 1: Write the failing tests**

In `apps/office-server/test/mcp-tools.test.ts`: in the first test add `'taskPark'` to the member list (alphabetical, after `'taskFinish'`) and `'taskUnpark'` to the lead list (after `'taskReprioritize'`); append:

```ts
  it('taskPark sets a task aside with a reason and says when it returns; taskUnpark brings it back', async () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const task = t.company.createTask(c.id, { assignee: ada.id, title: 'Pencere' });
    t.company.start(task.id);
    const reply = await t.call(ada, 'taskPark', { taskId: task.id, until: '+6h', reason: 'ölçüm penceresi dolsun' });
    expect(reply).toMatch(/ertelendi/);
    expect(reply).toMatch(/\d\d:\d\d/);
    expect(t.tasks.get(task.id)).toMatchObject({ status: 'parked', parkedReason: 'ölçüm penceresi dolsun' });
    await expect(Promise.resolve().then(() => t.call(ada, 'taskPark', { taskId: task.id, until: 'yarın', reason: 'x' }))).rejects.toThrow(/Dönüş saati/);
    await expect(Promise.resolve().then(() => t.call(ada, 'taskUnpark', { taskId: task.id }))).rejects.toThrow(/closed/);
    expect(await t.call(c, 'taskUnpark', { taskId: task.id })).toMatch(/sıraya döndü/);
    expect(t.tasks.get(task.id).status).toBe('waiting');
  });

  it('taskCreate and taskPass take a start time and a due date', async () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const can = t.company.hire(OWNER, { name: 'Can', role: 'r' });
    expect(await t.call(c, 'taskCreate', { assignee: 'Ada', title: 'Sonra', startAfter: '+1d', dueAt: '+3d' })).toMatch(/başlangıç/);
    const created = t.tasks.list({ assignee: ada.id })[0]!;
    expect(created.notBefore).toBeGreaterThan(Date.now());
    expect(created.dueAt).toBeGreaterThan(created.notBefore!);
    await t.call(ada, 'taskPass', { to: 'Can', title: 'Takip', startAfter: '+2h' });
    expect(t.tasks.list({ assignee: can.id })[0]!.notBefore).toBeGreaterThan(Date.now());
    await expect(Promise.resolve().then(() => t.call(c, 'taskCreate', { assignee: 'Ada', title: 'X', dueAt: '+400d' }))).rejects.toThrow(/Son tarih/);
  });
```

In `apps/office-server/test/company-api.test.ts` append:

```ts
  it('review focus: the owner parks, releases and prioritizes from the sheet; running, reviewing and hand-over tasks refuse a release', async () => {
    const t = await start();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const can = t.company.hire(OWNER, { name: 'Can', role: 'r' });
    const a = t.company.createTask(c.id, { assignee: ada.id, title: 'A' });
    const parked = await call(t.port, 'POST', `/api/tasks/${a.id}/park`, { until: '+1d', reason: 'yarına' });
    expect(parked.body).toMatchObject({ id: a.id, status: 'parked', parkedReason: 'yarına' });
    expect((await call(t.port, 'POST', `/api/tasks/${a.id}/park`, { until: 'dün', reason: 'x' })).status).toBe(400);
    const released = await call(t.port, 'POST', `/api/tasks/${a.id}/release`);
    expect(released.body).toMatchObject({ id: a.id, status: 'waiting', notBefore: null, priority: 1 });
    const b = t.company.createTask(c.id, { assignee: ada.id, title: 'B' });
    expect((await call(t.port, 'POST', `/api/tasks/${b.id}/prioritize`, { priority: 1 })).body.priority).toBe(1);
    t.company.start(b.id);
    expect((await call(t.port, 'POST', `/api/tasks/${b.id}/release`)).status).toBe(409);
    const r = t.company.createTask(c.id, { assignee: ada.id, title: 'R', reviewer: can.id });
    t.company.finish(ada.id, r.id, { summary: 'bitti', outputs: [], learned: '' });
    expect((await call(t.port, 'POST', `/api/tasks/${r.id}/release`)).status).toBe(409);
    expect((await call(t.port, 'POST', `/api/tasks/${r.id}/park`, { until: '+1h', reason: 'x' })).status).toBe(409);
    const h = t.company.beginHandover(can.id);
    expect((await call(t.port, 'POST', `/api/tasks/${h.id}/release`)).status).toBe(409);
    expect((await call(t.port, 'POST', '/api/tasks/00000000-0000-0000-0000-000000000000/release')).status).toBe(404);
    const heard = t.notices.pending(c.id).filter((n) => n.topic === 'agenda.owner_changed');
    expect(heard.length).toBe(3);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/office-server && npx vitest run test/mcp-tools.test.ts test/company-api.test.ts`
Expected: FAIL — no `taskPark` tool; `/api/tasks/...` 404.

- [ ] **Step 3: Tools**

In `apps/office-server/src/mcp/tools.ts`: import `formatWhen` from `../company/time.ts`. Add after `reviewer`:

```ts
const until = s('When: relative (+30m, +6h, +1d) or a local time (2026-10-08T14:55).');
const startAfter = { ...until, description: 'Do not hand this out before this time: relative (+6h, +1d) or a local time (2026-10-08T14:55). For follow-ups and waiting periods.' };
const dueAt = { ...until, description: 'Should be done by this time (same forms). Nearer due dates go first within a priority; the coordinator hears once when it passes.' };
```

`taskPass` schema gains `startAfter, dueAt`; its `input` gains `startAfter: optStr(args, 'startAfter'), dueAt: optStr(args, 'dueAt')`. `taskCreate` the same. After `taskFinish` (before `reviewDecide`) add:

```ts
    {
      name: 'taskPark',
      description:
        'Set a task aside until a time, with a reason — your own task, or (coordinator, lead) one you manage. It stays open but frees the slot: the office hands out the next task meanwhile and brings this one back at the time. Use it for waiting periods (a measurement window, an answer you wait for) instead of keeping the task open. The third park of the same task tells the coordinator.',
      inputSchema: object({ taskId: s('The task id.'), until, reason: s('Why it waits (shown in the agenda).') }, ['taskId', 'until', 'reason']),
      kinds: EVERYONE,
      run: ({ employee }, args) => {
        const task = company.parkTask(employee.id, str(args, 'taskId'), str(args, 'until'), str(args, 'reason'));
        return `“${task.title}” ertelendi: ${formatWhen(task.notBefore ?? Date.now(), Date.now())} saatinde sırana geri gelecek. Sıran boş; ofis sıradaki işini verir.`;
      },
    },
    {
      name: 'taskUnpark',
      description: 'Bring a parked or start-timed task back to the queue now (coordinator; lead for their team).',
      inputSchema: object({ taskId: s('The task id.') }, ['taskId']),
      kinds: LEADS,
      run: ({ employee }, args) => {
        const task = company.unparkTask(employee.id, str(args, 'taskId'));
        return `“${task.title}” sıraya döndü (öncelik ${task.priority}).`;
      },
    },
```

`taskCreate`'s reply gains the times: after `const task = company.createTask(...)`:

```ts
        const when = [task.notBefore ? `başlangıç ${formatWhen(task.notBefore, Date.now())}` : '', task.dueAt ? `son tarih ${formatWhen(task.dueAt, Date.now())}` : ''].filter(Boolean).join(', ');
        return `Görev açıldı: ${task.id} “${task.title}” → ${to.name}${when ? ` (${when})` : ''}.`;
```

- [ ] **Step 4: API**

In `apps/office-server/src/api.ts` add

```ts
const TASK_ROUTE = /^\/api\/tasks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(park|release|prioritize)$/;
```

and inside the `if (d.company)` block, after the goal route:

```ts
    const taskAction = TASK_ROUTE.exec(url.pathname);
    if (method === 'POST' && taskAction) {
      const id = taskAction[1] ?? '';
      const body = (await readJson(req)) as { until?: unknown; reason?: unknown; priority?: unknown } | null;
      if (taskAction[2] === 'park') {
        return sendJson(res, 200, company.parkTask(OWNER, id, typeof body?.until === 'string' ? body.until : '', typeof body?.reason === 'string' && body.reason.trim() ? body.reason : 'Sahibi erteledi'));
      }
      if (taskAction[2] === 'release') return sendJson(res, 200, company.unparkTask(OWNER, id, { priority: 1 }));
      return sendJson(res, 200, company.ownerPrioritize(id));
    }
```

(`prioritize`'s body `priority` is accepted for forward compatibility but the owner's button always means 1: ignore it.)

- [ ] **Step 5: Run the suite**

Run: `cd apps/office-server && npx vitest run > /tmp/cc-sched-t5.log 2>&1; tail -8 /tmp/cc-sched-t5.log; cd ../.. && pnpm -r --if-present typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/office-server/src apps/office-server/test
git commit -m "feat(company): taskPark and taskUnpark, start times and due dates on tasks, and the owner's park/release/prioritize routes"
```

---

### Task 6: Routines

**Files:**
- Modify: `apps/office-server/src/company/company.ts` (schedules CRUD; `releaseTasksOf`, `stopPlan` effects), `apps/office-server/src/company/scheduling.ts` (`runSchedules`), `apps/office-server/src/company/notices.ts`, `apps/office-server/src/mcp/tools.ts`, `apps/office-server/src/api.ts`, `apps/office-server/src/main.ts`
- Test: `apps/office-server/test/schedules.test.ts` (new), `apps/office-server/test/mcp-tools.test.ts`, `apps/office-server/test/company-api.test.ts`

**Interfaces:**
- Consumes: `ScheduleStore` (Task 1), `parseCron / nextCron / cronLabel / minIntervalMinutes / parseUntil / formatWhen` (Task 2), `Scheduling` (Task 3/4).
- Produces: `Company.createSchedule(by, input: ScheduleInput): Schedule` with `ScheduleInput = { title: string; description?: string; done?: string[]; assignee: string; cron: string; reviewer?: string | null; planId?: string | null; priority?: number; difficulty?: TaskDifficulty | null; until?: string | null }`; `Company.updateSchedule(by, id, patch: { status?: string; cron?: string; assignee?: string; title?: string; description?: string; done?: string[]; reviewer?: string | null; priority?: number; difficulty?: TaskDifficulty | null; until?: string | null }): Schedule`; `Company.schedules(): Schedule[]` (active + paused, then the last 10 stopped); `Company.ownerSchedule(id, action: 'pause' | 'resume' | 'stop'): Schedule`; `Scheduling.runSchedules` fires routines; notice topics `schedule.skipped`, `schedule.failed`, `schedule.unassigned` (decision); events `schedule.changed`; tools `scheduleCreate`, `scheduleList`, `scheduleUpdate` (LEADS); routes `POST /api/schedules/:id/(pause|resume|stop)`; snapshot `schedules`.

- [ ] **Step 1: Write the failing tests**

Create `apps/office-server/test/schedules.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER } from '@cc/shared';
import { companyFor, METHOD } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const T0 = new Date(2026, 9, 7, 14, 10).getTime(); // Wednesday
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function make() {
  let clock = T0;
  const now = () => clock;
  const s = setup(8, now);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, undefined, now);
  const coordinator = c.company.hireCoordinator('sonnet');
  const ada = c.company.hire(coordinator.id, { name: 'Ada', role: 'r', team: 'Ops' });
  const can = c.company.hire(coordinator.id, { name: 'Can', role: 'r', team: 'Ops' });
  const plan = c.company.propose(coordinator.id, { title: 'P', goal: 'g', approach: 'a', method: METHOD });
  c.company.approve(plan.id);
  const daily = () => c.company.createSchedule(coordinator.id, { title: 'Günlük ölçüm', description: 'economy-report çalıştır', done: ['rapor notlarda'], assignee: ada.id, cron: '0 9 * * *', reviewer: can.id, planId: plan.id, priority: 2, difficulty: 'easy' });
  return { ...s, ...c, coordinator, ada, can, plan, daily, advance: (ms: number) => (clock += ms), set: (ms: number) => (clock = ms) };
}

describe('routines (spec §4.4)', () => {
  it('creates a routine with its next run computed in local time, and refuses bad input in Turkish', () => {
    const t = make();
    const s = t.daily();
    expect(s).toMatchObject({ status: 'active', skipCount: 0, failCount: 0, reviewer: t.can.id, planId: t.plan.id, priority: 2, difficulty: 'easy' });
    expect(s.nextRunAt).toBe(new Date(2026, 9, 8, 9, 0).getTime());
    expect(t.touched).toBeGreaterThan(0);
    expect(() => t.company.createSchedule(t.coordinator.id, { title: 'X', assignee: t.ada.id, cron: '0 9 * *' })).toThrow(/5 alan/);
    expect(() => t.company.createSchedule(t.coordinator.id, { title: 'X', assignee: t.ada.id, cron: '*/5 * * * *' })).toThrow(/en az 60 dk/);
    expect(() => t.company.createSchedule(t.coordinator.id, { title: 'X', assignee: t.ada.id, cron: '0 9 * * *', reviewer: t.ada.id })).toThrow(/kendi işinin inceleyicisi/);
    expect(() => t.company.createSchedule(t.coordinator.id, { title: 'X', assignee: t.ada.id, cron: '0 9 * * *', until: '-1d' })).toThrow(/Bitiş/);
    expect(() => t.company.createSchedule(t.ada.id, { title: 'X', assignee: t.can.id, cron: '0 9 * * *' })).toThrow(/Yalnız koordinatör|Ekip lideri/);
    t.budget.setConstitution({ maxSchedules: 1 });
    expect(() => t.company.createSchedule(t.coordinator.id, { title: 'Y', assignee: t.ada.id, cron: '0 10 * * *' })).toThrow(/En fazla 1 rutin/);
  });

  it('fires at its time: an ordinary task with the routine’s fields opens, the next run moves on, and the event says so', () => {
    const t = make();
    const s = t.daily();
    t.set(new Date(2026, 9, 8, 9, 0).getTime());
    const report = t.scheduling.runDue();
    expect(report.fired).toEqual([s.id]);
    const task = t.tasks.list({ assignee: t.ada.id })[0]!;
    expect(task).toMatchObject({ title: 'Günlük ölçüm — bugün 09:00', description: 'economy-report çalıştır', done: ['rapor notlarda'], reviewer: t.can.id, planId: t.plan.id, priority: 2, difficulty: 'easy', scheduleId: s.id, requester: t.coordinator.id, status: 'waiting' });
    const after = t.schedules.get(s.id);
    expect(after.nextRunAt).toBe(new Date(2026, 9, 9, 9, 0).getTime());
    expect(after).toMatchObject({ lastRunAt: new Date(2026, 9, 8, 9, 0).getTime(), lastTaskId: task.id });
    expect(t.events.list({ limit: 500 }).some((e) => e.event.type === 'schedule.changed' && e.event.change === 'fired')).toBe(true);
    expect(t.scheduling.runDue().fired).toEqual([]);
  });

  it('pile-up brake: no new instance while the previous one is open; the third skip tells the coordinator', () => {
    const t = make();
    const s = t.daily();
    t.set(new Date(2026, 9, 8, 9, 0).getTime());
    t.scheduling.runDue();
    for (let day = 9; day <= 11; day += 1) {
      t.set(new Date(2026, 9, day, 9, 0).getTime());
      expect(t.scheduling.runDue().skipped).toEqual([s.id]);
    }
    expect(t.schedules.get(s.id).skipCount).toBe(3);
    expect(t.tasks.list({ assignee: t.ada.id })).toHaveLength(1);
    expect(t.notices.pending(t.coordinator.id).filter((n) => n.topic === 'schedule.skipped')).toHaveLength(1);
    expect(t.schedules.get(s.id).nextRunAt).toBe(new Date(2026, 9, 12, 9, 0).getTime());
  });

  it('single catch-up: after a week closed, one task opens and the next run is after now', () => {
    const t = make();
    const s = t.daily();
    t.set(new Date(2026, 9, 15, 12, 0).getTime());
    expect(t.freshScheduling().runDue().fired).toEqual([s.id]);
    expect(t.tasks.list({ assignee: t.ada.id })).toHaveLength(1);
    expect(t.schedules.get(s.id).nextRunAt).toBe(new Date(2026, 9, 16, 9, 0).getTime());
  });

  it('while the company is paused routines wait; on resume, one catch-up', () => {
    const t = make();
    const s = t.daily();
    t.company.pause();
    t.set(new Date(2026, 9, 10, 12, 0).getTime());
    expect(t.scheduling.runDue().fired).toEqual([]);
    expect(t.tasks.list({ assignee: t.ada.id })).toHaveLength(0);
    t.company.resume();
    expect(t.scheduling.runDue().fired).toEqual([s.id]);
    expect(t.tasks.list({ assignee: t.ada.id })).toHaveLength(1);
  });

  it('review focus: a let-go assignee pauses the routine with a notice; a stopped plan stops it; neither fires again even if due', () => {
    const t = make();
    const s = t.daily();
    const other = t.company.createSchedule(t.coordinator.id, { title: 'Haftalık', assignee: t.can.id, cron: '0 10 * * 1', planId: t.plan.id });
    t.set(new Date(2026, 9, 8, 9, 30).getTime());
    t.company.releaseTasksOf(t.ada.id);
    expect(t.schedules.get(s.id).status).toBe('paused');
    expect(t.notices.pending(t.coordinator.id).find((n) => n.topic === 'schedule.unassigned')?.text).toContain('Günlük ölçüm');
    expect(t.scheduling.runDue().fired).toEqual([]);
    t.company.stopPlan(t.plan.id);
    expect(t.schedules.get(other.id).status).toBe('stopped');
    expect(t.schedules.get(s.id).status).toBe('stopped');
    t.set(new Date(2026, 9, 12, 10, 0).getTime());
    expect(t.scheduling.runDue().fired).toEqual([]);
  });

  it('the until date stops the routine; update changes cron, assignee and status; the owner pauses, resumes and stops', () => {
    const t = make();
    const s = t.company.createSchedule(t.coordinator.id, { title: 'Kısa', assignee: t.ada.id, cron: '0 9 * * *', until: '+1d' });
    t.set(new Date(2026, 9, 9, 9, 0).getTime());
    expect(t.scheduling.runDue().fired).toEqual([]);
    expect(t.schedules.get(s.id).status).toBe('stopped');
    const w = t.company.createSchedule(t.coordinator.id, { title: 'Haftalık', assignee: t.ada.id, cron: '0 10 * * 1' });
    const changed = t.company.updateSchedule(t.coordinator.id, w.id, { cron: '0 11 * * 2', assignee: t.can.id });
    expect(changed).toMatchObject({ cron: '0 11 * * 2', assignee: t.can.id });
    expect(changed.nextRunAt).toBe(new Date(2026, 9, 13, 11, 0).getTime());
    expect(t.company.ownerSchedule(w.id, 'pause').status).toBe('paused');
    expect(t.company.ownerSchedule(w.id, 'resume').status).toBe('active');
    expect(t.company.ownerSchedule(w.id, 'stop').status).toBe('stopped');
    expect(() => t.company.ownerSchedule(w.id, 'resume')).toThrow(/durduruldu/);
    expect(t.notices.pending(t.coordinator.id).filter((n) => n.topic === 'agenda.owner_changed')).toHaveLength(3);
    expect(t.company.schedules().map((x) => x.title)).toEqual(['Kısa', 'Haftalık']);
    expect(OWNER).toBe('owner');
  });

  it('three failed firings pause the routine and tell the coordinator', () => {
    const t = make();
    const s = t.daily();
    t.roster.update(t.can.id, { lifecycle: 'archived' }); // the reviewer is gone: createTask refuses the reviewer
    for (let day = 8; day <= 10; day += 1) {
      t.set(new Date(2026, 9, day, 9, 0).getTime());
      expect(t.scheduling.runDue().errors.length).toBe(1);
    }
    expect(t.schedules.get(s.id)).toMatchObject({ status: 'paused', failCount: 3 });
    expect(t.notices.pending(t.coordinator.id).some((n) => n.topic === 'schedule.failed')).toBe(true);
  });
});
```

In `apps/office-server/test/mcp-tools.test.ts`: lead list gains `'scheduleCreate', 'scheduleList', 'scheduleUpdate'` (alphabetical, after `'reviewDecide'`? — `scheduleCreate` sorts after `reviewDecide`; keep the arrays sorted as the test compares sorted names); append:

```ts
  it('scheduleCreate, scheduleList and scheduleUpdate run routines; the list says the cron in Turkish', async () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const reply = await t.call(c, 'scheduleCreate', { title: 'Günlük ölçüm', assignee: 'Ada', cron: '0 9 * * *', done: ['rapor'] });
    expect(reply).toMatch(/her gün 09:00/);
    const id = t.schedules.list()[0]!.id;
    expect(await t.call(c, 'scheduleList')).toContain('her gün 09:00');
    expect(await t.call(c, 'scheduleUpdate', { scheduleId: id, status: 'paused' })).toMatch(/duraklatıldı/);
    expect(t.schedules.get(id).status).toBe('paused');
    await expect(Promise.resolve().then(() => t.call(ada, 'scheduleCreate', { title: 'X', assignee: 'Ada', cron: '0 9 * * *' }))).rejects.toThrow(/closed/);
  });
```

In `apps/office-server/test/company-api.test.ts` append:

```ts
  it('lets the owner pause, resume and stop a routine, and shows routines in the snapshot', async () => {
    const t = await start();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const s = t.company.createSchedule(c.id, { title: 'Günlük', assignee: ada.id, cron: '0 9 * * *' });
    expect((await call(t.port, 'POST', `/api/schedules/${s.id}/pause`)).body.status).toBe('paused');
    expect((await call(t.port, 'POST', `/api/schedules/${s.id}/resume`)).body.status).toBe('active');
    expect((await call(t.port, 'POST', `/api/schedules/${s.id}/stop`)).body.status).toBe('stopped');
    expect((await call(t.port, 'POST', `/api/schedules/${s.id}/resume`)).status).toBe(409);
    const office = await call(t.port, 'GET', '/api/office');
    expect(office.body.schedules.map((x: { title: string }) => x.title)).toEqual(['Günlük']);
    expect(office.body.clock).toMatchObject({ nextDueAt: null });
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/office-server && npx vitest run test/schedules.test.ts`
Expected: FAIL — `createSchedule is not a function`.

- [ ] **Step 3: Notice topics**

Add to `NOTICE_TOPICS`:

```ts
  /** A routine skipped its third firing in a row: its previous instance is still open. */
  'schedule.skipped': 'decision',
  /** A routine could not open a task three times running; it is paused. */
  'schedule.failed': 'decision',
  /** A routine's assignee left; it is paused until it has one. */
  'schedule.unassigned': 'decision',
```

- [ ] **Step 4: Company**

In `company.ts`: import `cronLabel, minIntervalMinutes, nextCron, parseCron` from `./time.ts` and `type Schedule, SCHEDULE_STATUSES` from `@cc/shared`. Add the interface and section:

```ts
export interface ScheduleInput {
  title: string;
  description?: string;
  done?: string[];
  assignee: string;
  cron: string;
  reviewer?: string | null;
  planId?: string | null;
  priority?: number;
  difficulty?: TaskDifficulty | null;
  /** Stop after this time: `+30d` or a local time. */
  until?: string | null;
}
```

```ts
  // ── routines (spec §4.4) ──────────────────────────────────────────────────

  createSchedule(by: string, input: ScheduleInput): Schedule {
    const store = this.#schedules();
    const assignee = this.#d.roster.get(input.assignee);
    this.#assertManages(by, assignee.id);
    if (assignee.lifecycle === 'archived') throw new ConflictError(`${assignee.name} işten çıkarıldı; ona rutin verilemez.`);
    const rules = this.#rules();
    if (store.activeCount() >= rules.maxSchedules) throw new ConflictError(`En fazla ${rules.maxSchedules} rutin olabilir; önce birini durdur (scheduleUpdate: status stopped).`);
    const now = this.#now();
    const spec = parseCron(input.cron);
    const gap = minIntervalMinutes(spec, now);
    if (gap < rules.minScheduleMinutes) throw new ValidationError(`Rutin aralığı en az ${rules.minScheduleMinutes} dk olmalı; bu zamanlama ${Math.round(gap)} dk'da bir tetikleniyor.`);
    const priority = input.priority ?? 3;
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) throw new ValidationError('Öncelik 1 (en acil) ile 5 arasında bir tam sayı olmalı.');
    const planId = input.planId ?? null;
    if (planId !== null) {
      const plan = this.#d.plans.get(planId);
      if (plan.status !== 'approved' && plan.status !== 'done') throw new ConflictError(`“${plan.title}” planı sürmüyor; rutin yalnız süren bir plana bağlanabilir.`);
    }
    const until = input.until ? parseUntil(input.until, now, { maxDays: DUE_MAX_DAYS, label: 'Bitiş' }) : null;
    const schedule = store.create({
      title: clean(input.title, 'Başlık', 120, true),
      description: clean(input.description, 'Açıklama', 4000, false),
      done: lines(input.done, 'Bitti tanımı', 12, 300),
      assignee: assignee.id,
      reviewer: this.#reviewerOf(input.reviewer, assignee.id),
      planId,
      priority,
      difficulty: this.#difficultyBy(by, input.difficulty),
      cron: spec.expr,
      until,
      createdBy: by,
      nextRunAt: nextCron(spec, now),
    });
    this.#emit(by === OWNER ? null : by, { type: 'schedule.changed', change: 'created', schedule });
    this.#d.clock?.touch();
    return schedule;
  }

  updateSchedule(by: string, id: string, patch: Partial<ScheduleInput> & { status?: string }): Schedule {
    const store = this.#schedules();
    const current = store.get(id);
    this.#assertManages(by, current.assignee);
    if (current.status === 'stopped') throw new ConflictError('Bu rutin durduruldu; yenisini aç.');
    const now = this.#now();
    const next: Partial<Schedule> = {};
    if (patch.title !== undefined) next.title = clean(patch.title, 'Başlık', 120, true);
    if (patch.description !== undefined) next.description = clean(patch.description, 'Açıklama', 4000, false);
    if (patch.done !== undefined) next.done = lines(patch.done, 'Bitti tanımı', 12, 300);
    if (patch.priority !== undefined) {
      if (!Number.isInteger(patch.priority) || patch.priority < 1 || patch.priority > 5) throw new ValidationError('Öncelik 1 (en acil) ile 5 arasında bir tam sayı olmalı.');
      next.priority = patch.priority;
    }
    if (patch.difficulty !== undefined) next.difficulty = this.#difficultyBy(by, patch.difficulty);
    if (patch.until !== undefined) next.until = patch.until ? parseUntil(patch.until, now, { maxDays: DUE_MAX_DAYS, label: 'Bitiş' }) : null;
    const assignee = patch.assignee !== undefined ? this.#d.roster.get(patch.assignee) : null;
    if (assignee) {
      this.#assertManages(by, assignee.id);
      if (assignee.lifecycle === 'archived') throw new ConflictError(`${assignee.name} işten çıkarıldı.`);
      next.assignee = assignee.id;
    }
    const doer = next.assignee ?? current.assignee;
    if (patch.reviewer !== undefined) next.reviewer = this.#reviewerOf(patch.reviewer, doer);
    else if ((next.reviewer ?? current.reviewer) === doer) throw new ConflictError(SELF_REVIEW);
    if (patch.cron !== undefined) {
      const spec = parseCron(patch.cron);
      const gap = minIntervalMinutes(spec, now);
      if (gap < this.#rules().minScheduleMinutes) throw new ValidationError(`Rutin aralığı en az ${this.#rules().minScheduleMinutes} dk olmalı; bu zamanlama ${Math.round(gap)} dk'da bir tetikleniyor.`);
      next.cron = spec.expr;
      next.nextRunAt = nextCron(spec, now);
    }
    let change: ScheduleChange = 'updated';
    if (patch.status !== undefined) {
      if (!(SCHEDULE_STATUSES as readonly string[]).includes(patch.status)) throw new ValidationError('Rutin durumu active, paused ya da stopped olmalı.');
      const status = patch.status as Schedule['status'];
      if (status !== current.status) {
        next.status = status;
        change = status === 'paused' ? 'paused' : status === 'stopped' ? 'stopped' : 'resumed';
        // Coming back from a pause: the next run is from now, so the missed ones become one catch-up at most.
        if (status === 'active') next.nextRunAt = nextCron(parseCron(next.cron ?? current.cron), now);
      }
    }
    const schedule = store.update(id, next);
    this.#emit(by === OWNER ? null : by, { type: 'schedule.changed', change, schedule });
    this.#d.clock?.touch();
    return schedule;
  }

  /** The owner's routine buttons; the coordinator hears, for the record. */
  ownerSchedule(id: string, action: 'pause' | 'resume' | 'stop'): Schedule {
    const current = this.#schedules().get(id);
    if (current.status === 'stopped') throw new ConflictError('Bu rutin durduruldu; yeniden açılamaz.');
    const status = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'stopped';
    const next = this.#applyScheduleStatus(current, status, OWNER);
    const verb = action === 'pause' ? 'duraklattı' : action === 'resume' ? 'sürdürdü' : 'durdurdu';
    this.#tellOwnerChanged(`Sahibi “${current.title}” rutinini ${verb}.`);
    return next;
  }

  /** Active and paused routines, then the last 10 stopped. */
  schedules(): Schedule[] {
    if (!this.#d.schedules) return [];
    return [...this.#d.schedules.list({ statuses: ['active', 'paused'] }), ...this.#d.schedules.list({ statuses: ['stopped'] }).slice(-10)];
  }

  #applyScheduleStatus(current: Schedule, status: Schedule['status'], by: string): Schedule {
    if (current.status === status) return current;
    const patch: Partial<Schedule> = { status };
    if (status === 'active') patch.nextRunAt = nextCron(parseCron(current.cron), this.#now());
    const schedule = this.#schedules().update(current.id, patch);
    this.#emit(by === OWNER ? null : by, { type: 'schedule.changed', change: status === 'paused' ? 'paused' : status === 'stopped' ? 'stopped' : 'resumed', schedule });
    this.#d.clock?.touch();
    return schedule;
  }

  #schedules(): ScheduleStore {
    if (!this.#d.schedules) throw new ConflictError('Bu ofiste rutinler açık değil.');
    return this.#d.schedules;
  }
```

(`ScheduleChange` is imported from `@cc/shared`.)

`releaseTasksOf` gains, after the proposals reroute:

```ts
    for (const sch of this.#d.schedules?.list({ assignee: id, statuses: ['active', 'paused'] }) ?? []) {
      if (sch.status === 'active') this.#applyScheduleStatus(sch, 'paused', id);
      this.#tellCoordinator(id, 'schedule.unassigned', `“${sch.title}” rutininin atananı (${this.nameOf(id)}) işten çıkarıldı; rutin duraklatıldı. scheduleUpdate ile yeni bir atanan ver ve sürdür.`);
    }
```

`stopPlan` gains, before the plan update:

```ts
    for (const sch of this.#d.schedules?.list({ planId, statuses: ['active', 'paused'] }) ?? []) this.#applyScheduleStatus(sch, 'stopped', OWNER);
```

- [ ] **Step 5: Firing in the due-processor**

In `scheduling.ts`, replace the `runSchedules` stub:

```ts
  /** Routines whose time came (spec §4.4): one task each, unless the previous instance is still open; none while paused. */
  protected runSchedules(now: number, report: DueReport, guard: (job: string, fn: () => void) => void): void {
    const d = this.deps;
    if (d.company.paused()) return;
    for (const schedule of d.schedules.due(now)) {
      guard(`schedule ${schedule.id}`, () => {
        if (schedule.until !== null && schedule.until <= now) {
          const stopped = d.schedules.update(schedule.id, { status: 'stopped', note: 'Bitiş tarihi geçti' });
          d.events.append(null, { type: 'schedule.changed', change: 'stopped', schedule: stopped });
          return;
        }
        const spec = parseCron(schedule.cron);
        const nextRunAt = nextCron(spec, now);
        const open = d.tasks.openInstance(schedule.id);
        if (open) {
          const skipCount = schedule.skipCount + 1;
          const skipped = d.schedules.update(schedule.id, { nextRunAt, skipCount, note: `${formatWhen(now, now)}: önceki örnek (“${open.title}”) hâlâ açık, atlandı` });
          d.events.append(null, { type: 'schedule.changed', change: 'skipped', schedule: skipped });
          report.skipped.push(schedule.id);
          if (skipCount % REPARK_LIMIT === 0) {
            const c = d.company.coordinator();
            if (c) d.notices.add(c.id, 'schedule.skipped', `“${schedule.title}” rutini ${skipCount} kez atlandı: önceki örneği (“${open.title}”, no ${open.id}) hâlâ açık. Örneği kapat ya da rutini seyrelt/durdur (scheduleUpdate).`);
          }
          return;
        }
        d.db.exec('BEGIN IMMEDIATE');
        try {
          const task = d.company.createTask(schedule.createdBy, {
            assignee: schedule.assignee, title: `${schedule.title} — ${formatWhen(now, now)}`, description: schedule.description, done: schedule.done,
            priority: schedule.priority, planId: schedule.planId, difficulty: schedule.difficulty, reviewer: schedule.reviewer, scheduleId: schedule.id,
          });
          const fired = d.schedules.update(schedule.id, { nextRunAt, lastRunAt: now, lastTaskId: task.id, failCount: 0, note: null });
          d.db.exec('COMMIT');
          d.events.append(null, { type: 'schedule.changed', change: 'fired', schedule: fired });
          report.fired.push(schedule.id);
        } catch (err) {
          d.db.exec('ROLLBACK');
          const failCount = schedule.failCount + 1;
          const message = err instanceof Error ? err.message : String(err);
          const paused = failCount >= REPARK_LIMIT;
          d.schedules.update(schedule.id, { nextRunAt, failCount, status: paused ? 'paused' : schedule.status, note: `${formatWhen(now, now)}: görev açılamadı — ${message}` });
          if (paused) {
            const c = d.company.coordinator();
            if (c) d.notices.add(c.id, 'schedule.failed', `“${schedule.title}” rutini üst üste ${failCount} kez görev açamadı (${message}); duraklatıldı. Nedenini gider ve scheduleUpdate ile sürdür.`);
          }
          throw err;
        }
      });
    }
  }
```

(`createTask` must accept `scheduleId?: string | null` in `TaskInput` and pass it to `tasks.create` — add that to `TaskInput` and `createTask`. `Db` must expose `exec`: check `src/db.ts`; `openDb` returns node:sqlite's `DatabaseSync`, which has `exec`. If the `Db` type is narrower, widen it with `exec(sql: string): void`.) Import `parseCron, nextCron` in `scheduling.ts`.

The `clock.error` events for a failed firing will be written by `guard` since the handler re-throws after recording the failure — that is intended (the error is both counted on the schedule and logged).

- [ ] **Step 6: Tools, API, snapshot, wiring**

Tools (after `taskUnpark`):

```ts
    {
      name: 'scheduleCreate',
      description:
        'Open a routine (coordinator; lead for their team): recurring work that opens an ordinary task each time — with a reviewer, evidence and all the office rules. cron has 5 fields in local time ("0 9 * * 1-5" = weekdays 09:00). Routines cost quota: keep few, no more often than the constitution allows. A new instance is skipped while the previous one is still open.',
      inputSchema: object(
        { title: s('Routine title.'), description: s('What to do each time.'), done: strings('Definition of done of each instance.'), assignee: s('Employee id or name.'), cron: s('5-field cron, local time.'), reviewer, planId: s('The plan it serves.'), priority: integer('1 = most urgent … 5 = whenever (default 3).', 1, 5), difficulty, until: { ...until, description: 'Stop after this time (optional).' } },
        ['title', 'assignee', 'cron'],
      ),
      kinds: LEADS,
      run: ({ employee }, args) => {
        const to = findPerson(str(args, 'assignee'));
        const s2 = company.createSchedule(employee.id, { title: str(args, 'title'), description: optStr(args, 'description'), done: list(args, 'done'), assignee: to.id, cron: str(args, 'cron'), reviewer: reviewerArg(args) ?? null, planId: optStr(args, 'planId') ?? null, priority: num(args, 'priority'), difficulty: difficultyArg(args), until: optStr(args, 'until') });
        return `Rutin açıldı (${s2.id}): “${s2.title}” → ${to.name}, ${cronLabel(parseCron(s2.cron))}; ilk çalışma ${formatWhen(s2.nextRunAt ?? Date.now(), Date.now())}.`;
      },
    },
    {
      name: 'scheduleList',
      description: 'List the routines (coordinator, lead): who, when (in Turkish and as cron), the next run, the last instance, skips and failures.',
      inputSchema: object({}),
      kinds: LEADS,
      run: () => {
        const all = company.schedules();
        if (all.length === 0) return 'Rutin yok.';
        return all.map((x) => `• ${x.id} “${x.title}” → ${company.nameOf(x.assignee)} · ${cronLabel(parseCron(x.cron))} (${x.cron}) · ${x.status}${x.nextRunAt ? ` · sıradaki ${formatWhen(x.nextRunAt, Date.now())}` : ''}${x.skipCount ? ` · ${x.skipCount} atlama` : ''}${x.failCount ? ` · ${x.failCount} hata` : ''}${x.note ? ` · ${x.note}` : ''}`).join('\n');
      },
    },
    {
      name: 'scheduleUpdate',
      description: 'Change a routine (coordinator; lead for their team): status (active resumes, paused, stopped), cron, assignee, reviewer, priority, difficulty, until, title, description, done.',
      inputSchema: object(
        { scheduleId: s('The routine id.'), status: { type: 'string', enum: ['active', 'paused', 'stopped'] }, cron: s('New 5-field cron.'), assignee: s('New assignee (id or name).'), reviewer, priority: integer('1–5.', 1, 5), difficulty, until: { ...until, description: 'New stop time.' }, title: s('New title.'), description: s('New description.'), done: strings('New definition of done.') },
        ['scheduleId'],
      ),
      kinds: LEADS,
      run: ({ employee }, args) => {
        const assignee = optStr(args, 'assignee');
        const s2 = company.updateSchedule(employee.id, str(args, 'scheduleId'), {
          status: optStr(args, 'status'), cron: optStr(args, 'cron'), assignee: assignee ? findPerson(assignee).id : undefined, reviewer: args.reviewer === undefined ? undefined : reviewerArg(args) ?? null,
          priority: num(args, 'priority'), difficulty: args.difficulty === undefined ? undefined : difficultyArg(args), until: optStr(args, 'until'), title: optStr(args, 'title'), description: optStr(args, 'description'), done: list(args, 'done'),
        });
        const state = s2.status === 'paused' ? 'duraklatıldı' : s2.status === 'stopped' ? 'durduruldu' : 'sürüyor';
        return `“${s2.title}” rutini güncellendi: ${state}, ${cronLabel(parseCron(s2.cron))}${s2.nextRunAt && s2.status === 'active' ? `, sıradaki ${formatWhen(s2.nextRunAt, Date.now())}` : ''}.`;
      },
    },
```

(import `cronLabel, parseCron` into `tools.ts`).

API: `const SCHEDULE_ROUTE = /^\/api\/schedules\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(pause|resume|stop)$/;` and in the company block:

```ts
    const scheduleAction = SCHEDULE_ROUTE.exec(url.pathname);
    if (method === 'POST' && scheduleAction) return sendJson(res, 200, company.ownerSchedule(scheduleAction[1] ?? '', scheduleAction[2] as 'pause' | 'resume' | 'stop'));
```

`snapshot` adds `schedules: d.company.service.schedules()`. `main.ts`: `schedules` is already created in Task 4 and passed to `new Company({... schedules })`; the clock is attached with `company.attachClock(clock)` (Task 3/4).

- [ ] **Step 7: Run the suite**

Run: `cd apps/office-server && npx vitest run > /tmp/cc-sched-t6.log 2>&1; tail -8 /tmp/cc-sched-t6.log; cd ../.. && pnpm -r --if-present typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add apps/office-server/src apps/office-server/test
git commit -m "feat(company): routines — recurring work that opens ordinary tasks, with a pile-up brake and a single catch-up"
```

---

### Task 7: The Agenda service, `GET /api/agenda`, `agendaRead`

**Files:**
- Create: `apps/office-server/src/company/agenda.ts`
- Modify: `apps/office-server/src/api.ts`, `apps/office-server/src/mcp/tools.ts`, `apps/office-server/src/main.ts`
- Test: `apps/office-server/test/agenda.test.ts` (new), `apps/office-server/test/company-api.test.ts`, `apps/office-server/test/mcp-tools.test.ts`

**Interfaces:**
- Consumes: `TaskStore.durations / list / nextFor`, `ScheduleStore.list`, `Clock.status`, `Budget.reserveActive / constitution`, `Company.paused / nameOf`, `nextCron / cronLabel / formatWhen`.
- Produces: `class Agenda` — `constructor(d: AgendaDeps)`, `report(now?): AgendaReport`, `forEmployee(id, now?): EmployeeAgenda`, `text(employeeId?: string, now?): string`; `AgendaDeps = { roster: Roster; tasks: TaskStore; schedules: ScheduleStore; company: Company; budget?: { reserveActive(): boolean; constitution(): Constitution }; clock?: { status(now: number): ClockStatus }; now?: () => number; horizonMs?: number /* 7 days */ }`; route `GET /api/agenda`; tool `agendaRead(employee?)` (LEADS).

- [ ] **Step 1: Write the failing tests**

Create `apps/office-server/test/agenda.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER } from '@cc/shared';
import { Agenda } from '../src/company/agenda.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const T0 = new Date(2026, 9, 7, 14, 10).getTime();
const MIN = 60_000;

function make() {
  let clock = T0;
  const now = () => clock;
  const s = setup(8, now);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, undefined, now);
  const coordinator = c.company.hireCoordinator('sonnet');
  const ada = c.company.hire(coordinator.id, { name: 'Ada', role: 'r' });
  const can = c.company.hire(coordinator.id, { name: 'Can', role: 'r' });
  const agenda = new Agenda({ roster: s.roster, tasks: c.tasks, schedules: c.schedules, company: c.company, budget: c.budget, now });
  /** A finished task that took `minutes`, for the estimates. */
  const history = (assignee: string, minutes: number, difficulty?: 'easy' | 'hard') => {
    const t = c.company.createTask(coordinator.id, { assignee, title: `geçmiş ${minutes}`, difficulty });
    c.tasks.update(t.id, { status: 'in_progress', startedAt: clock - minutes * MIN - 1000 });
    c.tasks.update(t.id, { status: 'done', finishedAt: clock - 1000 });
  };
  return { ...s, ...c, coordinator, ada, can, agenda, history, advance: (ms: number) => (clock += ms) };
}

describe('Agenda (spec §6.1)', () => {
  it('review focus: a fresh office — no history — estimates with the constitution default and says so', () => {
    const t = make();
    t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'İlk iş' });
    const ada = t.agenda.forEmployee(t.ada.id);
    expect(ada.entries).toHaveLength(1);
    expect(ada.entries[0]).toMatchObject({ kind: 'queued', title: 'İlk iş', at: T0, until: T0 + 45 * MIN, basis: 'varsayılan', lowConfidence: false });
  });

  it('chains the queue in delivery order with medians from the employee’s history, by difficulty when it has enough samples', () => {
    const t = make();
    for (const m of [20, 30, 40]) t.history(t.ada.id, m, 'easy');
    for (const m of [90, 100, 110]) t.history(t.ada.id, m, 'hard');
    const running = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Süren', difficulty: 'easy' });
    t.company.start(running.id);
    t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Zor', difficulty: 'hard', priority: 2 });
    t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Sıradan', priority: 3 });
    const [now, zor, siradan] = t.agenda.forEmployee(t.ada.id).entries;
    expect(now).toMatchObject({ kind: 'now', title: 'Süren', at: T0, until: T0 + 30 * MIN, basis: 'zorluk: kolay, 3 iş' });
    expect(zor).toMatchObject({ kind: 'queued', title: 'Zor', at: T0 + 30 * MIN, until: T0 + 130 * MIN, basis: 'zorluk: zor, 3 iş' });
    expect(siradan).toMatchObject({ kind: 'queued', title: 'Sıradan', at: T0 + 130 * MIN, basis: 'son 6 iş' });
    expect(siradan!.until! - siradan!.at!).toBe(65 * MIN); // median of 20,30,40,90,100,110
  });

  it('review focus: a dependency on another employee’s unfinished task shows "X bitince" with low confidence, after X’s estimated end', () => {
    const t = make();
    t.history(t.can.id, 60);
    const theirs = t.company.createTask(t.coordinator.id, { assignee: t.can.id, title: 'Can’ın işi' });
    t.company.start(theirs.id);
    t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Bağımlı', dependsOn: [theirs.id] });
    const entry = t.agenda.forEmployee(t.ada.id).entries[0]!;
    expect(entry).toMatchObject({ kind: 'queued', title: 'Bağımlı', note: '“Can’ın işi” bitince', lowConfidence: true, at: T0 + 60 * MIN });
  });

  it('shows parked tasks at their return, start-timed tasks at their time, review waits, routines, and overdue in red', () => {
    const t = make();
    const parked = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Pencere' });
    t.company.parkTask(t.ada.id, parked.id, '+1d', 'ölçüm penceresi dolsun');
    t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Takip', startAfter: '+2h' });
    const reviewed = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'İncelenen', reviewer: t.can.id });
    t.company.finish(t.ada.id, reviewed.id, { summary: 'bitti', outputs: [], learned: '' });
    t.company.createSchedule(t.coordinator.id, { title: 'Günlük', assignee: t.ada.id, cron: '0 9 * * *' });
    const late = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Geç', dueAt: '+1h' });
    t.advance(2 * 60 * MIN);
    const entries = t.agenda.forEmployee(t.ada.id).entries;
    const by = (title: string) => entries.find((e) => e.title.startsWith(title))!;
    expect(by('Geç')).toMatchObject({ kind: 'queued', overdue: true, dueAt: late.dueAt });
    expect(by('Takip')).toMatchObject({ kind: 'queued' }); // its time came while we advanced
    expect(by('İncelenen')).toMatchObject({ kind: 'review_wait', note: 'Can’da, tur 1' });
    expect(by('Pencere')).toMatchObject({ kind: 'parked', at: T0 + 24 * 60 * MIN, note: 'ölçüm penceresi dolsun' });
    expect(by('Günlük')).toMatchObject({ kind: 'scheduled', note: 'her gün 09:00', at: new Date(2026, 9, 8, 9, 0).getTime() });
    // A parked task past its return but not yet returned by the clock still shows, as due now.
    t.advance(24 * 60 * MIN);
    expect(t.agenda.forEmployee(t.ada.id).entries.find((e) => e.title === 'Pencere')).toMatchObject({ kind: 'parked', at: T0 + 24 * 60 * MIN });
  });

  it('states sleeping, the reserve, pause and the limit; the report covers everyone and the clock', () => {
    const t = make();
    t.roster.update(t.can.id, { lifecycle: 'sleeping' });
    t.company.pause();
    const report = t.agenda.report();
    expect(report.employees.map((e) => e.name).sort()).toEqual(['Ada', 'Can', 'Koordinatör']);
    expect(report.employees.find((e) => e.name === 'Can')?.state).toContain('uyuyor');
    expect(report.employees.find((e) => e.name === 'Ada')?.state).toContain('duraklatıldı');
    expect(report.horizonMs).toBe(7 * 24 * 60 * MIN);
    expect(report.clock).toMatchObject({ nextDueAt: null });
    t.company.resume();
    t.setQuota({ status: 'allowed', fiveHour: { utilization: 0.99, resetsAt: T0 + 60 * MIN }, sevenDay: null, updatedAt: T0 });
    expect(t.agenda.forEmployee(t.ada.id).state).toContain('kota payı');
  });

  it('writes the agenda as Turkish text for the coordinator', () => {
    const t = make();
    t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'İlk iş' });
    const text = t.agenda.text(t.ada.id);
    expect(text).toContain('Ada');
    expect(text).toMatch(/Sırada: İlk iş .*~14:55/);
    expect(t.agenda.text()).toContain('Koordinatör');
  });
});
```

(`companyFor` must expose `schedules`; it does since Task 3. `setQuota` exists.)

In `apps/office-server/test/company-api.test.ts` append:

```ts
  it('serves the agenda', async () => {
    const t = await start();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    t.company.createTask(c.id, { assignee: ada.id, title: 'İş' });
    const agenda = await call(t.port, 'GET', '/api/agenda');
    expect(agenda.status).toBe(200);
    expect(agenda.body.employees.find((e: { name: string }) => e.name === 'Ada').entries[0]).toMatchObject({ kind: 'queued', title: 'İş' });
  });
```

(`start()` must build an `Agenda` and pass it as `company.agenda` in `createApi`'s deps.) In `apps/office-server/test/mcp-tools.test.ts`: lead list gains `'agendaRead'` (first alphabetically); append:

```ts
  it('agendaRead tells the coordinator who does what when', async () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    t.company.createTask(c.id, { assignee: ada.id, title: 'İş' });
    expect(await t.call(c, 'agendaRead', { employee: 'Ada' })).toMatch(/Sırada: İş/);
    expect(await t.call(c, 'agendaRead')).toContain('Ada');
  });
```

(`make()` in that file passes `agenda` to `officeTools`.)

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/office-server && npx vitest run test/agenda.test.ts`
Expected: FAIL — `Cannot find module '../src/company/agenda.ts'`.

- [ ] **Step 3: The Agenda service**

Create `apps/office-server/src/company/agenda.ts`:

```ts
import { DEFAULT_CONSTITUTION, type AgendaEntry, type AgendaReport, type ClockStatus, type Constitution, type Employee, type EmployeeAgenda, type Task } from '@cc/shared';
import type { Roster } from '../roster.ts';
import type { Company } from './company.ts';
import type { ScheduleStore, TaskStore } from './store.ts';
import { cronLabel, formatWhen, nextCron, parseCron } from './time.ts';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const HISTORY = 10;
const OFFICE_HISTORY = 50;
const BY_DIFFICULTY_MIN_SAMPLES = 3;
const REVIEW_DEFAULT_MS = 15 * MIN;
const SCHEDULE_OCCURRENCES = 3;
const DIFFICULTY_TR = { easy: 'kolay', medium: 'orta', hard: 'zor', critical: 'kritik' } as const;

export interface AgendaDeps {
  roster: Roster;
  tasks: TaskStore;
  schedules: ScheduleStore;
  company: Company;
  budget?: { reserveActive(): boolean; constitution(): Constitution };
  clock?: { status(now: number): ClockStatus };
  now?: () => number;
  horizonMs?: number;
}

interface Estimate {
  ms: number;
  basis: string;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
};

/**
 * Each employee's agenda, derived from the database (spec §6.1): what runs now, what is queued (with chained
 * estimates), what waits for a reviewer, what is parked or start-timed, which routines are coming. It changes nothing
 * and uses no model.
 */
export class Agenda {
  readonly #d: AgendaDeps;
  readonly #now: () => number;
  readonly #horizon: number;

  constructor(d: AgendaDeps) {
    this.#d = d;
    this.#now = d.now ?? Date.now;
    this.#horizon = d.horizonMs ?? 7 * DAY;
  }

  report(now: number = this.#now()): AgendaReport {
    const employees = this.#d.roster.list().map((e) => this.#forEmployee(e, now));
    return { generatedAt: now, horizonMs: this.#horizon, clock: this.#d.clock?.status(now) ?? { nextDueAt: null, nextDueLabel: null, lastRunAt: null, lastJumpAt: null }, employees };
  }

  forEmployee(id: string, now: number = this.#now()): EmployeeAgenda {
    return this.#forEmployee(this.#d.roster.get(id), now);
  }

  /** The agenda as Turkish lines (agendaRead): one employee, or everyone. */
  text(employeeId?: string, now: number = this.#now()): string {
    const people = employeeId ? [this.forEmployee(employeeId, now)] : this.report(now).employees;
    const when = (ms: number | null) => (ms === null ? '?' : formatWhen(ms, now).replace(/^bugün /, ''));
    const line = (e: AgendaEntry): string => {
      const span = e.kind === 'now' || e.kind === 'queued' ? `${e.kind === 'now' ? 'başladı ' : '~'}${when(e.at)} → ~${when(e.until)}` : when(e.at);
      const label = e.kind === 'now' ? 'Şimdi' : e.kind === 'queued' ? 'Sırada' : e.kind === 'review_wait' ? 'İnceleme bekliyor' : e.kind === 'parked' ? 'Park' : e.kind === 'not_before' ? 'Başlangıç' : 'Rutin';
      const extras = [e.note, e.basis ? `~${e.basis}` : null, e.overdue ? 'SON TARİH GEÇTİ' : e.dueAt ? `son tarih ${when(e.dueAt)}` : null].filter(Boolean).join(' · ');
      return `  ${label}: ${e.title} (${span})${extras ? ` — ${extras}` : ''}`;
    };
    return people.map((p) => [`${p.name}${p.state ? ` — ${p.state}` : ''}`, ...(p.entries.length ? p.entries.map(line) : ['  (boş)'])].join('\n')).join('\n');
  }

  #forEmployee(e: Employee, now: number): EmployeeAgenda {
    const entries: AgendaEntry[] = [];
    const open = this.#d.tasks.list({ assignee: e.id, statuses: ['waiting', 'in_progress', 'review', 'blocked', 'parked'] });
    let cursor = now;
    const running = open.find((t) => t.status === 'in_progress' || t.status === 'blocked');
    if (running) {
      const est = this.#estimate(running);
      const started = running.startedAt ?? now;
      const until = Math.max(started + est.ms, now);
      entries.push(this.#entry('now', running, started, until, est.basis, started + est.ms < now ? 'uzuyor' : null, false, now));
      cursor = until;
    }
    const queue = this.#deliveryOrder(open.filter((t) => t.status === 'waiting' && (t.notBefore === null || t.notBefore === undefined || t.notBefore <= now)));
    for (const t of queue) {
      const dep = this.#pendingDependency(t);
      let at = cursor;
      let note: string | null = null;
      let low = false;
      if (dep) {
        note = `“${dep.title}” bitince`;
        low = true;
        const depEnd = this.#estimatedEnd(dep, now);
        at = depEnd === null ? cursor : Math.max(cursor, depEnd);
      }
      const est = this.#estimate(t);
      entries.push(this.#entry('queued', t, at, at + est.ms, est.basis, note, low, now));
      cursor = at + est.ms;
    }
    for (const t of open.filter((x) => x.status === 'review')) {
      const reviewer = t.reviewer ? this.#d.company.nameOf(t.reviewer) : 'inceleyici';
      entries.push(this.#entry('review_wait', t, null, null, null, `${reviewer}’da, tur ${t.round ?? 1}`, false, now));
    }
    for (const t of open.filter((x) => x.status === 'parked')) entries.push(this.#entry('parked', t, t.notBefore ?? now, null, null, t.parkedReason ?? null, false, now));
    for (const t of open.filter((x) => x.status === 'waiting' && x.notBefore !== null && x.notBefore !== undefined && x.notBefore > now)) {
      entries.push(this.#entry('not_before', t, t.notBefore!, null, null, null, false, now));
    }
    for (const sch of this.#d.schedules.list({ assignee: e.id, statuses: ['active'] })) {
      const spec = parseCron(sch.cron);
      let at = sch.nextRunAt ?? now;
      for (let i = 0; i < SCHEDULE_OCCURRENCES && at <= now + this.#horizon; i += 1) {
        entries.push({ kind: 'scheduled', taskId: null, scheduleId: sch.id, title: sch.title, at, until: null, basis: null, note: cronLabel(spec), priority: sch.priority, dueAt: null, overdue: false, lowConfidence: false });
        try {
          at = nextCron(spec, at);
        } catch {
          break;
        }
      }
    }
    const within = entries.filter((x) => x.at === null || x.at <= now + this.#horizon);
    within.sort((a, b) => (a.at ?? Number.POSITIVE_INFINITY) - (b.at ?? Number.POSITIVE_INFINITY));
    return { id: e.id, name: e.name, state: this.#state(e, now), entries: within };
  }

  #entry(kind: AgendaEntry['kind'], t: Task, at: number | null, until: number | null, basis: string | null, note: string | null, low: boolean, now: number): AgendaEntry {
    return { kind, taskId: t.id, scheduleId: t.scheduleId ?? null, title: t.title, at, until, basis, note, priority: t.priority, dueAt: t.dueAt ?? null, overdue: (t.dueAt ?? Number.POSITIVE_INFINITY) <= now, lowConfidence: low };
  }

  /** The dispatcher's order: priority, nearer due date, oldest. */
  #deliveryOrder(tasks: Task[]): Task[] {
    return [...tasks].sort((a, b) => a.priority - b.priority || (a.dueAt ?? Number.POSITIVE_INFINITY) - (b.dueAt ?? Number.POSITIVE_INFINITY) || a.createdAt - b.createdAt);
  }

  #pendingDependency(t: Task): Task | null {
    for (const id of t.dependsOn) {
      try {
        const dep = this.#d.tasks.get(id);
        if (dep.status !== 'done' && dep.status !== 'cancelled') return dep;
      } catch {
        // A dependency that no longer exists does not hold the task (nextFor treats it the same).
      }
    }
    return null;
  }

  /** When another task is expected to end: its own agenda's `until`, or null when it is parked/waiting on a time. */
  #estimatedEnd(dep: Task, now: number): number | null {
    const owner = this.#d.roster.list().find((x) => x.id === dep.assignee);
    if (!owner) return null;
    const entry = this.#forEmployee(owner, now).entries.find((x) => x.taskId === dep.id);
    return entry?.until ?? null;
  }

  #estimate(t: Task): Estimate {
    const tasks = this.#d.tasks;
    if (t.kind === 'review') {
      const xs = tasks.durations({ assignee: t.assignee, kind: 'review', limit: HISTORY });
      return xs.length ? { ms: median(xs), basis: `inceleme, ${xs.length} iş` } : { ms: REVIEW_DEFAULT_MS, basis: 'inceleme, varsayılan' };
    }
    if (t.difficulty) {
      const xs = tasks.durations({ assignee: t.assignee, kind: 'work', difficulty: t.difficulty, limit: HISTORY });
      if (xs.length >= BY_DIFFICULTY_MIN_SAMPLES) return { ms: median(xs), basis: `zorluk: ${DIFFICULTY_TR[t.difficulty]}, ${xs.length} iş` };
    }
    const own = tasks.durations({ assignee: t.assignee, kind: 'work', limit: HISTORY });
    if (own.length) return { ms: median(own), basis: `son ${own.length} iş` };
    const office = tasks.durations({ kind: 'work', limit: OFFICE_HISTORY });
    if (office.length) return { ms: median(office), basis: 'ofis geneli' };
    return { ms: this.#rules().defaultTaskMinutes * MIN, basis: 'varsayılan' };
  }

  #state(e: Employee, now: number): string | null {
    const parts: string[] = [];
    if (this.#d.company.paused()) parts.push('şirket duraklatıldı');
    if (e.lifecycle === 'sleeping') parts.push('uyuyor');
    if (e.lifecycle === 'limited') parts.push(e.limitResetsAt ? `limit doldu, açılış ${formatWhen(e.limitResetsAt, now)}` : 'limit doldu');
    if (e.lifecycle === 'stopped') parts.push('durduruldu');
    if (this.#d.budget?.reserveActive()) parts.push('kota payı devrede (yalnız öncelik 1)');
    return parts.length ? parts.join(' · ') : null;
  }

  #rules(): Constitution {
    return this.#d.budget?.constitution() ?? DEFAULT_CONSTITUTION;
  }
}
```

- [ ] **Step 4: API and tool**

`api.ts`: `ApiDeps.company` gains `agenda?: Agenda` (type `{ report(): AgendaReport }`); in the company block add `if (method === 'GET' && url.pathname === '/api/agenda') return sendJson(res, 200, d.company.agenda?.report() ?? { generatedAt: Date.now(), horizonMs: 0, clock: { nextDueAt: null, nextDueLabel: null, lastRunAt: null, lastJumpAt: null }, employees: [] });`.

`tools.ts`: `officeTools` options gain `agenda: { text(employeeId?: string): string }`; add the tool (after `scheduleUpdate`):

```ts
    {
      name: 'agendaRead',
      description: 'Read the agenda (coordinator, lead): for each employee what runs now, what is queued with estimated times, what waits for review, what is parked and until when, which routines are coming. Use it to see who is free when before handing out work.',
      inputSchema: object({ employee: s('One employee (id or name); omit for everyone.') }),
      kinds: LEADS,
      run: (_ctx, args) => {
        const who = optStr(args, 'employee');
        return agenda.text(who ? findPerson(who).id : undefined);
      },
    },
```

Update every `officeTools({...})` call (tests, smoke tests, `main.ts`) to pass `agenda`, and `createApi` call sites to pass `agenda` under `company`. `main.ts`: `const agenda = new Agenda({ roster, tasks, schedules, company, budget, clock });`.

- [ ] **Step 5: Run the suite**

Run: `cd apps/office-server && npx vitest run > /tmp/cc-sched-t7.log 2>&1; tail -8 /tmp/cc-sched-t7.log; cd ../.. && pnpm -r --if-present typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/office-server/src apps/office-server/test
git commit -m "feat(company): the agenda — what each employee does when, with estimates from their own history"
```

---

### Task 8: The web — Ajanda tab, the employee's agenda, owner buttons, routines, constitution fields

**Files:**
- Modify: `apps/office-web/src/store/reducers.ts`, `apps/office-web/src/net/api.ts`, `apps/office-web/src/ui/labels.ts`
- Create: `apps/office-web/src/ui/AgendaTab.tsx`, `apps/office-web/src/ui/useAgenda.ts`
- Modify: `apps/office-web/src/ui/CompanyView.tsx`, `apps/office-web/src/ui/Panel.tsx`, `apps/office-web/src/ui/EventItem.tsx`, `apps/office-web/src/ui/BudgetTabs.tsx`, `apps/office-web/src/styles.css`
- Test: `reducers.test.ts`, `AgendaTab.test.tsx` (new), `Panel.test.tsx`, `EventItem.test.tsx`, `BudgetTabs.test.tsx`, `CompanyView.test.tsx`

**Interfaces:**
- Consumes: `AgendaReport`, `Schedule`, `ClockStatus`, routes of Tasks 5–7.
- Produces: `OfficeData.schedules: Record<string, Schedule>`, `OfficeData.clock: ClockStatus | null`, `OfficeData.agendaRev: number` (bumped on `task.changed`, `plan.changed`, `schedule.changed`, `lifecycle.changed`, `budget.changed`, `company.paused`, `clock.jumped`); `api.agenda()`, `api.parkTask(id, until, reason)`, `api.releaseTask(id)`, `api.prioritizeTask(id)`, `api.scheduleAction(id, 'pause' | 'resume' | 'stop')`; `useAgenda(): { report: AgendaReport | null; error: string | null }` (fetches on mount and 1 s after `agendaRev` changes); `AgendaTab`, `AgendaSection({ id })`; `SCHEDULE_STATUS_LABELS`.

- [ ] **Step 1: Write the failing tests**

Read each test file's fixtures first and keep its style. The tests to add:

`store/reducers.test.ts`:

```ts
  it('keeps routines and the clock from the snapshot and events, and bumps agendaRev on what changes the agenda', () => {
    const schedule = { id: 's1', title: 'Günlük', description: '', done: [], assignee: 'e1', reviewer: null, planId: null, priority: 3, difficulty: null, cron: '0 9 * * *', until: null, status: 'active' as const, nextRunAt: 5, lastRunAt: null, lastTaskId: null, skipCount: 0, failCount: 0, createdBy: 'c', createdAt: 1, note: null };
    let d = applySnapshot(EMPTY_DATA, { employees: [], quota: null, usage: {}, lastSeq: 1, schedules: [schedule], clock: { nextDueAt: 5, nextDueLabel: 'Günlük · Ada (rutin)', lastRunAt: 1, lastJumpAt: null } }, 'live');
    expect(d.schedules.s1?.title).toBe('Günlük');
    expect(d.clock?.nextDueLabel).toBe('Günlük · Ada (rutin)');
    const rev = d.agendaRev;
    d = applyEvent(d, stored({ type: 'schedule.changed', change: 'paused', schedule: { ...schedule, status: 'paused' } }, 'c', 10));
    expect(d.schedules.s1?.status).toBe('paused');
    expect(d.agendaRev).toBe(rev + 1);
    d = applyEvent(d, stored({ type: 'company.paused', paused: true }, 'c', 11));
    expect(d.agendaRev).toBe(rev + 2);
    d = applyEvent(d, stored({ type: 'note.written', id: 1, title: 'n', tags: [] }, 'c', 12));
    expect(d.agendaRev).toBe(rev + 2);
  });
```

`ui/AgendaTab.test.tsx` (new; mock `../net/api.ts` with `agenda`, `parkTask`, `releaseTask`, `prioritizeTask`, `scheduleAction`):

```tsx
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgendaReport } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { AgendaTab } from './AgendaTab.tsx';

const NOW = new Date(2026, 9, 7, 14, 10).getTime();
const H = 3_600_000;
const report = (): AgendaReport => ({
  generatedAt: NOW, horizonMs: 7 * 24 * H,
  clock: { nextDueAt: NOW + 24 * H + 45 * 60_000, nextDueLabel: 'Adım 1 penceresi · Koordinatör', lastRunAt: NOW - 30_000, lastJumpAt: null },
  employees: [
    { id: 'k', name: 'Koordinatör', state: null, entries: [
      { kind: 'now', taskId: 't1', scheduleId: null, title: 'İş paketi tasarımı', at: NOW - 10 * 60_000, until: NOW + 45 * 60_000, basis: 'son 10 iş', note: null, priority: 2, dueAt: null, overdue: false, lowConfidence: false },
      { kind: 'queued', taskId: 't2', scheduleId: null, title: 'Gelir araştırması', at: NOW + 45 * 60_000, until: NOW + 75 * 60_000, basis: 'varsayılan', note: null, priority: 3, dueAt: null, overdue: false, lowConfidence: false },
      { kind: 'parked', taskId: 't3', scheduleId: null, title: 'Adım 1 penceresi', at: NOW + 24 * H + 45 * 60_000, until: null, basis: null, note: 'ölçüm penceresi dolsun', priority: 3, dueAt: null, overdue: false, lowConfidence: false },
      { kind: 'scheduled', taskId: null, scheduleId: 's1', title: 'Günlük ölçüm', at: NOW + 19 * H, until: null, basis: null, note: 'her gün 09:00', priority: 3, dueAt: null, overdue: false, lowConfidence: false },
    ] },
    { id: 'd', name: 'Deniz', state: 'uyuyor', entries: [
      { kind: 'queued', taskId: 't4', scheduleId: null, title: 'Harness', at: NOW + 75 * 60_000, until: NOW + 195 * 60_000, basis: 'varsayılan', note: '“İş paketi tasarımı” bitince', priority: 3, dueAt: NOW - H, overdue: true, lowConfidence: true },
    ] },
  ],
});

vi.mock('../net/api.ts', () => ({
  api: { agenda: vi.fn(async () => report()), parkTask: vi.fn(async () => ({})), releaseTask: vi.fn(async () => ({})), prioritizeTask: vi.fn(async () => ({})), scheduleAction: vi.fn(async () => ({})) },
}));
const { api } = await import('../net/api.ts');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AgendaTab', () => {
  it('shows the clock line, each employee’s entries with times and estimates, parked reasons, overdue and dependencies', async () => {
    useOffice.setState({ agendaRev: 0, views: {} });
    render(<AgendaTab />);
    await waitFor(() => expect(screen.getByText(/Adım 1 penceresi · Koordinatör/)).toBeTruthy());
    const k = screen.getByRole('region', { name: 'Koordinatör' });
    expect(k.textContent).toContain('İş paketi tasarımı');
    expect(k.textContent).toContain('~son 10 iş');
    expect(k.textContent).toContain('ölçüm penceresi dolsun');
    expect(k.textContent).toContain('her gün 09:00');
    const d = screen.getByRole('region', { name: 'Deniz' });
    expect(d.textContent).toContain('uyuyor');
    expect(d.textContent).toContain('“İş paketi tasarımı” bitince');
    expect(within(d).getByText(/son tarih geçti/i)).toBeTruthy();
  });

  it('the owner releases, parks (with a reason) and prioritizes; the buttons match the entry kind', async () => {
    useOffice.setState({ agendaRev: 0, views: {} });
    render(<AgendaTab />);
    await waitFor(() => expect(screen.getByRole('region', { name: 'Koordinatör' })).toBeTruthy());
    const k = screen.getByRole('region', { name: 'Koordinatör' });
    const parkedRow = within(k).getByText('Adım 1 penceresi').closest('li')!;
    fireEvent.click(within(parkedRow).getByRole('button', { name: 'Şimdi başlasın' }));
    await waitFor(() => expect(api.releaseTask).toHaveBeenCalledWith('t3'));
    const queuedRow = within(k).getByText('Gelir araştırması').closest('li')!;
    fireEvent.click(within(queuedRow).getByRole('button', { name: 'Öne al' }));
    await waitFor(() => expect(api.prioritizeTask).toHaveBeenCalledWith('t2'));
    fireEvent.click(within(queuedRow).getByRole('button', { name: 'Park et…' }));
    fireEvent.change(screen.getByLabelText('Gerekçe'), { target: { value: 'yarına kalsın' } });
    fireEvent.click(screen.getByRole('button', { name: 'Yarın 09:00' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Park et' })));
    await waitFor(() => expect(api.parkTask).toHaveBeenCalledWith('t2', expect.stringMatching(/^\d{4}-\d{2}-\d{2}T09:00$/), 'yarına kalsın'));
    const nowRow = within(k).getByText('İş paketi tasarımı').closest('li')!;
    expect(within(nowRow).queryByRole('button', { name: 'Şimdi başlasın' })).toBeNull();
    const routineRow = within(k).getByText('Günlük ölçüm').closest('li')!;
    fireEvent.click(within(routineRow).getByRole('button', { name: 'Duraklat' }));
    await waitFor(() => expect(api.scheduleAction).toHaveBeenCalledWith('s1', 'pause'));
  });

  it('switches to the timeline view', async () => {
    useOffice.setState({ agendaRev: 0, views: {} });
    render(<AgendaTab />);
    await waitFor(() => expect(screen.getByRole('region', { name: 'Koordinatör' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Zaman çizelgesi' }));
    expect(screen.getByRole('img', { name: /Koordinatör zaman çizelgesi/ })).toBeTruthy();
  });
});
```

`ui/Panel.test.tsx`: add `agenda: vi.fn(async () => ({ generatedAt: 0, horizonMs: 0, clock: { nextDueAt: null, nextDueLabel: null, lastRunAt: null, lastJumpAt: null }, employees: [{ id: 'e1', name: 'Ada', state: null, entries: [{ kind: 'queued', taskId: 't', scheduleId: null, title: 'Sıradaki iş', at: 1, until: 2, basis: 'varsayılan', note: null, priority: 3, dueAt: null, overdue: false, lowConfidence: false }] }] }))` to its api mock and a test:

```tsx
  it('shows the employee’s own agenda', async () => {
    // seed the store with employee e1 as the file's other tests do
    render(<Panel id="e1" />);
    await waitFor(() => expect(screen.getByRole('region', { name: 'Ajanda' }).textContent).toContain('Sıradaki iş'));
  });
```

`ui/EventItem.test.tsx`:

```tsx
  it('notes parks, returns and routines in the feed', () => {
    const base = { id: 't1', kind: 'work' as const, planId: null, title: 'Pencere', description: '', done: [], requester: 'owner', assignee: 'ada', priority: 3, dependsOn: [], status: 'parked' as const, chainDepth: 0, note: null, result: null, nudged: false, createdAt: 1, startedAt: null, finishedAt: null, notBefore: 5, parkedReason: 'ölçüm' };
    const { rerender } = render(<EventItem stored={{ seq: 1, employeeId: 'ada', ts: 0, event: { type: 'task.changed', change: 'parked', task: base } }} />);
    expect(screen.getByText(/Görev ertelendi: Pencere/)).toBeTruthy();
    rerender(<EventItem stored={{ seq: 2, employeeId: 'ada', ts: 0, event: { type: 'task.changed', change: 'returned', task: { ...base, status: 'waiting' } } }} />);
    expect(screen.getByText('Görev sıraya döndü: Pencere')).toBeTruthy();
    const schedule = { id: 's1', title: 'Günlük', description: '', done: [], assignee: 'ada', reviewer: null, planId: null, priority: 3, difficulty: null, cron: '0 9 * * *', until: null, status: 'active' as const, nextRunAt: 5, lastRunAt: null, lastTaskId: null, skipCount: 0, failCount: 0, createdBy: 'c', createdAt: 1, note: null };
    rerender(<EventItem stored={{ seq: 3, employeeId: 'c', ts: 0, event: { type: 'schedule.changed', change: 'fired', schedule } }} />);
    expect(screen.getByText('Rutin çalıştı: Günlük')).toBeTruthy();
    rerender(<EventItem stored={{ seq: 4, employeeId: null, ts: 0, event: { type: 'clock.jumped', expectedAt: 1, actualAt: 2 } }} />);
    expect(screen.getByText(/Saat atladı/)).toBeTruthy();
  });
```

`ui/BudgetTabs.test.tsx`:

```tsx
  it('edits the scheduler keys', async () => {
    render(<ConstitutionTab />);
    fireEvent.change(screen.getByLabelText('Varsayılan görev süresi (dk)'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Rutin aralığı en az (dk)'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('En fazla rutin'), { target: { value: '5' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Kaydet' })));
    expect(api.setConstitution).toHaveBeenCalledWith(expect.objectContaining({ defaultTaskMinutes: 30, minScheduleMinutes: 120, maxSchedules: 5 }));
  });
```

`ui/CompanyView.test.tsx`: in the board test add a parked task `task('Ertelenen', { status: 'parked', notBefore: Date.now() + 3_600_000, parkedReason: 'bekle' })` and assert `within(screen.getByRole('region', { name: 'Bekliyor' })).getByText(/ertelendi/)`; and a test that the tab list has `Ajanda` (`screen.getByRole('tab', { name: 'Ajanda' })`).

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/office-web && npx vitest run`
Expected: FAIL in the new tests.

- [ ] **Step 3: Store and API client**

`store/reducers.ts`: `OfficeData` gains `schedules: Record<string, Schedule>; clock: ClockStatus | null; agendaRev: number;` (EMPTY_DATA: `schedules: {}, clock: null, agendaRev: 0`); the snapshot reducer sets `schedules: Object.fromEntries((s.schedules ?? []).map((x) => [x.id, x])), clock: s.clock ?? null, agendaRev: d.agendaRev + 1`; `applyEvent` adds:

```ts
  if (ev.type === 'schedule.changed') next.schedules = { ...d.schedules, [ev.schedule.id]: ev.schedule };
  if (['task.changed', 'plan.changed', 'schedule.changed', 'lifecycle.changed', 'budget.changed', 'company.paused', 'clock.jumped'].includes(ev.type)) next.agendaRev = d.agendaRev + 1;
```

`net/api.ts` adds:

```ts
  agenda: () => request<AgendaReport>('GET', '/api/agenda'),
  parkTask: (id: string, until: string, reason: string) => request<Task>('POST', `/api/tasks/${encodeURIComponent(id)}/park`, { until, reason }),
  releaseTask: (id: string) => request<Task>('POST', `/api/tasks/${encodeURIComponent(id)}/release`),
  prioritizeTask: (id: string) => request<Task>('POST', `/api/tasks/${encodeURIComponent(id)}/prioritize`, { priority: 1 }),
  scheduleAction: (id: string, action: 'pause' | 'resume' | 'stop') => request<Schedule>('POST', `/api/schedules/${encodeURIComponent(id)}/${action}`),
```

`labels.ts` adds `export const SCHEDULE_STATUS_LABELS: Record<ScheduleStatus, string> = { active: 'Sürüyor', paused: 'Duraklatıldı', stopped: 'Durduruldu' };` and `export const AGENDA_KIND_LABELS: Record<AgendaEntry['kind'], string> = { now: 'Şimdi', queued: 'Sırada', review_wait: 'İnceleme bekliyor', parked: 'Ertelendi', not_before: 'Başlangıç', scheduled: 'Rutin' };`.

- [ ] **Step 4: The agenda hook and tab**

Create `ui/useAgenda.ts`:

```ts
import { useEffect, useState } from 'react';
import type { AgendaReport } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';

/** The agenda is derived on the server: fetched on open and a second after anything that changes it. */
export function useAgenda(): { report: AgendaReport | null; error: string | null } {
  const rev = useOffice((s) => s.agendaRev);
  const [report, setReport] = useState<AgendaReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      api.agenda().then(
        (r) => {
          if (alive) {
            setReport(r);
            setError(null);
          }
        },
        (err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)),
      );
    }, report === null ? 0 : 1000);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [rev]);
  return { report, error };
}
```

Create `ui/AgendaTab.tsx` with: a header line (`clock.nextDueLabel` + `formatWhen`-like local time via `new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })` plus "bugün/yarın" logic copied from the server's `formatWhen` into `ui/format.ts` as `formatWhenTR(ms, now)`), a Liste / Zaman çizelgesi toggle (two buttons, `aria-pressed`), per employee a `<section aria-label={name}>` with the state line and a `<ul>` of `<li>` rows: time column (`at` / `at → until`, `~` when estimated), title, badges (`AGENDA_KIND_LABELS[kind]`, `son tarih geçti` in red when `overdue`, `~basis`, `note`), and buttons by kind: `queued` → Şimdi başlasın (only when the row has a future `at` beyond now because of `not_before`? — no: for `queued` show **Park et…** and **Öne al**; for `not_before` and `parked` show **Şimdi başlasın** and **Park et…**; for `now` show **Park et…**; for `scheduled` show **Duraklat**/**Sürdür** (by the schedule's status from the store) and **Durdur**; `review_wait` no buttons). "Park et…" opens an inline `<form>` under the row with preset buttons (`+1 saat`, `+6 saat`, `Yarın 09:00`, `Yarın aynı saat`), a `datetime-local` input (`aria-label="Tarih ve saat"`), a reason input (`aria-label="Gerekçe"`, default `Sahibi erteledi`) and a submit button **Park et**; presets fill the input with a local `YYYY-MM-DDTHH:MM` string and the form submits `api.parkTask(taskId, value, reason)`. The timeline view: per employee an inline `<svg role="img" aria-label={`${name} zaman çizelgesi`}>` spanning 24 h (or 7 d via a second toggle) from `now`, one bar per entry with `at`/`until` (parked/scheduled as a tick with a diamond), colours by kind from CSS variables (`--info` running, `--muted` parked, `--bad` overdue, `--ok` scheduled), hour ticks. Export `AgendaSection({ id })` that renders the same list for one employee (used by `Panel`), with a `<section className="agenda-section" aria-label="Ajanda">` wrapper. After any button succeeds, bump `useOffice.setState((s) => ({ agendaRev: s.agendaRev + 1 }))` so the hook refetches.

Wire: `CompanyView.tsx` `TABS` gains `['agenda', 'Ajanda']` after `goals`, and renders `<AgendaTab />`; the board's task card shows, for `status === 'parked'`, a badge `ertelendi · <formatWhenTR(notBefore)>` and places parked tasks in the "Bekliyor" column (filter `t.status === status || (status === 'waiting' && t.status === 'parked')`). `Panel.tsx` renders `<AgendaSection id={id} />` right after `<EmployeeFileSection id={id} />`. `EventItem.tsx`: `task.changed` cases `parked` → `Görev ertelendi: {title} ({formatWhenTR(notBefore)} — {parkedReason})`, `returned` → `Görev sıraya döndü: {title}`; `schedule.changed` → `Rutin {açıldı|güncellendi|çalıştı|atlandı|duraklatıldı|sürdürüldü|durduruldu}: {title}`; `clock.jumped` → `Saat atladı: beklenen … , gerçek …`; `clock.error` → `Saat: {job} başarısız — {message}`. `BudgetTabs.tsx` `FIELDS` gains the three number fields (labels exactly `Varsayılan görev süresi (dk)`, `Rutin aralığı en az (dk)`, `En fazla rutin`). Styles: `.agenda`, `.agenda-row` grid (`7.5em 1fr auto`), `.badge.kind-*`, `.badge.overdue { color: var(--bad) }`, `.agenda-timeline svg { width: 100%; height: auto }`, `.park-form` inline row; phone width stacks the grid.

- [ ] **Step 5: Run the web suite and the type check**

Run: `cd apps/office-web && npx vitest run > /tmp/cc-sched-t8.log 2>&1; tail -8 /tmp/cc-sched-t8.log; cd ../.. && pnpm -r --if-present typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 6: Visual check**

Build (`pnpm --filter @cc/office-web build`), seed a temp office (a parked task, a start-timed task, a routine, an overdue task, a sleeping employee) with a small script like the stage-1 visual check, start the server on a free port (`OFFICE_DATA_DIR=<tmp> OFFICE_PORT=4393 OFFICE_CLAUDE_COMMAND='["/bin/false"]'`) and screenshot the Ajanda tab (list and timeline) and an employee panel with headless Chrome (`--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`). Fix what looks wrong (overlaps, wrapping, unreadable badges). Stop the server.

- [ ] **Step 7: Commit**

```bash
git add apps/office-web/src
git commit -m "feat(office-web): the agenda — who does what when, per employee and for the office, with the owner's park, release and prioritize"
```

---

### Task 9: Lockdown, guides, the real-claude smoke tests, docs

**Files:**
- Modify: `apps/office-server/src/claude/args.ts`, `apps/office-server/test/args.test.ts`
- Modify: `apps/office-server/src/company/craft/working.md`, `coordination.md`, `pm.md`
- Create: `apps/office-server/test/lockdown.real.test.ts`, `apps/office-server/test/scheduler.smoke.real.test.ts` (both opt-in)
- Modify: `apps/office-server/package.json` (`smoke`), `README.md`, the spec's status line

- [ ] **Step 1: Write the failing tests**

In `apps/office-server/test/args.test.ts` append:

```ts
  it('closes Claude’s own scheduler in every employee session', () => {
    const args = sessionArgs({ model: 'haiku', sessionId: 's', resume: false, home: '/home/test' });
    const i = args.indexOf('--disallowedTools');
    expect(i).toBeGreaterThan(0);
    expect(args.slice(i + 1, i + 6)).toEqual(['CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup', 'RemoteTrigger']);
    // The list must come before the session id so nothing is swallowed into it.
    expect(args.indexOf('--session-id')).toBeGreaterThan(i + 5);
  });
```

Create `apps/office-server/test/lockdown.real.test.ts`:

```ts
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { sessionArgs } from '../src/claude/args.ts';
import { tempDir } from './helpers.ts';

const enabled = process.env.OFFICE_SMOKE === '1';

describe.skipIf(!enabled)('lockdown with the real claude CLI', () => {
  it('a session opened with the office’s arguments has none of Claude’s scheduling tools', async () => {
    const cwd = tempDir();
    const args = sessionArgs({ model: 'haiku', sessionId: crypto.randomUUID(), resume: false });
    const child = spawn('claude', args, { cwd, stdio: ['pipe', 'pipe', 'ignore'] });
    let tools: string[] | null = null;
    const done = new Promise<void>((resolve) => {
      let buf = '';
      child.stdout.on('data', (chunk: Buffer) => {
        buf += chunk.toString('utf8');
        for (const line of buf.split('\n')) {
          try {
            const o = JSON.parse(line) as { type?: string; subtype?: string; tools?: string[] };
            if (o.type === 'system' && o.subtype === 'init' && o.tools) {
              tools = o.tools;
              resolve();
            }
          } catch {
            // partial line
          }
        }
      });
    });
    child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: 'Reply with the single word ok.' } })}\n`);
    await Promise.race([done, new Promise((r) => setTimeout(r, 90_000))]);
    child.kill('SIGKILL');
    expect(tools).not.toBeNull();
    for (const banned of ['CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup', 'RemoteTrigger']) expect(tools).not.toContain(banned);
    expect(tools).toContain('Bash');
  }, 120_000);
});
```

- [ ] **Step 2: Run the args test to see it fail**

Run: `cd apps/office-server && npx vitest run test/args.test.ts`
Expected: FAIL — `--disallowedTools` absent.

- [ ] **Step 3: Args**

In `apps/office-server/src/claude/args.ts`, add

```ts
/** Claude's own scheduler is closed in the office (spec §8): time goes through the office's clock, which the owner sees and the rules govern. */
export const DISALLOWED_TOOLS = ['CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup', 'RemoteTrigger'] as const;
```

and in `sessionArgs`, after `...settingsArgs(o.home),` insert `'--disallowedTools', ...DISALLOWED_TOOLS,` (before the mcp config and the session id).

- [ ] **Step 4: Guides**

`craft/working.md` — add a bullet after the first:

```md
- **Bekleyeceğin işi açık bırakma.** Bir pencere dolsun, bir cevap gelsin diye bekleyeceksen görevi `taskPark` ile
  park et: dönüş saati (`+6h`, `+1d`, `2026-10-08T14:55`) ve gerekçe. Sıran boşalır, ofis sıradaki işini verir ve park
  edileni saatinde geri getirir. Claude'un kendi zamanlayıcısı (`CronCreate`, `/loop`, `/schedule`) bu ofiste kapalıdır:
  zamana bağlı her iş ofisin saatinden geçer.
```

`craft/coordination.md` — add item 10 (before the "Ekip lideri" closing line):

```md
10. **Zamanı ofise bırak.** Zamana bağlı işin üç yolu var: `taskCreate`'te `startAfter` (şu saatten sonra başla) ve
    `dueAt` (son tarih); bekleyen işi `taskPark` ile park etmek; tekrarlayan işi `scheduleCreate` ile rutin yapmak.
    Rutinler kota yer: az tut, anayasanın izin verdiğinden sık kurma. `agendaRead` kimin ne zaman boş olduğunu söyler;
    iş dağıtmadan önce bak.
```

`craft/pm.md` — in the "Nabız" bullet, append the sentence: `Bir ölçüm penceresi ya da bekleme süresi varsa görevi park et (taskPark); kendi sıranı kilitleme.`

- [ ] **Step 5: The real-claude smoke test**

Create `apps/office-server/test/scheduler.smoke.real.test.ts`, wired like `test/craft.smoke.real.test.ts` (same setup block, plus `ScheduleStore`, `Scheduling`, `Clock` with a 5 s safety interval, `Agenda`; `autonomy: 'free'`), scenario:

```ts
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
```

with `{ timeout: 900_000 }`, and the usual cleanup (stop the clock, the dispatcher, shutdown the engine, close the API).

- [ ] **Step 6: Run the real tests once**

Run: `cd apps/office-server && OFFICE_SMOKE=1 npx vitest run test/lockdown.real.test.ts test/scheduler.smoke.real.test.ts > /tmp/cc-sched-smoke.log 2>&1; tail -20 /tmp/cc-sched-smoke.log; rm -rf ~/.claude/projects/*tmp-cc-*`
Expected: both PASS. If the lockdown test still lists a Cron tool, `--disallowedTools` did not take: try `--disallowedTools` with a comma-joined single argument (`'CronCreate,CronDelete,…'`) and re-run; record which form worked in the ledger and in the args test.

- [ ] **Step 7: Docs and scripts**

`apps/office-server/package.json`: `smoke` gains `test/lockdown.real.test.ts test/scheduler.smoke.real.test.ts`. `README.md`: after "Proje yöneticisi ve yaşayan döngü", a section **Zamanlama ve ajanda**: park (`taskPark`), start time and due date, routines (`scheduleCreate`, anayasa limits), the clock (what it is, catch-up), the Ajanda tab and the owner's buttons, Claude's own scheduler closed. Spec header `- Durum:` says implemented. `docs/superpowers/notes/2026-10-07-company-deferred.md` gets any deferred minors.

- [ ] **Step 8: Full verification and commit**

Run: `pnpm -r --if-present typecheck && pnpm -r --if-present test > /tmp/cc-sched-final.log 2>&1; grep -E "Tests +[0-9]" /tmp/cc-sched-final.log`
Expected: typecheck clean; every package green.

```bash
git add apps/office-server/src/claude/args.ts apps/office-server/test/args.test.ts apps/office-server/test/lockdown.real.test.ts apps/office-server/test/scheduler.smoke.real.test.ts apps/office-server/src/company/craft apps/office-server/package.json README.md docs/superpowers/specs/2026-10-07-office-scheduler-design.md docs/superpowers/notes/2026-10-07-company-deferred.md
git commit -m "feat(office): Claude's own scheduler is closed in employee sessions; guides, smoke tests and docs for the office clock"
```
