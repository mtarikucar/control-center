# Company Phase 1 — part 2 (Tasks 7–12)

> Continues `docs/superpowers/plans/2026-10-06-company-phase1.md`. The header, Global Constraints, rulings and Review
> Focus there apply here too.

---

### Task 7: Engine — a token and --mcp-config for every session

**Files:**
- Modify: `apps/office-server/src/claude/args.ts`, `apps/office-server/src/engine.ts`
- Test: `apps/office-server/test/engine-company.test.ts` (new), `apps/office-server/test/args.test.ts`

**Interfaces:**
- Consumes: `TokenRegistry` (Task 5).
- Produces:
  - `sessionArgs(o: { model; sessionId; resume; home?; mcpConfig?: string }): string[]` — adds `--mcp-config <json>` when given (no `--strict-mcp-config`: the owner's connections stay).
  - `EngineOptions.mcp?: { url: () => string; tokens: TokenRegistry }` — `url` is read at every session start (the port is known only after `listen`).
  - `Engine.ready(id: string): boolean` — idle, live session, no turn, no stop/fire/terminal queued.
  - `Engine.fire` revokes the employee's token.

- [ ] **Step 1: Write the failing tests**

Append to `apps/office-server/test/args.test.ts`:

```ts
  it('gives the session the office tools when asked, keeping the owner’s other connections', () => {
    const config = JSON.stringify({ mcpServers: { office: { type: 'http', url: 'http://127.0.0.1:1/mcp' } } });
    const args = sessionArgs({ model: 'fable', sessionId: 's', resume: false, mcpConfig: config });
    expect(args[args.indexOf('--mcp-config') + 1]).toBe(config);
    expect(args).not.toContain('--strict-mcp-config');
    expect(args[args.indexOf('--model') + 1]).toBe('fable');
    expect(sessionArgs({ model: 'haiku', sessionId: 's', resume: false })).not.toContain('--mcp-config');
  });
```

(inside the existing `describe` for `sessionArgs`; import is already there.)

Create `apps/office-server/test/engine-company.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { TokenRegistry } from '../src/mcp/tokens.ts';
import { fakeEngine, readArgv } from './engine-helpers.ts';
import { setup, until, waitFor } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make() {
  const s = setup();
  const tokens = new TokenRegistry();
  const f = fakeEngine(s, { engine: { mcp: { url: () => 'http://127.0.0.1:4319/mcp', tokens } } });
  cleanups.push(f.cleanup, s.cleanup);
  return { ...s, ...f, tokens };
}

const tokenIn = (args: string[]): string => {
  const config = JSON.parse(args[args.indexOf('--mcp-config') + 1]!) as { mcpServers: { office: { type: string; url: string; headers: { Authorization: string } } } };
  expect(config.mcpServers.office).toMatchObject({ type: 'http', url: 'http://127.0.0.1:4319/mcp' });
  return config.mcpServers.office.headers.Authorization.replace(/^Bearer /, '');
};

describe('Engine — office tools', () => {
  it('starts every session with the office tools and a token that names the employee', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    const [first] = await readArgv(t.argvLog, 1);
    expect(t.tokens.resolve(tokenIn(first!.args))).toBe(e.id);
  });

  it('review focus: a restarted session gets a new token and the old one stops working; firing revokes it', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    const [first] = await readArgv(t.argvLog, 1);
    const old = tokenIn(first!.args);
    await t.engine.stop(e.id);
    t.engine.resume(e.id);
    const runs = await readArgv(t.argvLog, 2);
    const fresh = tokenIn(runs[1]!.args);
    expect(fresh).not.toBe(old);
    expect(t.tokens.resolve(old)).toBeNull();
    expect(t.tokens.resolve(fresh)).toBe(e.id);
    await t.engine.fire(e.id);
    expect(t.tokens.resolve(fresh)).toBeNull();
  });

  it('is ready for a task only when idle with a live session', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    expect(t.engine.ready(e.id)).toBe(true);
    t.engine.send(e.id, 'merhaba');
    expect(t.engine.ready(e.id)).toBe(false);
    await waitFor(t.events, (x) => x.event.type === 'turn.finished');
    await until(() => t.engine.ready(e.id));
    await t.engine.stop(e.id);
    expect(t.engine.ready(e.id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/args.test.ts test/engine-company.test.ts`
Expected: FAIL — no `--mcp-config` in argv; `engine.ready` is not a function.

- [ ] **Step 3: Arguments**

In `apps/office-server/src/claude/args.ts` change `sessionArgs`:

```ts
export function sessionArgs(o: { model: ModelAlias; sessionId: string; resume: boolean; home?: string; mcpConfig?: string }): string[] {
  return [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--replay-user-messages',
    '--model',
    o.model,
    '--permission-mode',
    'bypassPermissions',
    ...settingsArgs(o.home),
    // The office tools come on top of every connection the owner has (no --strict-mcp-config).
    ...(o.mcpConfig ? ['--mcp-config', o.mcpConfig] : []),
    ...(o.resume ? ['--resume', o.sessionId] : ['--session-id', o.sessionId]),
  ];
}
```

- [ ] **Step 4: Engine**

In `apps/office-server/src/engine.ts`:
- import `import type { TokenRegistry } from './mcp/tokens.ts';`
- `EngineOptions` gains:

```ts
  /** The office tools (MCP over HTTP): `url` is read at every session start, a fresh token is issued each time. */
  mcp?: { url: () => string; tokens: TokenRegistry };
```

- add a field `readonly #mcp: EngineOptions['mcp'];` and `this.#mcp = o.mcp;` in the constructor;
- in `#start`, build the config and pass it:

```ts
    const mcpConfig = this.#mcp
      ? JSON.stringify({
          mcpServers: {
            office: { type: 'http', url: this.#mcp.url(), headers: { Authorization: `Bearer ${this.#mcp.tokens.issue(employee.id)}` } },
          },
        })
      : undefined;
    rt.proc = new ClaudeProcess(
      {
        command: this.#command,
        args: sessionArgs({ model: employee.model, sessionId: employee.sessionId, resume: employee.sessionStarted, home: this.#home, mcpConfig }),
```

- in `fire`, after `await this.#halt(id);` add `this.#mcp?.tokens.revoke(id);`
- add a public method (next to `recover`):

```ts
  /** Idle with a live session and nothing queued against it: the moment to hand over the next task. */
  ready(id: string): boolean {
    let employee: Employee;
    try {
      employee = this.#roster.get(id);
    } catch {
      return false;
    }
    if (employee.lifecycle !== 'idle') return false;
    const rt = this.#runtimes.get(id);
    return rt !== undefined && rt.proc !== null && !rt.proc.exited && !rt.turnActive && rt.pendingOps === 0;
  }
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @cc/office-server exec vitest run test/args.test.ts test/engine-company.test.ts && pnpm --filter @cc/office-server test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/office-server/src/claude/args.ts apps/office-server/src/engine.ts apps/office-server/test/args.test.ts apps/office-server/test/engine-company.test.ts
git commit -m "feat(engine): every session gets the office tools with its own token

--mcp-config points the session at /mcp with a bearer token issued at that
start; a restart gets a new one and the old stops working; firing revokes it.
ready(id) says when an employee can take the next task."
```

---

### Task 8: Dispatcher — tasks and notices reach idle employees

**Files:**
- Create: `apps/office-server/src/company/dispatcher.ts`
- Test: `apps/office-server/test/dispatcher.test.ts`

**Interfaces:**
- Consumes: `EventStore` (`subscribe(fn): () => void`), `Roster`, `TaskStore`, `NoticeStore`, `PlanStore` (Task 2), `Company` (`start`, `nameOf`, Task 4), `Engine.ready`/`Engine.send` (Task 7).
- Produces:
  - `interface DispatchEngine { ready(id: string): boolean; send(id: string, text: string, source: 'system'): void }`
  - `class Dispatcher { constructor(d: { events: EventStore; roster: Roster; tasks: TaskStore; notices: NoticeStore; plans: PlanStore; company: Company; engine: DispatchEngine; defer?: (fn: () => void) => void }); start(): () => void; sweep(): void }`
  - message helpers `deliveryText(task, …)`, `NUDGE_PREFIX = 'Hatırlatma:'`, `NOTICES_PREFIX = 'Ofisten notlar:'` (exported for tests).

- [ ] **Step 1: Write the failing test**

Create `apps/office-server/test/dispatcher.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER, type StoredEvent } from '@cc/shared';
import { Company } from '../src/company/company.ts';
import { Dispatcher, NOTICES_PREFIX, NUDGE_PREFIX } from '../src/company/dispatcher.ts';
import { NoticeStore, PlanStore, TaskStore } from '../src/company/store.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup, until, waitFor } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make() {
  const s = setup();
  const f = fakeEngine(s);
  const tasks = new TaskStore(s.db);
  const plans = new PlanStore(s.db);
  const notices = new NoticeStore(s.db);
  const company = new Company({ roster: s.roster, events: s.events, tasks, plans, notices, dataDir: s.dataDir, hire: (i) => f.engine.hire(i), characters: () => ['coder'] });
  const dispatcher = new Dispatcher({ events: s.events, roster: s.roster, tasks, notices, plans, company, engine: f.engine });
  const stop = dispatcher.start();
  cleanups.push(stop, f.cleanup, s.cleanup);
  return { ...s, engine: f.engine, tasks, plans, notices, company };
}

const systemMessages = (events: StoredEvent[], id: string) =>
  events.filter((e) => e.employeeId === id && e.event.type === 'message.user' && e.event.source === 'system').map((e) => (e.event as { text: string }).text);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Dispatcher', () => {
  it('hands the next task to an idle employee as a system message and marks it in progress', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const task = t.company.createTask(OWNER, { assignee: ada.id, title: 'README yaz', done: ['README.md var'], priority: 2 });
    const msg = await waitFor(t.events, (e) => e.employeeId === ada.id && e.event.type === 'message.user' && e.event.text.includes('README yaz'));
    const text = (msg.event as { text: string }).text;
    expect(text).toContain(task.id);
    expect(text).toContain('README.md var');
    expect(text).toContain('taskFinish');
    expect(t.tasks.get(task.id).status).toBe('in_progress');
  });

  it('review focus: an employee who stops without handing in gets exactly one reminder', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const task = t.company.createTask(OWNER, { assignee: ada.id, title: 'Uzun iş' });
    await until(() => systemMessages(t.events.list({ limit: 5000 }), ada.id).some((m) => m.startsWith(NUDGE_PREFIX)), 8000);
    await sleep(800);
    const messages = systemMessages(t.events.list({ limit: 5000 }), ada.id);
    expect(messages.filter((m) => m.startsWith(NUDGE_PREFIX))).toHaveLength(1);
    expect(messages).toHaveLength(2);
    expect(t.tasks.get(task.id)).toMatchObject({ status: 'in_progress', nudged: true });
  });

  it('review focus: two tasks at once never put two in progress; the second comes when the first is handed in', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const first = t.company.createTask(OWNER, { assignee: ada.id, title: 'Birinci' });
    const second = t.company.createTask(OWNER, { assignee: ada.id, title: 'İkinci' });
    await until(() => t.tasks.get(first.id).status === 'in_progress');
    await sleep(800);
    expect(t.tasks.list({ assignee: ada.id, statuses: ['in_progress'] })).toHaveLength(1);
    t.company.finish(ada.id, first.id, { summary: 'bitti', outputs: [], learned: '' });
    await until(() => t.tasks.get(second.id).status === 'in_progress', 8000);
    expect(t.tasks.list({ assignee: ada.id, statuses: ['in_progress'] }).map((x) => x.id)).toEqual([second.id]);
  });

  it('brings notices to an idle coordinator: the owner approved the plan', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const plan = t.company.propose(c.id, { title: 'Video', goal: 'g', approach: 'a' });
    t.company.approve(plan.id);
    const msg = await waitFor(t.events, (e) => e.employeeId === c.id && e.event.type === 'message.user' && e.event.text.startsWith(NOTICES_PREFIX));
    expect((msg.event as { text: string }).text).toContain('Plan onaylandı');
    expect(t.notices.pending(c.id)).toEqual([]);
  });

  it('does not wake someone the owner stopped; the task waits', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    await t.engine.stop(ada.id);
    const task = t.company.createTask(OWNER, { assignee: ada.id, title: 'Bekleyen' });
    await sleep(500);
    expect(t.tasks.get(task.id).status).toBe('waiting');
    expect(systemMessages(t.events.list({ limit: 5000 }), ada.id)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/dispatcher.test.ts`
Expected: FAIL — cannot resolve `../src/company/dispatcher.ts`.

- [ ] **Step 3: Implement the dispatcher**

Create `apps/office-server/src/company/dispatcher.ts`:

```ts
import type { Task } from '@cc/shared';
import type { EventStore } from '../event-store.ts';
import type { Roster } from '../roster.ts';
import type { Company } from './company.ts';
import type { NoticeStore, PlanStore, TaskStore } from './store.ts';

export interface DispatchEngine {
  ready(id: string): boolean;
  send(id: string, text: string, source: 'system'): void;
}

export interface DispatcherDeps {
  events: EventStore;
  roster: Roster;
  tasks: TaskStore;
  notices: NoticeStore;
  plans: PlanStore;
  company: Company;
  engine: DispatchEngine;
  /** Runs work after the current event has been handled (default setImmediate), so sends never nest in an event. */
  defer?: (fn: () => void) => void;
}

export const NUDGE_PREFIX = 'Hatırlatma:';
export const NOTICES_PREFIX = 'Ofisten notlar:';

/**
 * Hands work to employees when they are free: the next task in their queue, the notices waiting for them (a plan
 * was approved, a colleague handed in), or one reminder about a task they left open. Never interrupts: it waits for
 * the employee to be idle (v1 rule: only the owner interrupts).
 */
export class Dispatcher {
  readonly #d: DispatcherDeps;
  readonly #defer: (fn: () => void) => void;
  readonly #queued = new Set<string>();
  #sweepQueued = false;

  constructor(d: DispatcherDeps) {
    this.#d = d;
    this.#defer = d.defer ?? ((fn) => void setImmediate(fn));
  }

  start(): () => void {
    const off = this.#d.events.subscribe((stored) => {
      const ev = stored.event;
      if (ev.type === 'lifecycle.changed' && ev.to === 'idle' && stored.employeeId) this.#schedule(stored.employeeId);
      else if (ev.type === 'task.changed' || ev.type === 'plan.changed') this.#scheduleSweep();
    });
    this.#scheduleSweep();
    return off;
  }

  sweep(): void {
    for (const e of this.#d.roster.list()) this.#consider(e.id);
  }

  #schedule(id: string): void {
    if (this.#queued.has(id)) return;
    this.#queued.add(id);
    this.#defer(() => {
      this.#queued.delete(id);
      this.#consider(id);
    });
  }

  #scheduleSweep(): void {
    if (this.#sweepQueued) return;
    this.#sweepQueued = true;
    this.#defer(() => {
      this.#sweepQueued = false;
      this.sweep();
    });
  }

  #consider(id: string): void {
    if (!this.#d.engine.ready(id)) return;
    const pending = this.#d.notices.pending(id);
    const current = this.#d.tasks.inProgressOf(id);
    let body = '';
    let started: Task | null = null;
    if (current) {
      if (!current.nudged) body = this.#nudge(current);
    } else {
      const next = this.#d.tasks.nextFor(id);
      if (next) started = this.#d.company.start(next.id);
    }
    if (started) body = this.#delivery(started);
    if (!body && pending.length === 0) return;
    const text = [pending.length ? `${NOTICES_PREFIX}\n${pending.map((n) => `- ${n.text}`).join('\n')}` : '', body].filter(Boolean).join('\n\n');
    try {
      this.#d.engine.send(id, text, 'system');
    } catch {
      // The session went away between ready() and send(): put the task back; the next idle moment delivers it.
      if (started) this.#d.tasks.update(started.id, { status: 'waiting', startedAt: null });
      return;
    }
    if (current && !current.nudged) this.#d.tasks.update(current.id, { nudged: true });
    this.#d.notices.markDelivered(pending.map((n) => n.id));
  }

  #delivery(task: Task): string {
    let plan = '';
    if (task.planId) {
      try {
        plan = `\nPlan: ${this.#d.plans.get(task.planId).title}`;
      } catch {
        plan = '';
      }
    }
    const done = task.done.length ? `\n\nBitti tanımı:\n${task.done.map((d) => `- ${d}`).join('\n')}` : '';
    const deps = task.dependsOn.length ? `\nÖnce bitenler: ${task.dependsOn.join(', ')}` : '';
    return `## Görev: ${task.title}
Görev no: ${task.id}${plan}
İsteyen: ${this.#d.company.nameOf(task.requester)} · Öncelik: ${task.priority}${deps}

${task.description || '(açıklama yok)'}${done}

İş bitince \`taskFinish\` ile teslim et (görev no, kısa özet, ürettiğin dosyalar, öğrendiklerin). Takılırsan \`taskUpdate\` ile "blocked" yap ve nedenini yaz; başka birinin yapması gereken bir parça çıkarsa \`taskPass\` kullan.`;
  }

  #nudge(task: Task): string {
    return `${NUDGE_PREFIX} “${task.title}” görevi (no ${task.id}) hâlâ açık görünüyor. Bitirdiysen \`taskFinish\` ile teslim et; takıldıysan \`taskUpdate\` ile durumunu yaz.`;
  }
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @cc/office-server exec vitest run test/dispatcher.test.ts && pnpm --filter @cc/office-server test && pnpm typecheck`
Expected: PASS. (Fake claude answers every message and ends its turn without calling tools, which is exactly the "left it open" case the reminder covers.)

- [ ] **Step 5: Commit**

```bash
git add apps/office-server/src/company/dispatcher.ts apps/office-server/test/dispatcher.test.ts
git commit -m "feat(company): the office hands out tasks and notices when people are free

When an employee becomes idle the office gives them the next task in their
queue (marking it in progress), the notices waiting for them, or one reminder
about a task they left open — never two tasks at once, never a reminder loop,
never waking someone the owner stopped."
```

---

### Task 9: Owner API and wiring

**Files:**
- Create: `apps/office-server/src/company/characters.ts`
- Modify: `apps/office-server/src/api.ts`, `apps/office-server/src/main.ts`
- Test: `apps/office-server/test/company-api.test.ts` (new), `apps/office-server/test/main.test.ts`

**Interfaces:**
- Consumes: `Company`, `TaskStore`, `PlanStore`, `NoticeStore`, `Dispatcher`, `officeTools`, `TokenRegistry`, `OWNER`.
- Produces:
  - `manifestCharacters(assetsDir: string | undefined): () => string[]`
  - `ApiDeps.company?: { service: Company; tasks: TaskStore; plans: PlanStore }`
  - Routes: `POST /api/plans/:id/approve` → 200 Plan; `POST /api/plans/:id/decline` → 200 Plan; `POST /api/company/coordinator` `{ employeeId }` → 200 Employee; `POST /api/company/coordinator/hire` → 201 Employee; `POST /api/employees` hires through `Company.hire(OWNER, …)` when the company layer is present; `GET /api/office` adds `tasks` (open + last 50 closed) and `plans`.

- [ ] **Step 1: Write the failing tests**

Create `apps/office-server/test/company-api.test.ts`:

```ts
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/api.ts';
import { Company } from '../src/company/company.ts';
import { NoticeStore, PlanStore, TaskStore } from '../src/company/store.ts';
import { QuotaTracker } from '../src/quota.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function start() {
  const s = setup();
  const f = fakeEngine(s);
  const tasks = new TaskStore(s.db);
  const plans = new PlanStore(s.db);
  const notices = new NoticeStore(s.db);
  const company = new Company({ roster: s.roster, events: s.events, tasks, plans, notices, dataDir: s.dataDir, hire: (i) => f.engine.hire(i), characters: () => ['coder', 'manager'] });
  const quota = new QuotaTracker(s.db, s.events);
  const api = createApi({ engine: f.engine, roster: s.roster, events: s.events, quota, company: { service: company, tasks, plans } }, { allowedOrigins: [] });
  await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', resolve));
  const port = (api.server.address() as AddressInfo).port;
  cleanups.push(() => api.close(), f.cleanup, s.cleanup);
  return { port, company, tasks };
}

