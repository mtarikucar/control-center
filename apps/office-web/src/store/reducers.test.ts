import { describe, expect, it } from 'vitest';
import type { BudgetSummary, Employee, OfficeEvent, OfficeSnapshot, Plan, Proposal, StoredEvent, Task } from '@cc/shared';
import { EMPTY_DATA, MAX_EVENTS, addEmployee, applyEvent, applySnapshot, mergeEvents, needsRefresh, openToolSince } from './reducers.ts';

const employee = (over: Partial<Employee> = {}): Employee => ({
  id: 'e1', slug: 'ada', name: 'Ada', role: 'r', model: 'haiku', characterId: 'coder', title: '', team: '', kind: 'member', reportsTo: null, deskIndex: 0,
  sessionId: 's1', sessionStarted: false, lifecycle: 'idle', limitResetsAt: null, lastError: null, createdAt: 1, ...over,
});
const snapshot = (over: Partial<OfficeSnapshot> = {}): OfficeSnapshot => ({ employees: [employee()], quota: null, usage: {}, lastSeq: 10, ...over });
let seq = 10;
const stored = (event: OfficeEvent, employeeId: string | null = 'e1', ts = 1000): StoredEvent => ({ seq: ++seq, employeeId, ts, event });
const usage = { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0 };

describe('applySnapshot', () => {
  it('builds views and keeps loaded events of known employees', () => {
    const first = applySnapshot(EMPTY_DATA, snapshot());
    const withEvent = applyEvent(first, stored({ type: 'turn.started' }));
    const again = applySnapshot(withEvent, snapshot({ lastSeq: withEvent.lastSeq + 1, employees: [employee({ lifecycle: 'working' })] }));
    expect(again.views.e1?.events).toHaveLength(1);
    expect(again.views.e1?.employee.lifecycle).toBe('working');
    expect(again.lastSeq).toBe(withEvent.lastSeq + 1);
  });

  it('drops employees that are no longer in the snapshot', () => {
    const d = applySnapshot(applySnapshot(EMPTY_DATA, snapshot()), snapshot({ employees: [] }));
    expect(d.views).toEqual({});
  });
});

