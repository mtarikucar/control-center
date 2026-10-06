# Company Phase 3 — part 2 (Tasks 6–10)

> Continues `docs/superpowers/plans/2026-10-06-company-phase3.md`. Its header, Global Constraints, rulings and Review
> Focus apply here too.

---

### Task 6: Budget tools

**Files:**
- Modify: `apps/office-server/src/mcp/tools.ts`, `apps/office-server/src/company/roles.ts`, `apps/office-server/src/main.ts` (signature), `apps/office-server/test/company.smoke.real.test.ts` (signature)
- Test: `apps/office-server/test/mcp-tools.test.ts`

**Interfaces:**
- Consumes: `Budget` (Task 4), `Company.setModel` (Task 4), `Engine.sleep/wake` (Task 3).
- Produces: `officeTools(o: { company; roster; tasks; characters; memory; budget: Budget; engine: { sleep(id: string): Promise<unknown>; wake(id: string): unknown } })` with `recordSpend` (everyone) and `budgetStatus`, `setModel`, `sleep`, `wake` (coordinator).

- [ ] **Step 1: Write the failing tests**

In `apps/office-server/test/mcp-tools.test.ts`:
- in `make()`, pass `budget: c.budget, engine: f.engine` to `officeTools`, and return `engine: f.engine` too;
- in the first test, the expected member list gains `'recordSpend'` (sorted: after `'playbookRead'`), and the coordinator-only list gains `'budgetStatus'`, `'setModel'`, `'sleep'`, `'wake'`:

```ts
    expect(names('member')).toEqual(['briefRead', 'decisionsRead', 'memorySearch', 'myTasks', 'noteWrite', 'officeStatus', 'playbookRead', 'recordSpend', 'taskFinish', 'taskPass', 'taskUpdate']);
    expect(names('lead').filter((n) => !names('member').includes(n))).toEqual(['decisionRecord', 'playbookUpdate']);
    expect(names('coordinator').filter((n) => !names('lead').includes(n))).toEqual([
      'briefUpdate', 'budgetStatus', 'editRoleCard', 'employeeNote', 'hire', 'planPropose', 'planRevise', 'reportToOwner', 'setModel', 'sleep',
      'taskAssign', 'taskCreate', 'taskReprioritize', 'wake',
    ]);
```

- append inside the `describe`:

```ts
  it('records spending with its warnings and shows the coordinator the budget', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    t.budget.setConstitution({ monthlyUsdCap: 10 });
    expect(await t.call(ada, 'recordSpend', { service: 'ElevenLabs', usd: 5, purpose: 'ses' })).toBe('Harcama kaydedildi: ElevenLabs $5.');
    expect(await t.call(ada, 'recordSpend', { service: 'Canva', usd: 6, purpose: 'görsel' })).toMatch(/aylık sınırı/);
    await expect(t.call(ada, 'recordSpend', { service: 'x', purpose: 'y' })).rejects.toThrow(/usd/);
    expect(await t.call(c, 'budgetStatus')).toContain('Bu ay harcanan: $11 / sınır $10');
  });

  it('lets the coordinator change a model and put someone to sleep and wake them', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r', model: 'haiku' });
    expect(await t.call(c, 'setModel', { employee: 'Ada', model: 'sonnet' })).toContain('sonnet');
    expect(t.roster.get(ada.id).model).toBe('sonnet');
    await until(() => t.engine.ready(ada.id));
    expect(await t.call(c, 'sleep', { employee: 'Ada' })).toBe('Ada uyudu.');
    expect(t.roster.get(ada.id).lifecycle).toBe('sleeping');
    expect(await t.call(c, 'wake', { employee: ada.id })).toBe('Ada uyandı.');
    await expect(t.call(c, 'sleep', { employee: c.id })).rejects.toThrow(/Kendini uyutamazsın/);
  });
```