function call(port: number, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: method === 'POST' ? { 'content-type': 'application/json' } : {} }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    if (method === 'POST') req.write(JSON.stringify(body ?? {}));
    req.end();
  });
}

describe('company API', () => {
  it('hires the coordinator once from the Company view, on Fable, with the manager look', async () => {
    const t = await start();
    const hired = await call(t.port, 'POST', '/api/company/coordinator/hire');
    expect(hired.status).toBe(201);
    expect(hired.body).toMatchObject({ kind: 'coordinator', model: 'fable', characterId: 'manager' });
    expect((await call(t.port, 'POST', '/api/company/coordinator/hire')).status).toBe(409);
  });

  it('makes an employee the coordinator; the owner’s hire form hires members', async () => {
    const t = await start();
    const ada = await call(t.port, 'POST', '/api/employees', { name: 'Ada', role: 'r', kind: 'coordinator' });
    expect(ada.body.kind).toBe('member');
    const appointed = await call(t.port, 'POST', '/api/company/coordinator', { employeeId: ada.body.id });
    expect(appointed.body).toMatchObject({ id: ada.body.id, kind: 'coordinator' });
    expect((await call(t.port, 'POST', '/api/company/coordinator', { employeeId: 42 })).status).toBe(400);
  });

  it('lets the owner approve or decline plan cards, and shows plans and tasks in the snapshot', async () => {
    const t = await start();
    const c = t.company.hireCoordinator();
    const a = t.company.propose(c.id, { title: 'A', goal: 'g', approach: 'x' });
    const b = t.company.propose(c.id, { title: 'B', goal: 'g', approach: 'x' });
    expect((await call(t.port, 'POST', `/api/plans/${a.id}/approve`)).body).toMatchObject({ id: a.id, status: 'approved' });
    expect((await call(t.port, 'POST', `/api/plans/${a.id}/approve`)).status).toBe(409);
    expect((await call(t.port, 'POST', `/api/plans/${b.id}/decline`)).body.status).toBe('declined');
    expect((await call(t.port, 'POST', '/api/plans/00000000-0000-0000-0000-000000000000/approve')).status).toBe(404);
    t.company.createTask(c.id, { assignee: c.id, title: 'iş', planId: a.id });
    const office = await call(t.port, 'GET', '/api/office');
    expect(office.body.plans.map((p: { title: string }) => p.title).sort()).toEqual(['A', 'B']);
    expect(office.body.tasks.map((x: { title: string }) => x.title)).toEqual(['iş']);
  });
});
```

Append to `apps/office-server/test/main.test.ts` (inside its `describe`, using its `startOffice` helper):

```ts
  it('serves the office tools only to a valid token', async () => {
    const dir = tempDir();
    const office = startOffice(dir);
    await until(() => /hazır: http:\/\/127\.0\.0\.1:\d+/.test(office.output()), 10_000);
    const port = Number(/hazır: http:\/\/127\.0\.0\.1:(\d+)/.exec(office.output())?.[1]);
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, method: 'POST', path: '/mcp', headers: { 'content-type': 'application/json' } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    });
    expect(status).toBe(401);
    office.child.kill('SIGINT');
    await office.exited;
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/company-api.test.ts test/main.test.ts`
Expected: FAIL — 404 on the company routes; `/mcp` is 404 in the real process.

- [ ] **Step 3: Characters from the manifest**

Create `apps/office-server/src/company/characters.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Character ids in assets/3d/manifest.json, read each time (the owner may add models while the office runs). */
export function manifestCharacters(assetsDir: string | undefined): () => string[] {
  return () => {
    if (!assetsDir) return [];
    try {
      const manifest = JSON.parse(readFileSync(join(assetsDir, 'manifest.json'), 'utf8')) as { items?: unknown };
      if (!Array.isArray(manifest.items)) return [];
      return manifest.items
        .filter((i): i is { kind: string; id: string } => typeof i === 'object' && i !== null && (i as { kind?: unknown }).kind === 'character' && typeof (i as { id?: unknown }).id === 'string')
        .map((i) => i.id);
    } catch {
      return [];
    }
  };
}
```

- [ ] **Step 4: API routes**

In `apps/office-server/src/api.ts`:
- imports: `import { OWNER } from '@cc/shared';`, `import type { Company } from './company/company.ts';`, `import type { PlanStore, TaskStore } from './company/store.ts';`
- `ApiDeps` gains `company?: { service: Company; tasks: TaskStore; plans: PlanStore };`
- replace `snapshot`:

```ts
export function snapshot(d: ApiDeps): OfficeSnapshot {
  const employees = d.roster.list();
  const base: OfficeSnapshot = { employees, quota: d.quota.state(), usage: d.quota.usageAll(employees.map((e) => e.id)), lastSeq: d.events.lastSeq() };
  if (!d.company) return base;
  const open = d.company.tasks.list({ statuses: ['waiting', 'in_progress', 'blocked'] });
  const closed = d.company.tasks.list({ statuses: ['done', 'cancelled'], limit: 100_000 }).slice(-50);
  return { ...base, tasks: [...open, ...closed], plans: d.company.plans.list() };
}
```

- add `const PLAN_ROUTE = /^\/api\/plans\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(approve|decline)$/;` next to `EMPLOYEE_ROUTE`;
- in `route`, replace the `POST /api/employees` branch and add the company routes right after it:

```ts
  if (method === 'POST' && url.pathname === '/api/employees') {
    const body = await readJson(req);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ValidationError('Geçersiz istek gövdesi.');
    const input = body as HireInput;
    return sendJson(res, 201, d.company ? d.company.service.hire(OWNER, input) : d.engine.hire(input));
  }
  if (d.company) {
    const company = d.company.service;
    const plan = PLAN_ROUTE.exec(url.pathname);
    if (method === 'POST' && plan) return sendJson(res, 200, plan[2] === 'approve' ? company.approve(plan[1] ?? '') : company.decline(plan[1] ?? ''));
    if (method === 'POST' && url.pathname === '/api/company/coordinator/hire') return sendJson(res, 201, company.hireCoordinator());
    if (method === 'POST' && url.pathname === '/api/company/coordinator') {
      const id = (await readJson(req) as { employeeId?: unknown }).employeeId;
      if (typeof id !== 'string' || !id) throw new ValidationError('employeeId gerekli.');
      return sendJson(res, 200, company.appointCoordinator(id));
    }
  }