describe('applyEvent', () => {
  const base = () => applySnapshot(EMPTY_DATA, snapshot());

  it('follows lifecycle, tools, turns and session start', () => {
    let d = base();
    d = applyEvent(d, stored({ type: 'lifecycle.changed', from: 'idle', to: 'working', reason: 'x' }));
    d = applyEvent(d, stored({ type: 'session.started', model: 'm', mcp: [] }));
    d = applyEvent(d, stored({ type: 'tool.started', toolUseId: 't1', name: 'Bash', input: {} }, 'e1', 2000));
    expect(d.views.e1?.employee).toMatchObject({ lifecycle: 'working', sessionStarted: true });
    expect(openToolSince(d.views.e1!)).toBe(2000);
    d = applyEvent(d, stored({ type: 'tool.finished', toolUseId: 't1', isError: false, output: '' }));
    expect(openToolSince(d.views.e1!)).toBeNull();
    d = applyEvent(d, stored({ type: 'turn.finished', ok: true, subtype: 'success', usage, costUsd: 0.01, numTurns: 1, queuedTurns: 0, sessionUsage: null, sessionCostUsd: 0.01 }, 'e1', 3000));
    expect(d.views.e1?.idleSince).toBe(3000);
    expect(d.usage.e1?.today).toMatchObject({ inputTokens: 10, outputTokens: 20, costUsd: 0.01 });
    d = applyEvent(d, stored({ type: 'side.answer', text: 'a', ok: true, usage, costUsd: 0.002 }));
    expect(d.usage.e1?.total.costUsd).toBeCloseTo(0.012);
    expect(d.usage.e1?.total).toMatchObject({ turns: 1, sideAnswers: 1 });
  });

  it('keeps the turn open while claude has queued turns', () => {
    let d = applyEvent(base(), stored({ type: 'tool.started', toolUseId: 't1', name: 'Bash', input: {} }, 'e1', 2000));
    d = applyEvent(d, stored({ type: 'turn.finished', ok: true, subtype: 'success', usage, costUsd: 0, numTurns: 1, queuedTurns: 1, sessionUsage: null, sessionCostUsd: 0 }, 'e1', 3000));
    expect(d.views.e1?.idleSince).toBeNull();
    expect(openToolSince(d.views.e1!)).toBe(2000);
  });

  it('review focus: ignores a replayed event it already has', () => {
    const e = stored({ type: 'message.assistant', text: 'bir kez' });
    const d = applyEvent(applyEvent(base(), e), e);
    expect(d.views.e1?.events).toHaveLength(1);
  });

  it('updates the quota but keeps a window the update omits', () => {
    let d = applyEvent(base(), stored({ type: 'quota.updated', status: 'allowed', fiveHour: { utilization: 0.1, resetsAt: 5 }, sevenDay: { utilization: 0.2, resetsAt: 6 } }, null, 7));
    d = applyEvent(d, stored({ type: 'quota.updated', status: 'allowed_warning', fiveHour: { utilization: 0.9, resetsAt: 5 }, sevenDay: null }, null, 8));
    expect(d.quota).toEqual({ status: 'allowed_warning', fiveHour: { utilization: 0.9, resetsAt: 5 }, sevenDay: { utilization: 0.2, resetsAt: 6 }, updatedAt: 8 });
  });

  it('caps the event list and ignores unknown employees', () => {
    let d = base();
    for (let i = 0; i < MAX_EVENTS + 5; i += 1) d = applyEvent(d, stored({ type: 'turn.started' }));
    expect(d.views.e1?.events).toHaveLength(MAX_EVENTS);
    const before = d.views;
    d = applyEvent(d, stored({ type: 'turn.started' }, 'ghost'));
    expect(d.views).toBe(before);
  });

  it('asks for a refresh when someone is hired or fired', () => {
    expect(needsRefresh(stored({ type: 'employee.hired', name: 'x' }))).toBe(true);
    expect(needsRefresh(stored({ type: 'employee.fired' }))).toBe(true);
    expect(needsRefresh(stored({ type: 'lifecycle.changed', from: 'error', to: 'idle', reason: 'x' }))).toBe(true);
    expect(needsRefresh(stored({ type: 'turn.started' }))).toBe(false);
  });
});

describe('mergeEvents', () => {
  it('merges history with live events in seq order and derives turn state', () => {
    let d = applySnapshot(EMPTY_DATA, snapshot());
    const live = stored({ type: 'message.assistant', text: 'canlı' }, 'e1', 9000);
    d = applyEvent(d, live);
    const history = [
      { seq: 1, employeeId: 'e1', ts: 100, event: { type: 'tool.started', toolUseId: 'old', name: 'Bash', input: {} } },
      { seq: 2, employeeId: 'e1', ts: 200, event: { type: 'turn.finished', ok: true, subtype: 'success', usage, costUsd: 0, numTurns: 1, queuedTurns: 0, sessionUsage: null, sessionCostUsd: 0 } },
      live,
    ] as StoredEvent[];
    const view = mergeEvents(d.views.e1!, history);
    expect(view.events.map((e) => e.seq)).toEqual([1, 2, live.seq]);
    expect(view.eventsLoaded).toBe(true);
    expect(view.idleSince).toBe(200);
    expect(openToolSince(view)).toBeNull();
  });
});

describe('usage watermark', () => {
  const tf = (seq: number, input: number): StoredEvent => ({
    seq, employeeId: 'e1', ts: seq,
    event: { type: 'turn.finished', ok: true, subtype: 'success', usage: { inputTokens: input, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }, costUsd: 0, numTurns: 1, queuedTurns: 0, sessionUsage: null, sessionCostUsd: 0 },
  });
  const counted = { today: { inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0, turns: 1, sideAnswers: 0 }, total: { inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0, turns: 1, sideAnswers: 0 } };

  it('review focus: counts usage once across a reconnect (snapshot, then replay of events it already covers)', () => {
    let d = applySnapshot(EMPTY_DATA, snapshot({ lastSeq: 10, usage: { e1: counted } }));
    d = applyEvent(d, tf(9, 40));
    d = applyEvent(d, tf(10, 60));
    d = applyEvent(d, tf(11, 10));
    expect(d.usage.e1?.today.inputTokens).toBe(110);
  });

  it('an HTTP snapshot does not move the replay point, a live one does', () => {
    const base = applyEvent(applySnapshot(EMPTY_DATA, snapshot({ lastSeq: 3 })), tf(5, 1));
    expect(applySnapshot(base, snapshot({ lastSeq: 20 }), 'http').lastSeq).toBe(5);
    expect(applySnapshot(base, snapshot({ lastSeq: 20 }), 'live').lastSeq).toBe(20);
  });

  it('ignores a snapshot older than what it already shows', () => {
    const fresh = applySnapshot(EMPTY_DATA, snapshot({ lastSeq: 30, usage: { e1: counted } }));
    const stale = applySnapshot(fresh, snapshot({ lastSeq: 12, usage: {}, employees: [] }), 'http');
    expect(stale.usage.e1?.today.inputTokens).toBe(100);
    expect(Object.keys(stale.views)).toEqual(['e1']);
  });
});