(add `until` to the `./helpers.ts` import.)

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/mcp-tools.test.ts`
Expected: FAIL — the new tools are missing.

- [ ] **Step 3: The tools**

In `apps/office-server/src/mcp/tools.ts`:
- `import type { Budget } from '../company/budget.ts';`
- signature: `export function officeTools(o: { company: Company; roster: Roster; tasks: TaskStore; characters: () => string[]; memory: Memory; budget: Budget; engine: { sleep(id: string): Promise<unknown>; wake(id: string): unknown } }): McpTool[] {` and `const { company, roster, tasks, memory, budget, engine } = o;`
- add to the returned array, after `employeeNote`:

```ts
    {
      name: 'recordSpend',
      description: 'Record money you spent on an outside service (a subscription, a purchase, a paid API). Call it right after spending: the office cannot see outside spending, and the owner sets monthly and per-plan limits.',
      inputSchema: object({ service: s('Which service or vendor.'), usd: number('Amount in USD.'), purpose: s('What it was for.'), planId: s('The plan it belongs to.') }, ['service', 'usd', 'purpose']),
      kinds: EVERYONE,
      run: ({ employee }, args) => {
        const usd = num(args, 'usd');
        if (usd === undefined) throw new ValidationError('usd gerekli.');
        const { spend, warnings } = budget.recordSpend(employee.id, { service: str(args, 'service'), usd, purpose: str(args, 'purpose'), planId: optStr(args, 'planId') ?? null });
        return [`Harcama kaydedildi: ${spend.service} $${spend.usd}.`, ...warnings].join('\n');
      },
    },
    {
      name: 'budgetStatus',
      description: 'See the budget (coordinator): quota use and the owner’s reserve, this month’s spending against the cap, money and Claude usage of every running plan, and who used most today.',
      inputSchema: object({}),
      kinds: COORDINATOR,
      run: () => budget.status(),
    },
    {
      name: 'setModel',
      description: `Move an employee to another model (coordinator): ${MODEL_ALIASES.join(', ')}. Their session goes on with the new model and keeps its memory.`,
      inputSchema: object({ employee: s('Employee id or name.'), model: { type: 'string', enum: [...MODEL_ALIASES] } }, ['employee', 'model']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const model = str(args, 'model') as ModelAlias;
        const who = findPerson(str(args, 'employee'));
        const next = company.setModel(employee.id, who.id, model);
        return `${next.name} artık ${next.model} ile çalışıyor (oturumu yeniden açılıyor; hafızası korunur).`;
      },
    },
    {
      name: 'sleep',
      description: 'Put an idle employee to sleep to free the machine (coordinator). Their session is kept; a task for them or a message wakes them.',
      inputSchema: object({ employee: s('Employee id or name.') }, ['employee']),
      kinds: COORDINATOR,
      run: async ({ employee }, args) => {
        const who = findPerson(str(args, 'employee'));
        if (who.id === employee.id) throw new ValidationError('Kendini uyutamazsın.');
        await engine.sleep(who.id);
        return `${who.name} uyudu.`;
      },
    },
    {
      name: 'wake',
      description: 'Wake a sleeping employee (coordinator).',
      inputSchema: object({ employee: s('Employee id or name.') }, ['employee']),
      kinds: COORDINATOR,
      run: (_ctx, args) => {
        const who = findPerson(str(args, 'employee'));
        engine.wake(who.id);
        return `${who.name} uyandı.`;
      },
    },
```

- [ ] **Step 4: The guide**

In `apps/office-server/src/company/roles.ts`:
- `MEMBER` gains, before its last line (`- Şirket özeti aşağıdadır…`):

```
- Para harcayan her işi (abonelik, satın alma, ücretli servis) harcar harcamaz \`recordSpend\` ile bildir: servis, tutar
  (USD), ne için, plan. Ofis dış harcamayı göremez; sınırları sahibi koyar.
```

- `COORDINATOR` gains, before its last line (`- Bir plan bitince…`):

```
- Bütçeyi \`budgetStatus\` ile izle: kota ve sahibinin payı, ayın harcaması, planların parası ve Claude kullanımı.
  Sahibinin payı devredeyken ofis yalnız öncelik 1 işleri başlatır; gerekeni öne al.
- Bir işe model uymuyorsa \`setModel\` ile değiştir (oturum hafızasıyla sürer). Uzun boşta kalacakları \`sleep\` ile
  uyut, gerekince \`wake\` ile uyandır; ofis de boştakileri kendiliğinden uyutur.
```

- [ ] **Step 5: Callers**

`main.ts` and the smoke test call `officeTools`; Task 7 wires the real `Budget`. So the code compiles now, apply Task 7's Step 4 to `main.ts` here (stores, `Budget`, `officeTools({ …, budget, engine })`), and in `company.smoke.real.test.ts` build the budget like `company-helpers.ts` does (a `Budget` over `ConstitutionStore`/`SpendStore` with `quota: new QuotaTracker(s.db, s.events)` and `deskCount: 8`) and pass `budget, engine` to `officeTools`.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @cc/office-server exec vitest run test/mcp-tools.test.ts && pnpm --filter @cc/office-server test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/office-server/src/mcp/tools.ts apps/office-server/src/company/roles.ts apps/office-server/src/main.ts apps/office-server/test/mcp-tools.test.ts apps/office-server/test/company.smoke.real.test.ts
git commit -m "feat(mcp): budget tools

Everyone records spending (recordSpend, with the cap and plan warnings in the
reply). The coordinator sees the budget (budgetStatus), changes models
(setModel) and puts people to sleep or wakes them. The guide says so."
```

---

### Task 7: Owner routes and wiring

**Files:**
- Modify: `apps/office-server/src/api.ts`, `apps/office-server/src/main.ts`
- Test: `apps/office-server/test/company-api.test.ts`

**Interfaces:**
- Produces: `ApiDeps.company.budget: Budget`; `GET /api/budget` → `BudgetSummary`; `GET /api/budget/spend?planId=` → `Spend[]`; `POST /api/constitution` (partial constitution) → 200 `Constitution` / 400; `GET /api/office` carries `budget`.

- [ ] **Step 1: Write the failing tests**

In `apps/office-server/test/company-api.test.ts`: pass `budget: c.budget` in the `company` deps of `start()` and return `budget: c.budget`; append:

```ts
  it('shows the owner the budget and lets them change the constitution', async () => {
    const t = await start();
    const c = t.company.hireCoordinator();
    t.budget.recordSpend(c.id, { service: 'Canva', usd: 12, purpose: 'görsel' });
    expect((await call(t.port, 'GET', '/api/budget')).body).toMatchObject({ month: { usd: 12 }, reserve: { active: false, limitPct: 75 } });
    expect((await call(t.port, 'GET', '/api/budget/spend')).body.map((x: { service: string }) => x.service)).toEqual(['Canva']);
    expect((await call(t.port, 'POST', '/api/constitution', { ownerReservePct: 40 })).body).toMatchObject({ ownerReservePct: 40 });
    expect((await call(t.port, 'POST', '/api/constitution', { ownerReservePct: 400 })).status).toBe(400);
    expect((await call(t.port, 'GET', '/api/office')).body.budget).toMatchObject({ constitution: { ownerReservePct: 40 } });
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/company-api.test.ts`
Expected: FAIL — 404 on `/api/budget`.

- [ ] **Step 3: Routes**

In `apps/office-server/src/api.ts`:
- `import type { Budget } from './company/budget.ts';`; `ApiDeps.company` becomes `company?: { service: Company; tasks: TaskStore; plans: PlanStore; memory: Memory; budget: Budget };`
- in `snapshot`, the company return gets `budget: d.company.budget.summary()`;
- inside the `if (d.company) { … }` block, after the memory routes:

```ts
    const budget = d.company.budget;
    if (method === 'GET' && url.pathname === '/api/budget') return sendJson(res, 200, budget.summary());
    if (method === 'GET' && url.pathname === '/api/budget/spend') return sendJson(res, 200, budget.spending(url.searchParams.get('planId') ?? undefined));
    if (method === 'POST' && url.pathname === '/api/constitution') {
      const body = await readJson(req);
      if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ValidationError('Geçersiz istek gövdesi.');
      return sendJson(res, 200, budget.setConstitution(body as Record<string, unknown>));
    }
```

- [ ] **Step 4: Wiring**

In `apps/office-server/src/main.ts`:
- imports: `import { Budget } from './company/budget.ts';`, `import { ConstitutionStore, SpendStore } from './company/budget-store.ts';`
- after `const memory = …`:

```ts
const budget = new Budget({
  constitution: new ConstitutionStore(db), spend: new SpendStore(db), tasks, plans, roster, events, notices, quota, deskCount: config.deskCount,
});
```

- `new Company({ …, constitution: () => budget.constitution() })`; `new Dispatcher({ …, budget })`; `officeTools({ company, roster, tasks, characters, memory, budget, engine })`; API deps `company: { service: company, tasks, plans, memory, budget }`;
- in the `listen` callback, after `dispatcher.start();` add `budget.watch();`

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @cc/office-server exec vitest run test/company-api.test.ts && pnpm --filter @cc/office-server test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/office-server/src/api.ts apps/office-server/src/main.ts apps/office-server/test/company-api.test.ts
git commit -m "feat(budget): the owner sees the budget and edits the constitution

GET /api/budget and /api/budget/spend, POST /api/constitution (checked key by
key), and the budget in the office snapshot; main wires the budget into the
company, the dispatcher (reserve, sleep) and the tools, and charges every
finished turn to its task."
```

---

### Task 8: Web — budget data, sleeping, feed lines

**Files:**
- Modify: `apps/office-web/src/ui/labels.ts`, `apps/office-web/src/store/reducers.ts`, `apps/office-web/src/net/api.ts`, `apps/office-web/src/ui/EventItem.tsx`
- Test: `apps/office-web/src/store/reducers.test.ts`, `apps/office-web/src/ui/EventItem.test.tsx`, `apps/office-web/src/ui/labels.test.ts`

**Interfaces:**
- Produces: `OfficeData.budget: BudgetSummary | null` (snapshot and `budget.changed`); `model.changed` updates the employee; `canStop`/`canResume` accept `sleeping`; `api.budget()`, `api.spending(planId?)`, `api.setConstitution(patch)`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/office-web/src/store/reducers.test.ts`:

```ts
describe('budget', () => {
  const summary = (pct: number) => ({
    constitution: { maxEmployees: 8, ownerReservePct: pct, monthlyUsdCap: null, chainDepth: 5, tasksPerDay: 30, openTasksPerPlan: 60, idleSleepMinutes: 30 },
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
});
```

Append to `apps/office-web/src/ui/EventItem.test.tsx` (inside the `describe`):

```ts
  it('notes spending and model changes in the feed', () => {
    const { rerender } = render(<EventItem stored={{ seq: 1, employeeId: 'e1', ts: 0, event: { type: 'spend.recorded', spend: { id: 's', ts: 0, by: 'e1', service: 'Canva', usd: 12.5, purpose: 'görsel', planId: null } } }} />);
    expect(screen.getByText('Harcama: Canva $12.5 — görsel')).toBeTruthy();
    rerender(<EventItem stored={{ seq: 2, employeeId: 'e1', ts: 0, event: { type: 'model.changed', model: 'sonnet' } }} />);
    expect(screen.getByText('Model: sonnet')).toBeTruthy();
  });
```

Create (or append to, if it exists) `apps/office-web/src/ui/labels.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { canResume, canStop, lifecycleLabel } from './labels.ts';

describe('sleeping', () => {
  it('is shown as Uyuyor, can be woken (Devam) and stopped', () => {
    expect(lifecycleLabel('sleeping')).toBe('Uyuyor');
    expect(canResume('sleeping')).toBe(true);
    expect(canStop('sleeping')).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-web exec vitest run src/store/reducers.test.ts src/ui/EventItem.test.tsx src/ui/labels.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`apps/office-web/src/ui/labels.ts`: add `|| l === 'sleeping'` to both `canStop` and `canResume`.

`apps/office-web/src/store/reducers.ts`:
- import `BudgetSummary`; `OfficeData` gains `/** The constitution, the reserve and the money (null: an office without the company layer). */ budget: BudgetSummary | null;`
- `EMPTY_DATA` gets `budget: null`; `applySnapshot`'s returned object gets `budget: s.budget ?? null,`
- in `applyEvent`, next to the company lines: `if (ev.type === 'budget.changed') next.budget = ev.budget;`
- in the per-employee `switch`, add:

```ts
    case 'model.changed':
      v = { ...v, employee: { ...v.employee, model: ev.model } };
      break;
```

`apps/office-web/src/ui/EventItem.tsx` — before `default:`:

```tsx
    case 'spend.recorded':
      return <div className="note">{`Harcama: ${e.spend.service} $${e.spend.usd} — ${e.spend.purpose}`}</div>;
    case 'model.changed':
      return <div className="note">{`Model: ${e.model}`}</div>;
```

`apps/office-web/src/net/api.ts` — add `BudgetSummary`, `Constitution`, `Spend` to the type import and:

```ts
  budget: () => request<BudgetSummary>('GET', '/api/budget'),
  spending: (planId?: string) => request<Spend[]>('GET', `/api/budget/spend${planId ? `?planId=${encodeURIComponent(planId)}` : ''}`),
  setConstitution: (patch: Record<string, number | null>) => request<Constitution>('POST', '/api/constitution', patch),
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @cc/office-web exec vitest run && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/office-web/src
git commit -m "feat(office-web): the budget in the store, sleeping people, spending in the feed"
```

---

### Task 9: Web — Bütçe and Anayasa, spending on plan cards, the reserve badge

**Files:**
- Create: `apps/office-web/src/ui/BudgetTabs.tsx`
- Modify: `apps/office-web/src/ui/CompanyView.tsx`, `apps/office-web/src/ui/PlanCard.tsx`, `apps/office-web/src/ui/TopBar.tsx`, `apps/office-web/src/styles.css`
- Test: `apps/office-web/src/ui/BudgetTabs.test.tsx`, `apps/office-web/src/ui/PlanCard.test.tsx`

**Interfaces:**
- Consumes: store `budget`, `plans`, `views`, `usage`; `api.budget`, `api.setConstitution`.
- Produces: `BudgetTab()`, `ConstitutionTab()`; PlanCard shows spent and Claude usage next to the approved money; TopBar shows "Sahibinin payı korunuyor" while the reserve is in force.

- [ ] **Step 1: Write the failing tests**

Create `apps/office-web/src/ui/BudgetTabs.test.tsx`:

```tsx
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BudgetSummary, Employee, Plan } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { BudgetTab, ConstitutionTab } from './BudgetTabs.tsx';

const summary = (over: Partial<BudgetSummary> = {}): BudgetSummary => ({
  constitution: { maxEmployees: 8, ownerReservePct: 25, monthlyUsdCap: 50, chainDepth: 5, tasksPerDay: 30, openTasksPerPlan: 60, idleSleepMinutes: 30 },
  reserve: { active: true, limitPct: 75, fiveHourPct: 82, sevenDayPct: 40 },
  month: { key: '2026-10', usd: 31.5 },
  plans: { p1: { spentUsd: 25, claudeUsd: 3.2 } },
  ...over,
});
vi.mock('../net/api.ts', () => ({ api: { budget: vi.fn(async () => summary()), setConstitution: vi.fn(async (p: object) => p) } }));
const { api } = await import('../net/api.ts');

const plan: Plan = {
  id: 'p1', title: 'Tanıtım videosu', goal: 'g', approach: 'a', people: '', steps: [], quotaPct: 10, usd: 20, days: 3, risks: '',
  status: 'approved', version: 1, proposedBy: 'c', createdAt: 1, updatedAt: 1, approvedAt: 1,
};
const ada: Employee = {
  id: 'ada', slug: 'ada', name: 'Ada', role: 'r', model: 'haiku', characterId: 'coder', title: '', team: 'İçerik', kind: 'member', reportsTo: null,
  deskIndex: 0, sessionId: 's', sessionStarted: true, lifecycle: 'idle', limitResetsAt: null, lastError: null, createdAt: 1,
};

beforeEach(() =>
  useOffice.setState({
    budget: summary(),
    plans: { p1: plan },
    views: { ada: { employee: ada, events: [], openTools: {}, idleSince: null, eventsLoaded: true } },
    usage: { ada: { today: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 1.25 }, total: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 4 } } },
  }),
);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BudgetTab', () => {
  it('shows the reserve, the month against the cap, every plan’s money and usage, and teams today', async () => {
    render(<BudgetTab />);
    expect(screen.getByRole('status').textContent).toMatch(/Sahibinin payı korunuyor/);
    expect(screen.getByText(/5 saat %82/)).toBeTruthy();
    expect(screen.getByText(/\$31.5 \/ \$50/)).toBeTruthy();
    const row = screen.getByRole('row', { name: /Tanıtım videosu/ });
    expect(within(row).getByText('$25 / $20')).toBeTruthy();
    expect(within(row).getByText('~$3.2')).toBeTruthy();
    expect(row.className).toContain('over');
    expect(screen.getByRole('row', { name: /İçerik/ }).textContent).toContain('$1.25');
    await waitFor(() => expect(api.budget).toHaveBeenCalled());
  });
});

describe('ConstitutionTab', () => {
  it('saves the owner’s limits, an empty money cap meaning none', async () => {
    render(<ConstitutionTab />);
    fireEvent.change(screen.getByLabelText('Sahibinin kota payı (%)'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('Aylık para sınırı (USD)'), { target: { value: '' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Kaydet' })));
    expect(api.setConstitution).toHaveBeenCalledWith(expect.objectContaining({ ownerReservePct: 40, monthlyUsdCap: null, maxEmployees: 8 }));
    expect(screen.getByText('Kaydedildi.')).toBeTruthy();
  });

  it('shows the server’s Turkish error', async () => {
    vi.mocked(api.setConstitution).mockRejectedValueOnce(new Error('Anayasa: Çalışan sınırı 1 ile 8 arasında bir tam sayı olmalı.'));
    render(<ConstitutionTab />);
    fireEvent.change(screen.getByLabelText('Çalışan sınırı'), { target: { value: '12' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Kaydet' })));
    expect(screen.getByRole('alert').textContent).toMatch(/1 ile 8/);
  });
});
```

Append to `apps/office-web/src/ui/PlanCard.test.tsx` (inside the `describe`):

```ts
  it('shows what an approved plan has spent next to its money', () => {
    useOffice.setState({
      plans: { p1: plan({ status: 'approved' }) },
      budget: {
        constitution: { maxEmployees: 8, ownerReservePct: 25, monthlyUsdCap: null, chainDepth: 5, tasksPerDay: 30, openTasksPerPlan: 60, idleSleepMinutes: 30 },
        reserve: { active: false, limitPct: 75, fiveHourPct: null, sevenDayPct: null }, month: { key: '2026-10', usd: 0 }, plans: { p1: { spentUsd: 30, claudeUsd: 1.5 } },
      },
    });
    render(<PlanCard plan={plan({ status: 'approved' })} />);
    expect(screen.getByText('Harcanan: $30 / $25 · Claude ~$1.5').className).toContain('over');
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-web exec vitest run src/ui/BudgetTabs.test.tsx src/ui/PlanCard.test.tsx`
Expected: FAIL.

- [ ] **Step 3: The tabs**

Create `apps/office-web/src/ui/BudgetTabs.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from 'react';
import type { BudgetSummary, Constitution } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';
import { PLAN_STATUS_LABELS } from './labels.ts';

const money = (n: number) => `$${Math.round(n * 100) / 100}`;
const pct = (p: number | null) => (p === null ? '—' : `%${p}`);

/** Where the money and the quota go (spec §6): live from the store, refreshed every 15 s while open. */
export function BudgetTab() {
  const stored = useOffice((s) => s.budget);
  const plans = useOffice((s) => s.plans);
  const views = useOffice((s) => s.views);
  const usage = useOffice((s) => s.usage);
  const [fresh, setFresh] = useState<BudgetSummary | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => void api.budget().then((b) => alive && setFresh(b), () => undefined);
    load();
    const timer = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [stored]);
  const b = fresh ?? stored;
  if (!b) return <p className="muted">Yükleniyor…</p>;
  const shown = Object.values(plans)
    .filter((p) => p.status === 'approved' || p.status === 'done')
    .sort((x, y) => y.updatedAt - x.updatedAt);
  const teams = new Map<string, number>();
  for (const v of Object.values(views)) {
    if (v.employee.lifecycle === 'archived') continue;
    const team = v.employee.team || 'Ekipsiz';
    teams.set(team, (teams.get(team) ?? 0) + (usage[v.employee.id]?.today.costUsd ?? 0));
  }
  const cap = b.constitution.monthlyUsdCap;
  return (
    <div className="budget">
      {b.reserve.active && (
        <p className="reserve-banner" role="status">
          Sahibinin payı korunuyor: kullanım %{Math.max(b.reserve.fiveHourPct ?? 0, b.reserve.sevenDayPct ?? 0)}, sınır %{b.reserve.limitPct}. Ofis yalnız öncelik 1 işleri
          başlatıyor; pencere açılınca kendiliğinden döner.
        </p>
      )}
      <section aria-label="Kota">
        <h3>Kota</h3>
        <p>
          5 saat {pct(b.reserve.fiveHourPct)} · 7 gün {pct(b.reserve.sevenDayPct)} · sahibinin payı %{b.constitution.ownerReservePct} (sınır %{b.reserve.limitPct})
        </p>
      </section>
      <section aria-label="Bu ay">
        <h3>Bu ay harcanan</h3>
        <p className={cap !== null && b.month.usd > cap ? 'over' : ''}>
          {money(b.month.usd)}
          {cap !== null ? ` / ${money(cap)}` : ' (sınır yok)'}
        </p>
      </section>
      <section aria-label="Planlar">
        <h3>Planlar</h3>
        {shown.length === 0 ? (
          <p className="muted">Onaylı plan yok.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Plan</th>
                <th>Durum</th>
                <th>Para (harcanan / onaylı)</th>
                <th>Claude kullanımı</th>
                <th>Tahmini kota</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const used = b.plans[p.id] ?? { spentUsd: 0, claudeUsd: 0 };
                const over = p.usd !== null && used.spentUsd > p.usd;
                return (
                  <tr key={p.id} aria-label={p.title} className={over ? 'over' : ''}>
                    <td>{p.title}</td>
                    <td>{PLAN_STATUS_LABELS[p.status]}</td>
                    <td>{`${money(used.spentUsd)}${p.usd !== null ? ` / ${money(p.usd)}` : ''}`}</td>
                    <td>{`~${money(used.claudeUsd)}`}</td>
                    <td>{p.quotaPct !== null ? `%${p.quotaPct}` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      <section aria-label="Ekipler">
        <h3>Ekipler (bugün, Claude kullanımı)</h3>
        <table>
          <tbody>
            {[...teams.entries()].map(([team, usd]) => (
              <tr key={team} aria-label={team}>
                <td>{team}</td>
                <td>{money(usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

const FIELDS: Array<{ key: keyof Constitution; label: string; hint: string; nullable?: boolean }> = [
  { key: 'maxEmployees', label: 'Çalışan sınırı', hint: 'Koordinatör dahil; masa sayısını aşamaz.' },
  { key: 'ownerReservePct', label: 'Sahibinin kota payı (%)', hint: 'Kullanım 100 − bu değere gelince ofis yalnız acil işleri başlatır.' },
  { key: 'monthlyUsdCap', label: 'Aylık para sınırı (USD)', hint: 'Boş: sınır yok.', nullable: true },
  { key: 'chainDepth', label: 'Paslama zinciri', hint: 'Paslanan işten paslanan iş en çok kaç halka olabilir.' },
  { key: 'tasksPerDay', label: 'Günlük görev sınırı', hint: 'Bir çalışanın günde açabileceği görev (koordinatör hariç).' },
  { key: 'openTasksPerPlan', label: 'Plan başına açık görev', hint: 'Bir planda aynı anda açık en çok görev.' },
  { key: 'idleSleepMinutes', label: 'Boşta uyuma (dk)', hint: 'İşi olmayan çalışan bu kadar sonra uyur; 0 = hiç.' },
];

/** The owner's fixed limits; the server checks every value and says what is wrong. */
export function ConstitutionTab() {
  const current = useOffice((s) => s.budget?.constitution);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (current) setDraft(Object.fromEntries(FIELDS.map((f) => [f.key, current[f.key] === null ? '' : String(current[f.key])])));
  }, [current]);
  if (!current) return <p className="muted">Yükleniyor…</p>;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    setError(null);
    const patch: Record<string, number | null> = {};
    for (const f of FIELDS) {
      const raw = (draft[f.key] ?? '').trim().replace(',', '.');
      patch[f.key] = raw === '' && f.nullable ? null : Number(raw);
    }
    try {
      await api.setConstitution(patch);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="constitution" onSubmit={(e) => void save(e)}>
      {FIELDS.map((f) => (
        <label key={f.key}>
          <span>{f.label}</span>
          <input aria-label={f.label} inputMode="decimal" value={draft[f.key] ?? ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
          <small className="muted">{f.hint}</small>
        </label>
      ))}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {saved && <p className="muted">Kaydedildi.</p>}
      <div className="row end">
        <button type="submit" className="primary" disabled={busy}>
          Kaydet
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Wire them in**

`apps/office-web/src/ui/CompanyView.tsx`:
- import `{ BudgetTab, ConstitutionTab }` from `./BudgetTabs.tsx`;
- `TABS` gains `['budget', 'Bütçe'],` and `['constitution', 'Anayasa'],` at the end;
- replace `        ) : (\n          <NotesTab />\n        )}` with:

```tsx
        ) : tab === 'notes' ? (
          <NotesTab />
        ) : tab === 'budget' ? (
          <BudgetTab />
        ) : (
          <ConstitutionTab />
        )}
```

`apps/office-web/src/ui/PlanCard.tsx`:
- `const spent = useOffice((s) => s.budget?.plans[plan.id]);`
- after the estimates paragraph (`{guess && <p className="muted">{guess}</p>}`):

```tsx
      {(live.status === 'approved' || live.status === 'done') && spent && (
        <p className={`muted${live.usd !== null && spent.spentUsd > live.usd ? ' over' : ''}`}>
          {`Harcanan: $${spent.spentUsd}${live.usd !== null ? ` / $${live.usd}` : ''} · Claude ~$${spent.claudeUsd}`}
        </p>
      )}
```

`apps/office-web/src/ui/TopBar.tsx`: `const reserve = useOffice((s) => s.budget?.reserve.active ?? false);` and, before the Şirket button:

```tsx
      {reserve && (
        <span className="badge reserve" title="Kota kullanımı sahibinin payına dayandı: ofis yalnız acil işleri başlatıyor.">
          Sahibinin payı korunuyor
        </span>
      )}
```

Append to `apps/office-web/src/styles.css`:

```css
.budget { display: flex; flex-direction: column; gap: 14px; font-size: 14px; }
.budget h3 { margin: 0 0 4px; font-size: 13px; color: var(--muted); }
.budget p { margin: 0; }
.budget table { width: 100%; border-collapse: collapse; }
.budget th, .budget td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); }
.budget th { font-size: 12px; color: var(--muted); font-weight: 500; }
.over, .budget tr.over td { color: var(--bad); }
.reserve-banner { padding: 10px 12px; border-radius: var(--radius); background: #fff7e0; }
.badge.reserve { background: #fff1d6; color: #8a5a00; }
.constitution { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.constitution label { display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
.constitution input { padding: 6px 8px; border: 1px solid var(--line); border-radius: 8px; font: inherit; }
.constitution .row, .constitution .error, .constitution > p { grid-column: 1 / -1; }
@media (max-width: 760px) { .budget table { font-size: 12px; } }
```

- [ ] **Step 5: Run the tests and the build**

Run: `pnpm --filter @cc/office-web exec vitest run && pnpm typecheck && pnpm --filter @cc/office-web build`
Expected: PASS; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/office-web/src
git commit -m "feat(office-web): Bütçe and Anayasa, spending on plan cards, the reserve badge

The Company view shows the quota and the owner's share, this month's spending
against the cap, each plan's money and Claude usage next to what was approved,
and teams' usage today; the owner edits the constitution there. Approved plan
cards show what they spent; the top bar says when the owner's share is kept."
```

---

### Task 10: Real claude, README and spec

**Files:**
- Modify: `apps/office-server/test/company.smoke.real.test.ts`, `README.md`, `docs/superpowers/specs/2026-10-06-company-design.md`

- [ ] **Step 1: Verify setModel with the real claude**

In `apps/office-server/test/company.smoke.real.test.ts`, between the archive checks and `company.beginHandover(writer!.id)`, add:

```ts
      // The coordinator's setModel goes on with the same session on the new model (spec §3.3: --resume + --model).
      const mark = s.events.lastSeq();
      company.setModel(coordinator.id, writer!.id, 'sonnet');
      const restarted = await waitFor(s.events, (e) => e.employeeId === writer!.id && e.event.type === 'session.started', { after: mark, timeoutMs: 120_000 });
      expect((restarted.event as { model: string }).model).toMatch(/sonnet/);
```

(If `session.started` only arrives with the first message of the new process, the hand-over delivery right after provides it — keep the wait after `beginHandover` in that case and record the ruling.)

- [ ] **Step 2: Run it once with the real claude**

Run: `OFFICE_SMOKE=1 pnpm --filter @cc/office-server exec vitest run test/company.smoke.real.test.ts`
Expected: PASS. Afterwards: `rm -rf ~/.claude/projects/-tmp-cc-test-*`.

- [ ] **Step 3: README**

After the "Şirket hafızası" section add:

```markdown
## Bütçe ve anayasa

Şirket görünümünün **Anayasa** sekmesinde sınırları siz koyarsınız: en çok kaç çalışan, Claude kotasından size ayrılan
pay (varsayılan %25), aylık para sınırı, paslama ve görev sınırları, boştakilerin kaç dakika sonra uyuyacağı.

- **Sahibinin payı:** 5 saatlik ya da haftalık kullanım `100 − pay` sınırına gelince ofis yalnız öncelik 1 işleri
  başlatır, boştakileri uyutur ve koordinatöre haber verir; süren işler kesilmez, pencere açılınca kendiliğinden döner.
  Üst çubukta "Sahibinin payı korunuyor" yazar.
- **Para:** çalışanlar dış harcamayı `recordSpend` ile bildirir. Aylık sınır ya da planın onaylı parası aşılırsa uyarı
  çıkar ve koordinatör sahibine getirir. **Bütçe** sekmesi her planın harcadığını, Claude kullanımını ve onaylanan parayı
  yan yana gösterir.
- **Uyku:** işi olmayan çalışan bir süre sonra uyur (oturumu korunur); görevi gelince ya da siz yazınca uyanır.
- Koordinatör `budgetStatus` ile bütçeyi görür, `setModel` ile birinin modelini değiştirir, `sleep`/`wake` kullanır.
```

- [ ] **Step 4: Spec amendments**

In `docs/superpowers/specs/2026-10-06-company-design.md`:
- §3.4 Uyku, end: "Uyuyan çalışanın yaşam döngüsü `sleeping`'dir (sahibinin `Durdur`'u `stopped`'tan ayrı); ofis yalnız başlatabileceği bir görev için uyandırır, koordinatörü notları için de."
- §6, after the Görünürlük item: "- Plan başına Claude kullanımı: her bitmiş turun maliyeti çalışanın o an sürdüğü göreve, görevler de planlarına yazılır; plan başına kota payı tahmin olarak kalır (kota ortak)."
- §9 `constitution` line: list the keys as built: `maxEmployees`, `ownerReservePct`, `monthlyUsdCap`, `chainDepth`, `tasksPerDay`, `openTasksPerPlan`, `idleSleepMinutes`; `tasks.cost_usd`, `tasks.tokens`.

- [ ] **Step 5: Full verification and commit**

Run: `pnpm test && pnpm typecheck && pnpm --filter @cc/office-web build`
Expected: all green.

```bash
git add apps/office-server/test/company.smoke.real.test.ts README.md docs/superpowers/specs/2026-10-06-company-design.md
git commit -m "test(budget): setModel with the real claude; README and spec

The opt-in smoke test moves the writer to Sonnet and checks the resumed session
runs on it. README explains the constitution, the owner's share, money and
sleep; the spec records the sleeping lifecycle and per-plan Claude usage."
```