```

- [ ] **Step 5: Wiring**

Replace the construction part of `apps/office-server/src/main.ts` (from `const quota = …` through `createApi(…)`) with:

```ts
const quota = new QuotaTracker(db, events);
const tokens = new TokenRegistry();
let mcpUrl = '';
const engine = new Engine({ roster, events, dataDir: config.dataDir, claudeCommand: config.claudeCommand, mcp: { url: () => mcpUrl, tokens } });
const tasks = new TaskStore(db);
const plans = new PlanStore(db);
const notices = new NoticeStore(db);
const characters = manifestCharacters(config.assetsDir);
const company = new Company({ roster, events, tasks, plans, notices, dataDir: config.dataDir, hire: (input) => engine.hire(input), characters });
const dispatcher = new Dispatcher({ events, roster, tasks, notices, plans, company, engine });

const api = createApi(
  { engine, roster, events, quota, mcp: { tokens, tools: officeTools({ company, roster, tasks, characters }) }, company: { service: company, tasks, plans } },
  { allowedOrigins: config.allowedOrigins, webDir: config.webDir, assetsDir: config.assetsDir },
);
```

add the imports:

```ts
import { manifestCharacters } from './company/characters.ts';
import { Company } from './company/company.ts';
import { Dispatcher } from './company/dispatcher.ts';
import { NoticeStore, PlanStore, TaskStore } from './company/store.ts';
import { TokenRegistry } from './mcp/tokens.ts';
import { officeTools } from './mcp/tools.ts';
```

and change the `listen` callback so the tools URL is known before any session starts, and the dispatcher runs after recovery:

```ts
api.server.listen(config.port, config.host, () => {
  const { port } = api.server.address() as AddressInfo;
  mcpUrl = `http://${config.host}:${port}/mcp`;
  engine.recover();
  dispatcher.start();
  console.log(`office-server hazır: http://${config.host}:${port}  (veri: ${config.dataDir})`);
});
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @cc/office-server exec vitest run test/company-api.test.ts test/main.test.ts && pnpm --filter @cc/office-server test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/office-server/src/company/characters.ts apps/office-server/src/api.ts apps/office-server/src/main.ts apps/office-server/test/company-api.test.ts apps/office-server/test/main.test.ts
git commit -m "feat(company): owner routes and the running office