describe('idle clock and running tools', () => {
  const base = () => applySnapshot(EMPTY_DATA, snapshot());

  it('starts the idle clock when the employee becomes idle, not only when a turn ends', () => {
    const d = applyEvent(base(), stored({ type: 'lifecycle.changed', from: 'interrupted', to: 'idle', reason: 'devam' }, 'e1', 5000));
    expect(d.views.e1?.idleSince).toBe(5000);
  });

  it('forgets running tools once the employee stops working (a crash never reports them finished)', () => {
    let d = base();
    d = applyEvent(d, stored({ type: 'lifecycle.changed', from: 'idle', to: 'working', reason: 'x' }));
    d = applyEvent(d, stored({ type: 'tool.started', toolUseId: 't1', name: 'Bash', input: {} }, 'e1', 2000));
    d = applyEvent(d, stored({ type: 'lifecycle.changed', from: 'working', to: 'error', reason: 'çöktü' }));
    expect(openToolSince(d.views.e1!)).toBeNull();
  });

  it('derives both from loaded history too', () => {
    const view = base().views.e1!;
    const merged = mergeEvents(view, [
      { seq: 1, employeeId: 'e1', ts: 100, event: { type: 'tool.started', toolUseId: 't1', name: 'Bash', input: {} } },
      { seq: 2, employeeId: 'e1', ts: 200, event: { type: 'lifecycle.changed', from: 'working', to: 'interrupted', reason: 'x' } },
      { seq: 3, employeeId: 'e1', ts: 300, event: { type: 'lifecycle.changed', from: 'interrupted', to: 'idle', reason: 'x' } },
    ]);
    expect(openToolSince(merged)).toBeNull();
    expect(merged.idleSince).toBe(300);
  });

  it('knows when it has the whole roster', () => {
    expect(EMPTY_DATA.synced).toBe(false);
    expect(applySnapshot(EMPTY_DATA, snapshot()).synced).toBe(true);
  });
});

describe('addEmployee', () => {
  it('shows a just-hired employee before the next snapshot, and leaves a known one alone', () => {
    const d = applySnapshot(EMPTY_DATA, snapshot());
    const withNew = addEmployee(d, employee({ id: 'e2', name: 'Can' }));
    expect(withNew.views.e2?.employee.name).toBe('Can');
    expect(withNew.views.e2?.eventsLoaded).toBe(false);
    const withEvent = applyEvent(d, stored({ type: 'turn.started' }));
    expect(addEmployee(withEvent, employee()).views.e1).toBe(withEvent.views.e1);
  });
});

describe('a restarted office log', () => {
  it('starts over from a live snapshot that is behind what the page has seen (the database was reset)', () => {
    let d = applySnapshot(EMPTY_DATA, snapshot({ lastSeq: 900 }));
    d = applyEvent(d, { seq: 901, employeeId: 'e1', ts: 1, event: { type: 'turn.started' } });
    const fresh = applySnapshot(d, snapshot({ lastSeq: 3, employees: [employee({ id: 'e9', name: 'Yeni' })] }), 'live');
    expect(Object.keys(fresh.views)).toEqual(['e9']);
    expect(fresh).toMatchObject({ lastSeq: 3, usageSeq: 3, synced: true });
  });
});

describe('company data', () => {
  const plan = (over: Partial<Plan> = {}): Plan => ({
    id: 'p1', title: 'Video', goal: 'g', approach: 'a', people: '', steps: [], quotaPct: null, usd: null, days: null, risks: '',
    status: 'draft', version: 1, proposedBy: 'e1', createdAt: 1, updatedAt: 1, approvedAt: null, ...over,
  });
  const task = (over: Partial<Task> = {}): Task => ({
    id: 't1', kind: 'work', planId: 'p1', title: 'Senaryo', description: '', done: [], requester: 'owner', assignee: 'e1', priority: 3, dependsOn: [],
    status: 'waiting', chainDepth: 0, note: null, result: null, nudged: false, createdAt: 1, startedAt: null, finishedAt: null, ...over,
  });

  it('takes plans and tasks from the snapshot, and keeps them current from events', () => {
    let d = applySnapshot(EMPTY_DATA, snapshot({ tasks: [task()], plans: [{ ...plan(), streams: [] }] }));
    expect(d.tasks.t1?.status).toBe('waiting');
    expect(d.plans.p1?.status).toBe('draft');
    d = applyEvent(d, stored({ type: 'plan.changed', change: 'approved', plan: plan({ status: 'approved' }) }));
    d = applyEvent(d, stored({ type: 'task.changed', change: 'started', task: task({ status: 'in_progress' }) }));
    expect(d.plans.p1?.status).toBe('approved');
    expect(d.tasks.t1?.status).toBe('in_progress');
  });

  it('keeps company events even for someone the page does not know yet', () => {
    const d = applyEvent(EMPTY_DATA, stored({ type: 'task.changed', change: 'created', task: task({ id: 't9', assignee: 'stranger' }) }, 'stranger'));
    expect(d.tasks.t9?.title).toBe('Senaryo');
  });

  it('refreshes when someone’s role changes', () => {
    expect(needsRefresh(stored({ type: 'role.changed', kind: 'coordinator', title: 'K', team: '' }))).toBe(true);
  });

  it('management cycle §3.4: a plan’s streams keep the status the snapshot gave them through a plan.changed; a new stream takes it from the tasks the page has', () => {
    const streams = [{ id: 'api', title: 'API', owner: 'e1', dependsOn: [] }, { id: 'ui', title: 'Arayüz', owner: 'alınacak: tasarımcı', dependsOn: ['api'] }];
    let d = applySnapshot(EMPTY_DATA, snapshot({ tasks: [task({ streamId: 'ui', status: 'in_progress' })], plans: [{ ...plan({ status: 'approved' }), streams: [{ ...streams[0]!, status: 'done' }, { ...streams[1]!, status: 'active' }] }] }));
    expect(d.plans.p1?.streams?.map((x) => x.status)).toEqual(['done', 'active']);
    // The event's plan has no statuses: the known ones stay, a new stream's comes from the page's tasks.
    d = applyEvent(d, stored({ type: 'plan.changed', change: 'revised', plan: plan({ status: 'approved', version: 2, streams: [...streams, { id: 'doc', title: 'Belgeler', owner: 'e1', dependsOn: [] }] }) }));
    expect(d.plans.p1?.version).toBe(2);
    expect(d.plans.p1?.streams?.map((x) => [x.id, x.status])).toEqual([['api', 'done'], ['ui', 'active'], ['doc', 'planned']]);
    // A plan from before streams stays as it was.
    d = applyEvent(d, stored({ type: 'plan.changed', change: 'proposed', plan: plan({ id: 'p2' }) }));
    expect(d.plans.p2?.streams).toBeUndefined();
  });

  it('a stream’s status is the server’s: a stream task’s change or a plan with streams asks for a fresh snapshot, other tasks and plans do not', () => {
    expect(needsRefresh(stored({ type: 'task.changed', change: 'finished', task: task({ streamId: 'api', status: 'done' }) }))).toBe(true);
    expect(needsRefresh(stored({ type: 'task.changed', change: 'finished', task: task({ status: 'done' }) }))).toBe(false);
    expect(needsRefresh(stored({ type: 'plan.changed', change: 'revised', plan: plan({ streams: [{ id: 'api', title: 'API', owner: 'e1', dependsOn: [] }] }) }))).toBe(true);
    expect(needsRefresh(stored({ type: 'plan.changed', change: 'approved', plan: plan({ streams: [] }) }))).toBe(false);
  });

  it('a server without the company layer gives empty plans and tasks', () => {
    const d = applySnapshot(EMPTY_DATA, snapshot());
    expect(d.tasks).toEqual({});
    expect(d.plans).toEqual({});
  });
});