The owner approves or declines plan cards, hires the coordinator (Fable, the
manager look) or makes an employee coordinator; the hire form goes through the
company; the snapshot carries plans and tasks. main wires the stores, the
company, the office tools at /mcp and the dispatcher (after recovery)."
```

---

### Task 10: Web — data, labels, Fable in the hire form

**Files:**
- Modify: `apps/office-web/src/store/reducers.ts`, `apps/office-web/src/store/office.ts`, `apps/office-web/src/net/api.ts`, `apps/office-web/src/ui/labels.ts`, `apps/office-web/src/ui/HireDialog.tsx`
- Test: `apps/office-web/src/store/reducers.test.ts`, `apps/office-web/src/ui/HireDialog.test.tsx` (and any fixture that builds an `Employee`)

**Interfaces:**
- Consumes: `Task`, `Plan`, `ModelAlias`, `EmployeeKind`, `TaskStatus`, `PlanStatus` (`@cc/shared`).
- Produces:
  - `OfficeData.tasks: Record<string, Task>`, `OfficeData.plans: Record<string, Plan>` (filled from snapshots and `task.changed` / `plan.changed`); `needsRefresh` also for `role.changed`.
  - store: `companyOpen: boolean`, `setCompanyOpen(open: boolean)`.
  - `api.approvePlan(id)`, `api.declinePlan(id)`, `api.appointCoordinator(employeeId)`, `api.hireCoordinator()`.
  - `labels.ts`: `MODEL_LABELS: Record<ModelAlias, string>`, `KIND_LABELS: Record<EmployeeKind, string>`, `TASK_STATUS_LABELS: Record<TaskStatus, string>`, `PLAN_STATUS_LABELS: Record<PlanStatus, string>`.

- [ ] **Step 1: Write the failing tests**

In every web test file that builds an `Employee` literal (`App.test.tsx`, `ui/Panel.test.tsx`, `store/reducers.test.ts`, `store/office.test.ts`, `scene/CharactersLayer.test.tsx`), add `title: '', team: '', kind: 'member', reportsTo: null,` to the fixture if Task 1 did not already.

Append to `apps/office-web/src/store/reducers.test.ts`:

```ts
describe('company data', () => {
  const plan = (over: Partial<Plan> = {}): Plan => ({
    id: 'p1', title: 'Video', goal: 'g', approach: 'a', people: '', steps: [], quotaPct: null, usd: null, days: null, risks: '',
    status: 'draft', version: 1, proposedBy: 'e1', createdAt: 1, updatedAt: 1, approvedAt: null, ...over,
  });
  const task = (over: Partial<Task> = {}): Task => ({
    id: 't1', planId: 'p1', title: 'Senaryo', description: '', done: [], requester: 'owner', assignee: 'e1', priority: 3, dependsOn: [],
    status: 'waiting', chainDepth: 0, note: null, result: null, nudged: false, createdAt: 1, startedAt: null, finishedAt: null, ...over,
  });

  it('takes plans and tasks from the snapshot, and keeps them current from events', () => {
    let d = applySnapshot(EMPTY_DATA, snapshot({ tasks: [task()], plans: [plan()] }));
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

  it('a server without the company layer gives empty plans and tasks', () => {
    const d = applySnapshot(EMPTY_DATA, snapshot());
    expect(d.tasks).toEqual({});
    expect(d.plans).toEqual({});
  });
});
```

(Add `Plan`, `Task` to the `@cc/shared` type import at the top of the file.)

Append to `apps/office-web/src/ui/HireDialog.test.tsx` (inside its `describe`):

```ts
  it('offers Fable, Opus, Sonnet and Haiku by what they are good at', () => {
    render(<HireDialog />);
    const options = [...(screen.getByLabelText('Model') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options).toEqual(['Fable — en güçlü', 'Opus — güçlü', 'Sonnet — dengeli', 'Haiku — hızlı ve ucuz']);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-web exec vitest run src/store/reducers.test.ts src/ui/HireDialog.test.tsx`
Expected: FAIL — `d.tasks` undefined; options show bare aliases.

- [ ] **Step 3: Labels and the hire form**

Append to `apps/office-web/src/ui/labels.ts`:

```ts
import type { EmployeeKind, ModelAlias, PlanStatus, TaskStatus } from '@cc/shared';

/** By family, not version: the aliases always point at the newest model. */
export const MODEL_LABELS: Record<ModelAlias, string> = {
  fable: 'Fable — en güçlü',
  opus: 'Opus — güçlü',
  sonnet: 'Sonnet — dengeli',
  haiku: 'Haiku — hızlı ve ucuz',
};

export const KIND_LABELS: Record<EmployeeKind, string> = { coordinator: 'Koordinatör', lead: 'Ekip lideri', member: 'Çalışan' };

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  waiting: 'Bekliyor',
  in_progress: 'Sürüyor',
  blocked: 'Takıldı',
  done: 'Bitti',
  cancelled: 'İptal',
};

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = { draft: 'Onay bekliyor', approved: 'Onaylandı', done: 'Bitti', declined: 'Vazgeçildi' };
```

(Move the new `import type` line to the top of the file, merged with its existing imports.)

In `apps/office-web/src/ui/HireDialog.tsx`: import `MODEL_LABELS` from `./labels.ts` and render `{MODEL_LABELS[m]}` instead of `{m}` in the model `<option>`.

- [ ] **Step 4: Data**

In `apps/office-web/src/store/reducers.ts`:
- import `Plan`, `Task` types from `@cc/shared`;
- `OfficeData` gains:

```ts
  /** The company: every task the snapshot or the feed has shown (open ones and the latest closed). */
  tasks: Record<string, Task>;
  plans: Record<string, Plan>;
```

- `EMPTY_DATA` gets `tasks: {}, plans: {}`;
- in `applySnapshot`, the returned object gets:

```ts
    tasks: Object.fromEntries((s.tasks ?? []).map((t) => [t.id, t])),
    plans: Object.fromEntries((s.plans ?? []).map((p) => [p.id, p])),
```

- in `applyEvent`, right after `const next: OfficeData = { … };` insert:

```ts
  // Company records are global: keep them whatever the page knows about the employee the event is filed under.
  if (ev.type === 'task.changed') next.tasks = { ...d.tasks, [ev.task.id]: ev.task };
  if (ev.type === 'plan.changed') next.plans = { ...d.plans, [ev.plan.id]: ev.plan };
```

- `needsRefresh` also returns true for `role.changed`.

In `apps/office-web/src/store/office.ts`: add `companyOpen: boolean;` and `setCompanyOpen: (open: boolean) => void;` to the store interface, `companyOpen: false,` to the initial state and `setCompanyOpen: (companyOpen) => set({ companyOpen }),` to the actions.

In `apps/office-web/src/net/api.ts` add to `api` (and `Plan` to the type import):

```ts
  approvePlan: (id: string) => request<Plan>('POST', `/api/plans/${encodeURIComponent(id)}/approve`),
  declinePlan: (id: string) => request<Plan>('POST', `/api/plans/${encodeURIComponent(id)}/decline`),
  appointCoordinator: (employeeId: string) => request<Employee>('POST', '/api/company/coordinator', { employeeId }),
  hireCoordinator: () => request<Employee>('POST', '/api/company/coordinator/hire'),
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @cc/office-web exec vitest run && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/office-web/src
git commit -m "feat(office-web): plans and tasks in the store, Fable in the hire form

Plans and tasks come from the snapshot and stay current from plan.changed and
task.changed; a role change refreshes the roster; models are labelled by what
they are good at."
```

---

### Task 11: Web — plan cards and the Company view

**Files:**
- Create: `apps/office-web/src/ui/PlanCard.tsx`, `apps/office-web/src/ui/CompanyView.tsx`
- Modify: `apps/office-web/src/ui/EventItem.tsx`, `apps/office-web/src/ui/TopBar.tsx`, `apps/office-web/src/App.tsx`, `apps/office-web/src/styles.css`
- Test: `apps/office-web/src/ui/PlanCard.test.tsx`, `apps/office-web/src/ui/CompanyView.test.tsx`

**Interfaces:**
- Consumes: store (`plans`, `tasks`, `views`, `companyOpen`, `setCompanyOpen`, `select`), `api.approvePlan/declinePlan/hireCoordinator/appointCoordinator`, labels (Task 10).
- Produces: `PlanCard({ plan }: { plan: Plan })`, `CompanyView()`.

- [ ] **Step 1: Write the failing tests**

Create `apps/office-web/src/ui/PlanCard.test.tsx`:

```tsx
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Plan } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { PlanCard } from './PlanCard.tsx';

vi.mock('../net/api.ts', () => ({ api: { approvePlan: vi.fn(async () => ({})), declinePlan: vi.fn(async () => ({})) } }));
const { api } = await import('../net/api.ts');

const plan = (over: Partial<Plan> = {}): Plan => ({
  id: 'p1', title: 'Tanıtım videosu', goal: 'Ürünü tanıtmak', approach: 'Senaryo, çekim, kurgu', people: 'yazar + videocu', steps: ['senaryo', 'kurgu'],
  quotaPct: 10, usd: 25, days: 3, risks: 'kota', status: 'draft', version: 1, proposedBy: 'c', createdAt: 1, updatedAt: 1, approvedAt: null, ...over,
});

beforeEach(() => useOffice.setState({ plans: { p1: plan() } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PlanCard', () => {
  it('shows what the coordinator proposes and asks the owner to approve', async () => {
    render(<PlanCard plan={plan()} />);
    expect(screen.getByText('Tanıtım videosu')).toBeTruthy();
    expect(screen.getByText('Ürünü tanıtmak')).toBeTruthy();
    expect(screen.getByText(/kota %10 · \$25 · 3 gün/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Onayla' }));
    await waitFor(() => expect(api.approvePlan).toHaveBeenCalledWith('p1'));
  });

  it('drops the buttons once the plan is decided, and an older version only points at the newer one', () => {
    useOffice.setState({ plans: { p1: plan({ status: 'approved', version: 2 }) } });
    render(<PlanCard plan={plan({ version: 1 })} />);
    expect(screen.queryByRole('button', { name: 'Onayla' })).toBeNull();
    expect(screen.getByText(/sürüm 2 geldi/)).toBeTruthy();
  });

  it('lets the owner decline and shows an API error', async () => {
    vi.mocked(api.declinePlan).mockRejectedValueOnce(new Error('Yalnız taslak bir plan reddedilebilir.'));
    render(<PlanCard plan={plan()} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Vazgeç' })));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Yalnız taslak bir plan reddedilebilir.');
  });
});
```

Create `apps/office-web/src/ui/CompanyView.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Employee, Task } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { CompanyView } from './CompanyView.tsx';

vi.mock('../net/api.ts', () => ({ api: { hireCoordinator: vi.fn(async () => ({ id: 'new' })), appointCoordinator: vi.fn(async () => ({})), events: vi.fn(async () => []) } }));
const { api } = await import('../net/api.ts');

const person = (id: string, over: Partial<Employee> = {}): Employee => ({
  id, slug: id, name: id, role: 'r', model: 'haiku', characterId: 'coder', title: '', team: '', kind: 'member', reportsTo: null, deskIndex: 0,
  sessionId: `s-${id}`, sessionStarted: true, lifecycle: 'idle', limitResetsAt: null, lastError: null, createdAt: 1, ...over,
});
const task = (id: string, over: Partial<Task> = {}): Task => ({
  id, planId: null, title: id, description: '', done: [], requester: 'owner', assignee: 'ada', priority: 3, dependsOn: [], status: 'waiting',
  chainDepth: 0, note: null, result: null, nudged: false, createdAt: 1, startedAt: null, finishedAt: null, ...over,
});
const office = (employees: Employee[], tasks: Task[] = []) =>
  useOffice.setState({
    companyOpen: true,
    views: Object.fromEntries(employees.map((e) => [e.id, { employee: e, events: [], openTools: {}, idleSince: null, eventsLoaded: true }])),
    tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
    plans: {},
  });

beforeEach(() => office([]));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CompanyView', () => {
  it('without a coordinator, offers to hire one or to make an employee coordinator', async () => {
    office([person('ada', { name: 'Ada' })]);
    render(<CompanyView />);
    expect(screen.getByText(/koordinatörü yok/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Koordinatör işe al' }));
    await waitFor(() => expect(api.hireCoordinator).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Koordinatör yapılacak çalışan'), { target: { value: 'ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Koordinatör yap' }));
    await waitFor(() => expect(api.appointCoordinator).toHaveBeenCalledWith('ada'));
  });

  it('draws the org chart: the coordinator on top, teams below, with what each person is doing', () => {
    office(
      [person('koor', { name: 'Koordinatör', kind: 'coordinator', title: 'Koordinatör' }), person('ada', { name: 'Ada', team: 'İçerik', title: 'Yazar' }), person('can', { name: 'Can' })],
      [task('Blog yazısı', { assignee: 'ada', status: 'in_progress' })],
    );
    render(<CompanyView />);
    const top = screen.getByRole('region', { name: 'Koordinatör' });
    expect(within(top).getByText('Koordinatör')).toBeTruthy();
    const content = screen.getByRole('region', { name: 'İçerik' });
    expect(within(content).getByText('Ada')).toBeTruthy();
    expect(within(content).getByText(/Blog yazısı/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Ekipsiz' })).toBeTruthy();
    expect(screen.queryByText(/koordinatörü yok/)).toBeNull();
  });

  it('puts tasks in columns by state and filters them by person', () => {
    office(
      [person('koor', { kind: 'coordinator' }), person('ada', { name: 'Ada' }), person('can', { name: 'Can' })],
      [task('Bekleyen iş'), task('Süren iş', { status: 'in_progress' }), task('Takılan iş', { status: 'blocked', note: 'şifre yok' }), task('Biten iş', { status: 'done', finishedAt: 5 }), task('Can işi', { assignee: 'can' })],
    );
    render(<CompanyView />);
    fireEvent.click(screen.getByRole('tab', { name: 'Görevler' }));
    expect(within(screen.getByRole('region', { name: 'Bekliyor' })).getByText('Bekleyen iş')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Sürüyor' })).getByText('Süren iş')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Takıldı' })).getByText(/şifre yok/)).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Bitti' })).getByText('Biten iş')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Kişi'), { target: { value: 'can' } });
    expect(screen.queryByText('Bekleyen iş')).toBeNull();
    expect(screen.getByText('Can işi')).toBeTruthy();
  });

  it('opens an employee’s panel from the chart and closes', () => {
    office([person('koor', { name: 'Koordinatör', kind: 'coordinator' })]);
    render(<CompanyView />);
    fireEvent.click(screen.getByRole('button', { name: /Koordinatör/ }));
    expect(useOffice.getState()).toMatchObject({ selectedId: 'koor', companyOpen: false });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-web exec vitest run src/ui/PlanCard.test.tsx src/ui/CompanyView.test.tsx`
Expected: FAIL — cannot resolve the components.

- [ ] **Step 3: Plan card**

Create `apps/office-web/src/ui/PlanCard.tsx`:

```tsx
import { useState } from 'react';
import type { Plan } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';
import { PLAN_STATUS_LABELS } from './labels.ts';

function estimates(p: Plan): string | null {
  const parts = [p.quotaPct !== null ? `kota %${p.quotaPct}` : null, p.usd !== null ? `$${p.usd}` : null, p.days !== null ? `${p.days} gün` : null].filter(Boolean);
  return parts.length ? `Tahmin: ${parts.join(' · ')}` : null;
}

/** A plan the coordinator proposed, as it stands now; the owner approves or declines the latest version here. */
export function PlanCard({ plan }: { plan: Plan }) {
  const live = useOffice((s) => s.plans[plan.id]) ?? plan;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (live.version > plan.version) {
    return (
      <div className="note">
        Plan “{plan.title}” sürüm {plan.version} — yerine sürüm {live.version} geldi.
      </div>
    );
  }
  const act = async (work: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const guess = estimates(live);
  return (
    <section className="plan-card" aria-label={`Plan: ${live.title}`}>
      <header className="row">
        <strong>{live.title}</strong>
        <span className={`badge plan-${live.status}`}>{PLAN_STATUS_LABELS[live.status]}</span>
      </header>
      <span className="muted">sürüm {live.version}</span>
      <dl>
        <dt>Hedef</dt>
        <dd>{live.goal}</dd>
        <dt>Yaklaşım</dt>
        <dd>{live.approach}</dd>
        {live.people && (
          <>
            <dt>Kimler</dt>
            <dd>{live.people}</dd>
          </>
        )}
        {live.risks && (
          <>
            <dt>Riskler</dt>
            <dd>{live.risks}</dd>
          </>
        )}
      </dl>
      {live.steps.length > 0 && (
        <ol>
          {live.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      )}
      {guess && <p className="muted">{guess}</p>}
      {live.status === 'draft' && (
        <div className="row end">
          <button type="button" disabled={busy} onClick={() => void act(() => api.declinePlan(live.id))}>
            Vazgeç
          </button>
          <button type="button" className="primary" disabled={busy} onClick={() => void act(() => api.approvePlan(live.id))}>
            Onayla
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Company view**

Create `apps/office-web/src/ui/CompanyView.tsx`:

```tsx
import { useMemo, useState } from 'react';
import type { Employee, Task, TaskStatus } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';
import { KIND_LABELS, TASK_STATUS_LABELS, lifecycleLabel } from './labels.ts';

const COLUMNS: TaskStatus[] = ['waiting', 'in_progress', 'blocked', 'done'];

function NoCoordinator({ people }: { people: Employee[] }) {
  const [pick, setPick] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <div className="company-banner">
      <p>Şirketin koordinatörü yok. Koordinatör seninle plan konuşur, gerekirse işe alır ve işleri dağıtır.</p>
      <div className="row">
        <button type="button" className="primary" onClick={() => void run(() => api.hireCoordinator())}>
          Koordinatör işe al
        </button>
        {people.length > 0 && (
          <>
            <select aria-label="Koordinatör yapılacak çalışan" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Bir çalışan seç…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button type="button" disabled={!pick} onClick={() => void run(() => api.appointCoordinator(pick))}>
              Koordinatör yap
            </button>
          </>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function PersonCard({ e, current, onOpen }: { e: Employee; current: Task | undefined; onOpen: () => void }) {
  return (
    <button type="button" className="org-card" onClick={onOpen}>
      <strong>{e.name}</strong>
      {e.title && <span className="muted"> — {e.title}</span>}
      {e.kind !== 'member' && <span className="badge">{KIND_LABELS[e.kind]}</span>}
      <span className={`dot ${e.lifecycle}`} aria-hidden="true" />
      <span className="muted">{lifecycleLabel(e.lifecycle)}</span>
      {current && <span className="org-task">şu an: {current.title}</span>}
    </button>
  );
}

/** The company at a glance: who is who (org chart) and what is being done (task board). */
export function CompanyView() {
  const views = useOffice((s) => s.views);
  const tasks = useOffice((s) => s.tasks);
  const plans = useOffice((s) => s.plans);
  const setCompanyOpen = useOffice((s) => s.setCompanyOpen);
  const select = useOffice((s) => s.select);
  const [tab, setTab] = useState<'org' | 'tasks'>('org');
  const [person, setPerson] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const people = useMemo(() => Object.values(views).map((v) => v.employee).filter((e) => e.lifecycle !== 'archived'), [views]);
  const coordinator = people.find((e) => e.kind === 'coordinator');
  const allTasks = Object.values(tasks);
  const currentOf = (id: string) => allTasks.find((t) => t.assignee === id && t.status === 'in_progress');
  const nameOf = (id: string) => (id === 'owner' ? 'sahibi' : (views[id]?.employee.name ?? '—'));
  const open = (id: string) => {
    select(id);
    setCompanyOpen(false);
  };

  const teams = new Map<string, Employee[]>();
  for (const e of people) {
    if (e.kind === 'coordinator') continue;
    const team = e.team || 'Ekipsiz';
    teams.set(team, [...(teams.get(team) ?? []), e]);
  }

  const shown = allTasks.filter((t) => (!person || t.assignee === person) && (!planFilter || (planFilter === 'none' ? t.planId === null : t.planId === planFilter)));

  return (
    <div className="dialog-backdrop" role="presentation" onClick={() => setCompanyOpen(false)}>
      <section className="company" role="dialog" aria-label="Şirket" onClick={(e) => e.stopPropagation()}>
        <header className="row">
          <h2>Şirket</h2>
          <div role="tablist" className="tabs">
            <button type="button" role="tab" aria-selected={tab === 'org'} onClick={() => setTab('org')}>
              Örgüt
            </button>
            <button type="button" role="tab" aria-selected={tab === 'tasks'} onClick={() => setTab('tasks')}>
              Görevler
            </button>
          </div>
          <button type="button" className="icon" aria-label="Kapat" onClick={() => setCompanyOpen(false)}>
            ×
          </button>
        </header>
        {!coordinator && <NoCoordinator people={people} />}
        {tab === 'org' ? (
          <div className="org">
            {coordinator && (
              <section aria-label="Koordinatör" className="org-top">
                <PersonCard e={coordinator} current={currentOf(coordinator.id)} onOpen={() => open(coordinator.id)} />
              </section>
            )}
            <div className="org-teams">
              {[...teams.entries()].map(([team, members]) => (
                <section key={team} aria-label={team} className="org-team">
                  <h3>{team}</h3>
                  {members.map((e) => (
                    <PersonCard key={e.id} e={e} current={currentOf(e.id)} onOpen={() => open(e.id)} />
                  ))}
                </section>
              ))}
            </div>
          </div>
        ) : (
          <div className="board-wrap">
            <div className="row board-filters">
              <label>
                Kişi
                <select aria-label="Kişi" value={person} onChange={(e) => setPerson(e.target.value)}>
                  <option value="">Herkes</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Plan
                <select aria-label="Plan" value={planFilter} onChange={(e) => setPlanFilter(e.target.value)}>
                  <option value="">Hepsi</option>
                  <option value="none">Plansız</option>
                  {Object.values(plans).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="board">
              {COLUMNS.map((status) => {
                const items = shown
                  .filter((t) => t.status === status)
                  .sort((a, b) => (status === 'done' ? (b.finishedAt ?? 0) - (a.finishedAt ?? 0) : a.priority - b.priority || a.createdAt - b.createdAt))
                  .slice(0, status === 'done' ? 20 : undefined);
                return (
                  <section key={status} aria-label={TASK_STATUS_LABELS[status]} className="board-col">
                    <h3>
                      {TASK_STATUS_LABELS[status]} <span className="muted">{items.length}</span>
                    </h3>
                    {items.map((t) => (
                      <article key={t.id} className={`task-card ${t.status}`}>
                        <strong>{t.title}</strong>
                        <span className="muted">
                          {nameOf(t.assignee)} · P{t.priority}
                          {t.planId && plans[t.planId] ? ` · ${plans[t.planId]!.title}` : ''}
                        </span>
                        {t.note && <span className="task-note">{t.note}</span>}
                      </article>
                    ))}
                  </section>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Wire it in**

`apps/office-web/src/ui/EventItem.tsx` — import `PlanCard` and add these cases before `default:`:

```tsx
    case 'plan.changed':
      if (e.change === 'proposed' || e.change === 'revised') return <PlanCard plan={e.plan} />;
      return (
        <div className="note">
          Plan “{e.plan.title}”: {e.change === 'approved' ? 'onaylandı' : e.change === 'declined' ? 'vazgeçildi' : 'bitti'}
        </div>
      );
    case 'company.report':
      return (
        <div className="msg report">
          <span className="who">Rapor</span>
          <p>{e.text}</p>
          {time}
        </div>
      );
    case 'task.changed':
      if (e.change !== 'created' && e.change !== 'finished' && e.change !== 'started') return null;
      return (
        <div className="note">
          Görev {e.change === 'created' ? 'açıldı' : e.change === 'started' ? 'başladı' : 'bitti'}: {e.task.title}
        </div>
      );
    case 'brief.updated':
      return <div className="note">Şirket özeti güncellendi</div>;
    case 'role.changed':
      return <div className="note">Rol: {e.title || e.kind}</div>;
```

`apps/office-web/src/ui/TopBar.tsx` — before the "+ Çalışan al" button:

```tsx
      <button type="button" onClick={() => setCompanyOpen(true)}>
        Şirket
      </button>
```

with `const setCompanyOpen = useOffice((s) => s.setCompanyOpen);`.

`apps/office-web/src/App.tsx` — `const companyOpen = useOffice((s) => s.companyOpen);` and render `{companyOpen && <CompanyView />}` after the hire dialog (import `CompanyView`).

Append to `apps/office-web/src/styles.css`:

```css
.msg.report { background: #fff7e0; border-left: 3px solid var(--accent); }
.plan-card { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); font-size: 14px; }
.plan-card dl { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px; }
.plan-card dt { color: var(--muted); font-size: 12px; }
.plan-card dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.plan-card ol { margin: 0; padding-left: 18px; }
.badge.plan-draft { color: var(--warn); }
.badge.plan-approved, .badge.plan-done { color: var(--ok); }
.company { width: min(1100px, calc(100% - 32px)); max-height: calc(100% - 96px); overflow: auto; display: flex; flex-direction: column; gap: 12px; padding: 18px; background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); }
.company h2 { margin: 0; font-size: 18px; }
.tabs { display: flex; gap: 4px; margin-right: auto; margin-left: 16px; }
.tabs [role='tab'] { padding: 6px 12px; border: 1px solid var(--line); border-radius: 99px; background: var(--surface-2); cursor: pointer; }
.tabs [role='tab'][aria-selected='true'] { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.company-banner { padding: 12px; border-radius: var(--radius); background: #fff7e0; display: flex; flex-direction: column; gap: 8px; }
.company-banner p { margin: 0; }
.org { display: flex; flex-direction: column; gap: 16px; align-items: center; }
.org-teams { display: flex; flex-wrap: wrap; gap: 14px; justify-content: center; width: 100%; }
.org-team { flex: 1 1 220px; max-width: 320px; display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: var(--radius); background: var(--surface-2); }
.org-team h3 { margin: 0; font-size: 13px; color: var(--muted); }
.org-card { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; text-align: left; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); cursor: pointer; }
.org-task { flex-basis: 100%; font-size: 12px; color: var(--info); }
.board-filters { justify-content: flex-start; gap: 16px; }
.board-filters label { display: flex; gap: 6px; align-items: center; font-size: 13px; color: var(--muted); }
.board { display: grid; grid-template-columns: repeat(4, minmax(180px, 1fr)); gap: 10px; }
.board-col { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: var(--radius); background: var(--surface-2); min-height: 120px; }
.board-col h3 { margin: 0; font-size: 13px; }
.task-card { display: flex; flex-direction: column; gap: 2px; padding: 8px; border-radius: 8px; background: var(--surface); border: 1px solid var(--line); font-size: 13px; }
.task-card.blocked { border-color: var(--bad); }
.task-note { font-size: 12px; color: var(--bad); }
@media (max-width: 760px) { .board { grid-template-columns: 1fr; } }
```

- [ ] **Step 6: Run the tests and the build**

Run: `pnpm --filter @cc/office-web exec vitest run && pnpm typecheck && pnpm --filter @cc/office-web build`
Expected: PASS; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/office-web/src
git commit -m "feat(office-web): plan cards to approve, and the Company view

The coordinator's panel shows each plan it proposes as a card with Onayla and
Vazgeç (older versions point at the newer one), its reports, and task notes.
The Company view: an org chart (coordinator on top, teams below, what each
person is on) and a task board by state, filtered by person and plan; without a
coordinator it offers to hire one or appoint an employee."
```

---

### Task 12: Real claude end to end, README and spec

**Files:**
- Create: `apps/office-server/test/company.smoke.real.test.ts`
- Modify: `README.md`, `docs/superpowers/specs/2026-10-06-company-design.md`

- [ ] **Step 1: The opt-in smoke test**

Create `apps/office-server/test/company.smoke.real.test.ts`:

```ts
import type { AddressInfo } from 'node:net';
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
import { setup, waitFor } from './helpers.ts';

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
    const company = new Company({ roster: s.roster, events: s.events, tasks, plans, notices, dataDir: s.dataDir, hire: (i) => engine.hire(i), characters });
    const api = createApi(
      { engine, roster: s.roster, events: s.events, quota: new QuotaTracker(s.db, s.events), mcp: { tokens, tools: officeTools({ company, roster: s.roster, tasks, characters }) }, company: { service: company, tasks, plans } },
      { allowedOrigins: [] },
    );
    await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(api.server.address() as AddressInfo).port}/mcp`;
    const stop = new Dispatcher({ events: s.events, roster: s.roster, tasks, notices, plans, company, engine }).start();
    try {
      const coordinator = company.hireCoordinator('sonnet');
      engine.send(
        coordinator.id,
        'Ofis klasörüne NOTES.md adında, ofisin ne olduğunu iki cümleyle anlatan bir dosya yazdırmak istiyorum. Önce planPropose ile bir plan kartı aç. Onaydan sonra işi kendin yapma: hire ile haiku modelli bir yazar al ve görevi ona ver.',
      );
      const proposed = await waitFor(s.events, (e) => e.event.type === 'plan.changed' && e.event.change === 'proposed', { timeoutMs: 300_000 });
      const plan = (proposed.event as { plan: Plan }).plan;
      company.approve(plan.id);
      const created = await waitFor(s.events, (e) => e.event.type === 'task.changed' && e.event.change === 'created', { after: proposed.seq, timeoutMs: 600_000 });
      const finished = await waitFor(s.events, (e) => e.event.type === 'task.changed' && e.event.change === 'finished', { after: created.seq, timeoutMs: 900_000 });
      const writer = s.roster.list().find((e) => e.id !== coordinator.id);
      expect(writer, 'the coordinator hired someone').toBeDefined();
      expect((finished.event as { task: { assignee: string; result: { summary: string } | null } }).task).toMatchObject({ assignee: writer!.id });
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
```

- [ ] **Step 2: Run it once with the real claude**

Run: `OFFICE_SMOKE=1 pnpm --filter @cc/office-server exec vitest run test/company.smoke.real.test.ts`
Expected: PASS (several minutes; a few cents of Sonnet and Haiku). Without `OFFICE_SMOKE` it is skipped. Afterwards remove the test employees' session folders it left: `rm -rf ~/.claude/projects/-tmp-cc-test-*`.

If the coordinator does the writing itself instead of hiring, that is a role-card problem: tighten the coordinator section of `officeGuide` (Task 3) and run again; record the change as a ruling.

- [ ] **Step 3: README**

Add a section to `README.md` after "Ofisi açmak":

```markdown
## Şirket

Üst çubuktaki **Şirket** görünümünden bir **koordinatör** işe alın (Fable ile çalışır) ya da bir çalışanı koordinatör
yapın. Sonra yalnız koordinatörle konuşursunuz:

1. Ne istediğinizi yazın; koordinatör sohbette bir **plan kartı** açar (yaklaşım, kimler, görevler, tahmini kota/para/süre).
2. Tartışın; kart güncellenir. **Onayla** ile karar verin.
3. Koordinatör gerekirse çalışan alır (rol kartı, model ve karakter onun seçimi) ve görevleri dağıtır. Ofis her
   görevi, çalışanı boşa çıkınca sırayla verir; çalışanlar birbirine iş paslar ve teslim eder.
4. Şirket görünümünde örgüt şeması ve görev panosu canlı akar; koordinatör raporlarını sohbete yazar.

Çalışanlar ofis araçlarına (`taskFinish`, `taskPass`, `planPropose`, `hire`…) ofis sunucusunun `/mcp` adresinden,
her oturuma özel bir jetonla erişir.
```

- [ ] **Step 4: Spec amendments**

In `docs/superpowers/specs/2026-10-06-company-design.md`:
- §3.1, coordinator row: replace "şirketin ilk çalışanı (ofis boşsa kendiliğinden kurulur)" with "Şirket görünümünden tek tıkla işe alınır ya da bir çalışan koordinatör yapılır".
- §7 tools table, first row: remove `taskStart` and add the note under the table: "Görevi ofis, çalışana verirken başlatır (ayrı bir `taskStart` yok)."

- [ ] **Step 5: Full verification and commit**

Run: `pnpm test && pnpm typecheck && pnpm --filter @cc/office-web build`
Expected: all green; build succeeds.

```bash
git add apps/office-server/test/company.smoke.real.test.ts README.md docs/superpowers/specs/2026-10-06-company-design.md
git commit -m "test(company): the whole loop with the real claude; README and spec

An opt-in smoke test drives a Sonnet coordinator through plan card, approval,
hiring a Haiku writer and a handed-in task. README explains the Company view;
the spec records the one-click coordinator and that the office starts tasks."
```