describe('company memory', () => {
  it('counts memory changes so open tabs know to reload', () => {
    let d = applySnapshot(EMPTY_DATA, snapshot());
    expect(d.memoryRev).toBe(0);
    d = applyEvent(d, stored({ type: 'note.written', id: 1, title: 'n', tags: [] }));
    d = applyEvent(d, stored({ type: 'playbook.updated', topic: 'Test', version: 2, reason: '' }));
    expect(d.memoryRev).toBe(2);
    expect(applySnapshot(d, snapshot({ lastSeq: d.lastSeq + 1 })).memoryRev).toBe(2);
  });
});

describe('budget', () => {
  const summary = (pct: number): BudgetSummary => ({
    constitution: { maxEmployees: 8, ownerReservePct: pct, monthlyUsdCap: null, chainDepth: 5, tasksPerDay: 30, openTasksPerPlan: 60, idleSleepMinutes: 30, digestHours: [9, 17], coordinatorModels: { kickoff: 'fable', cycle: 'opus', routine: 'sonnet' }, cacheTtlMinutes: 5, difficultyModels: { easy: 'haiku', medium: 'sonnet', hard: 'opus', critical: 'fable' }, digestEnabled: false, modelPolicyEnabled: false, difficultyModelsEnabled: false, autonomy: 'free', activeGoals: 10, pulseHours: 6, idleCapacityHours: 2, defaultTaskMinutes: 45, minScheduleMinutes: 60, maxSchedules: 20 },
    reserve: { active: false, limitPct: 100 - pct, fiveHourPct: null, sevenDayPct: null },
    month: { key: '2026-10', usd: 0 },
    plans: {},
  });

  it('takes the budget from the snapshot and keeps it current; a model change reaches the employee', () => {
    let d = applySnapshot(EMPTY_DATA, snapshot({ budget: summary(25) }));
    expect(d.budget?.constitution.ownerReservePct).toBe(25);
    d = applyEvent(d, stored({ type: 'budget.changed', budget: summary(40) }, null));
    expect(d.budget?.reserve.limitPct).toBe(60);
    d = applyEvent(d, stored({ type: 'model.changed', model: 'opus' }));
    expect(d.views.e1?.employee.model).toBe('opus');
    expect(applySnapshot(EMPTY_DATA, snapshot()).budget).toBeNull();
  });

  it('a budget logged by an older office (the coordinator’s models before the turn types) is read as today’s', () => {
    const old = summary(40);
    const shape = { ...old, constitution: { ...old.constitution, coordinatorModels: { owner: 'opus', decision: 'sonnet', digest: 'haiku' } } };
    const d = applyEvent(applySnapshot(EMPTY_DATA, snapshot({ budget: summary(25) })), stored({ type: 'budget.changed', budget: shape as unknown as BudgetSummary }, null));
    expect(d.budget?.constitution.coordinatorModels).toEqual({ kickoff: 'fable', cycle: 'opus', routine: 'sonnet' });
    expect(d.budget?.constitution.ownerReservePct).toBe(40);
  });
});

describe('proposals, passes and reports', () => {
  const proposal = (over: Partial<Proposal> = {}): Proposal => ({
    id: 'q1', ts: 1, by: 'e1', kind: 'purchase', title: 'Telefon hattı', text: 't', usd: 12, planId: null, status: 'owner', routedTo: null,
    decidedBy: null, note: null, decidedAt: null, ...over,
  });
  const task = (over: Partial<Task> = {}): Task => ({
    id: 't7', kind: 'work', planId: null, title: 'Slogan', description: '', done: [], requester: 'e2', assignee: 'e1', priority: 3, dependsOn: [],
    status: 'waiting', chainDepth: 1, note: null, result: null, nudged: false, createdAt: 1, startedAt: null, finishedAt: null, ...over,
  });

  it('keeps proposals from the snapshot and the feed', () => {
    let d = applySnapshot(EMPTY_DATA, snapshot({ proposals: [proposal()] }));
    expect(d.proposals.q1?.status).toBe('owner');
    d = applyEvent(d, stored({ type: 'proposal.changed', change: 'accepted', proposal: proposal({ status: 'accepted' }) }));
    expect(d.proposals.q1?.status).toBe('accepted');
  });

  it('notes a pass on the receiver, but not the owner’s own tasks', () => {
    let d = applySnapshot(EMPTY_DATA, snapshot());
    d = applyEvent(d, stored({ type: 'task.changed', change: 'created', task: task() }, 'e1', 5000));
    expect(d.pings.e1).toEqual({ text: 'Yeni iş: Slogan', at: 5000 });
    d = applyEvent(d, stored({ type: 'task.changed', change: 'created', task: task({ id: 't8', requester: 'owner', title: 'Sahibin işi' }) }, 'e1', 6000));
    expect(d.pings.e1?.text).toBe('Yeni iş: Slogan');
  });

  it('counts reports not yet seen', () => {
    let d = applySnapshot(EMPTY_DATA, snapshot());
    d = applyEvent(d, stored({ type: 'company.report', text: 'bir' }));
    d = applyEvent(d, stored({ type: 'company.report', text: 'iki' }));
    expect(d.unseenReports.e1).toBe(2);
  });

  it('keeps goals and the pause from the snapshot and from events', () => {
    const goal = { id: 'g1', title: 'Lansman', why: 'w', done: ['d'], kpis: [], status: 'active' as const, createdBy: 'c', createdAt: 1, closedAt: null, note: null };
    let d = applySnapshot(EMPTY_DATA, { employees: [], quota: null, usage: {}, lastSeq: 1, goals: [goal], paused: true }, 'live');
    expect(d.goals.g1?.title).toBe('Lansman');
    expect(d.paused).toBe(true);
    d = applyEvent(d, stored({ type: 'goal.changed', change: 'stopped', goal: { ...goal, status: 'dropped' } }, 'c', 10));
    expect(d.goals.g1?.status).toBe('dropped');
    d = applyEvent(d, stored({ type: 'company.paused', paused: false }, 'c', 11));
    expect(d.paused).toBe(false);
  });
});

describe('the scheduler', () => {
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

  it('management cycle §3.3: a cycle’s start and its record move managementRev (the Yönetim tab reads the log again), a live snapshot too — an HTTP one does not', () => {
    let d = applySnapshot(EMPTY_DATA, snapshot(), 'live');
    const rev = d.managementRev;
    expect(rev).toBe(1);
    d = applyEvent(d, stored({ type: 'management.cycle.started', triggers: [], since: 0, unclosedWarning: false }, 'c'));
    expect(d.managementRev).toBe(rev + 1);
    d = applyEvent(d, stored({ type: 'management.cycle', closed: true, startedAt: 1, triggers: [], changes: [], reasoning: 'değişiklik yok, çünkü x', next: null, costUsd: 0.2, model: 'opus' }, 'c'));
    expect(d.managementRev).toBe(rev + 2);
    d = applyEvent(d, stored({ type: 'turn.started' }, 'c'));
    expect(d.managementRev).toBe(rev + 2);
    d = applySnapshot(d, snapshot({ lastSeq: d.lastSeq + 1 }), 'http');
    expect(d.managementRev).toBe(rev + 2);
    d = applySnapshot(d, snapshot({ lastSeq: d.lastSeq + 2 }), 'live');
    expect(d.managementRev).toBe(rev + 3);
  });

  it('a snapshot always moves agendaRev, even one that starts the office over', () => {
    const first = applySnapshot(EMPTY_DATA, snapshot({ lastSeq: 900 }));
    expect(first.agendaRev).toBe(1);
    const fresh = applySnapshot(first, snapshot({ lastSeq: 3 }), 'live');
    expect(fresh.agendaRev).toBe(2);
    expect(applySnapshot(EMPTY_DATA, snapshot()).schedules).toEqual({});
    expect(applySnapshot(EMPTY_DATA, snapshot()).clock).toBeNull();
  });
});
