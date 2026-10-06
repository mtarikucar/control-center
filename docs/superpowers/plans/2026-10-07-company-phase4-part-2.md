# Company Phase 4 — part 2 (Tasks 6–10)

> Continues `docs/superpowers/plans/2026-10-07-company-phase4.md`. Its header, Global Constraints, rulings and Review
> Focus apply here too.

---

### Task 6: Owner routes and wiring

**Files:**
- Modify: `apps/office-server/src/api.ts`, `apps/office-server/src/main.ts`, `apps/office-server/test/company.smoke.real.test.ts` (wiring only)
- Test: `apps/office-server/test/company-api.test.ts`

**Interfaces:**
- Produces: `ApiDeps.company.proposals: ProposalStore`; `GET /api/proposals` → open and owner-waiting proposals plus the last 30 decided; `POST /api/proposals/:id/approve` and `/reject` (`{ note? }`) → 200 `Proposal` / 409; `GET /api/office` carries `proposals`; `officeTools`' engine is the real `Engine` (has `sideQuestion`).

- [ ] **Step 1: Write the failing tests**

In `apps/office-server/test/company-api.test.ts`: pass `proposals: c.proposals` in the `company` deps of `start()`; append:

```ts
  it('shows the owner what waits for them and lets them approve or reject it', async () => {
    const t = await start();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    const buy = t.company.openProposal(ada.id, { kind: 'purchase', title: 'Telefon hattı', text: 'Müşteriler arıyor.', usd: 12 });
    const idea = t.company.openProposal(ada.id, { kind: 'idea', title: 'Blog', text: 'Haftalık.' });
    expect((await call(t.port, 'GET', '/api/proposals')).body.map((p: { title: string }) => p.title).sort()).toEqual(['Blog', 'Telefon hattı']);
    expect((await call(t.port, 'POST', `/api/proposals/${buy.id}/approve`, { note: 'Alıyorum.' })).body).toMatchObject({ status: 'accepted', note: 'Alıyorum.' });
    expect((await call(t.port, 'POST', `/api/proposals/${buy.id}/reject`)).status).toBe(409);
    expect((await call(t.port, 'POST', `/api/proposals/${idea.id}/approve`)).status).toBe(409);
    expect((await call(t.port, 'GET', '/api/office')).body.proposals.map((p: { status: string }) => p.status).sort()).toEqual(['accepted', 'open']);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/company-api.test.ts`
Expected: FAIL — 404 on `/api/proposals`.

- [ ] **Step 3: Routes**

In `apps/office-server/src/api.ts`:
- `import type { ProposalStore } from './company/proposal-store.ts';`; `ApiDeps.company` gains `proposals: ProposalStore`;
- add a helper above `snapshot`:

```ts
/** What the owner sees of the proposals: everything still open or waiting for them, and the last 30 decided. */
function visibleProposals(store: ProposalStore) {
  return [...store.list({ statuses: ['open', 'owner'] }), ...store.list({ statuses: ['accepted', 'declined'], limit: 30 })];
}
```

- `snapshot`'s company return gains `proposals: visibleProposals(d.company.proposals)`;
- next to `PLAN_ROUTE`: `const PROPOSAL_ROUTE = /^\/api\/proposals\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(approve|reject)$/;`
- inside `if (d.company) { … }`, after the budget routes:

```ts
    if (method === 'GET' && url.pathname === '/api/proposals') return sendJson(res, 200, visibleProposals(d.company.proposals));
    const decide = PROPOSAL_ROUTE.exec(url.pathname);
    if (method === 'POST' && decide) {
      const note = (await readJson(req)) as { note?: unknown } | null;
      return sendJson(res, 200, company.ownerDecideProposal(decide[1] ?? '', decide[2] === 'approve', typeof note?.note === 'string' ? note.note : undefined));
    }
```

- [ ] **Step 4: Wiring**

In `apps/office-server/src/main.ts`: `import { ProposalStore } from './company/proposal-store.ts';`, `const proposals = new ProposalStore(db);` after `notices`, pass `proposals` to the `Company` and `company: { …, proposals }` to the API. The `engine` passed to `officeTools` is the real `Engine`, which already has `sideQuestion`.

In `apps/office-server/test/company.smoke.real.test.ts` do the same: a `ProposalStore` for the `Company` and the API deps.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @cc/office-server exec vitest run test/company-api.test.ts && pnpm --filter @cc/office-server test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/office-server/src/api.ts apps/office-server/src/main.ts apps/office-server/test/company-api.test.ts apps/office-server/test/company.smoke.real.test.ts
git commit -m "feat(company): the owner sees proposals and approves or rejects what waits for them"
```

---

### Task 7: Web — proposals, pass notes and report badges in the store

**Files:**
- Modify: `apps/office-web/src/store/reducers.ts`, `apps/office-web/src/store/office.ts`, `apps/office-web/src/net/api.ts`, `apps/office-web/src/ui/labels.ts`
- Test: `apps/office-web/src/store/reducers.test.ts`, `apps/office-web/src/store/office.test.ts`

**Interfaces:**
- Produces: `OfficeData.proposals: Record<string, Proposal>`, `OfficeData.pings: Record<string, { text: string; at: number }>` (a pass: a task created by an employee for someone else), `OfficeData.unseenReports: Record<string, number>` (`company.report` per employee); the store's `select(id)` and incoming reports while that panel is open clear the count; `api.proposals()`, `api.approveProposal(id, note?)`, `api.rejectProposal(id, note?)`; `PROPOSAL_KIND_LABELS`, `PROPOSAL_STATUS_LABELS`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/office-web/src/store/reducers.test.ts`:

```ts
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
});
```

(add `Proposal` to the `@cc/shared` type import.)

Append to `apps/office-web/src/store/office.test.ts` (inside its `describe`; it already builds the store with an employee `e1` — adapt the fixture name if it differs):

```ts
  it('forgets the unseen reports of the panel the owner opens, and of the one already open', () => {
    useOffice.setState({ unseenReports: { e1: 2 } });
    useOffice.getState().select('e1');
    expect(useOffice.getState().unseenReports.e1).toBeUndefined();
    useOffice.getState().receive({ type: 'event', event: { seq: 999, employeeId: 'e1', ts: 1, event: { type: 'company.report', text: 'üç' } } });
    expect(useOffice.getState().unseenReports.e1).toBeUndefined();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-web exec vitest run src/store/reducers.test.ts src/store/office.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`apps/office-web/src/store/reducers.ts`:
- import `Proposal`; `OfficeData` gains:

```ts
  proposals: Record<string, Proposal>;
  /** A colleague passed work: the receiver's tag says so for a few seconds. */
  pings: Record<string, { text: string; at: number }>;
  /** Reports the owner has not read yet, per employee (the coordinator's tag shows them). */
  unseenReports: Record<string, number>;
```

- `EMPTY_DATA` gets `proposals: {}, pings: {}, unseenReports: {}`;
- `applySnapshot`'s returned object gets `proposals: Object.fromEntries((s.proposals ?? []).map((p) => [p.id, p])), pings: d.pings, unseenReports: d.unseenReports,`
- in `applyEvent`, next to the company lines:

```ts
  if (ev.type === 'proposal.changed') next.proposals = { ...d.proposals, [ev.proposal.id]: ev.proposal };
  if (ev.type === 'task.changed' && ev.change === 'created' && ev.task.requester !== 'owner' && ev.task.requester !== ev.task.assignee) {
    next.pings = { ...d.pings, [ev.task.assignee]: { text: `Yeni iş: ${ev.task.title}`, at: s.ts } };
  }
  if (ev.type === 'company.report' && s.employeeId) next.unseenReports = { ...d.unseenReports, [s.employeeId]: (d.unseenReports[s.employeeId] ?? 0) + 1 };
```

`apps/office-web/src/store/office.ts`:
- in `select(id)`, after `set({ selectedId: id });` add:

```ts
    if (id && get().unseenReports[id]) {
      const { [id]: _seen, ...rest } = get().unseenReports;
      set({ unseenReports: rest });
    }
```

- in `receive`, in the `event` branch right after the reducer has been applied, add the same clearing for `get().selectedId` when the event is a `company.report` filed under it.

`apps/office-web/src/ui/labels.ts`:

```ts
export const PROPOSAL_KIND_LABELS: Record<ProposalKind, string> = { need: 'İhtiyaç', purchase: 'Satın alma', idea: 'Fikir', objection: 'İtiraz' };
export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = { open: 'Karar bekliyor', owner: 'Senin onayını bekliyor', accepted: 'Kabul edildi', declined: 'Reddedildi' };
```

(with `ProposalKind`, `ProposalStatus` in its type import.)

`apps/office-web/src/net/api.ts` — add `Proposal` to the type import and:

```ts
  proposals: () => request<Proposal[]>('GET', '/api/proposals'),
  approveProposal: (id: string, note?: string) => request<Proposal>('POST', `/api/proposals/${encodeURIComponent(id)}/approve`, note ? { note } : {}),
  rejectProposal: (id: string, note?: string) => request<Proposal>('POST', `/api/proposals/${encodeURIComponent(id)}/reject`, note ? { note } : {}),
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @cc/office-web exec vitest run && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/office-web/src
git commit -m "feat(office-web): proposals, pass notes and unread reports in the store"
```

---

### Task 8: Web — proposal cards, the Öneriler tab, what waits for the owner

**Files:**
- Create: `apps/office-web/src/ui/ProposalCard.tsx`
- Modify: `apps/office-web/src/ui/EventItem.tsx`, `apps/office-web/src/ui/CompanyView.tsx`, `apps/office-web/src/ui/TopBar.tsx`, `apps/office-web/src/styles.css`
- Test: `apps/office-web/src/ui/ProposalCard.test.tsx`, `apps/office-web/src/ui/CompanyView.test.tsx`, `apps/office-web/src/ui/TopBar.test.tsx`

**Interfaces:**
- Produces: `ProposalCard({ proposal })` (the live version; Onayla / Reddet only while it waits for the owner); `proposal.changed` in the feed renders it; Company view tab `Öneriler`; the Şirket button shows how many things wait for the owner (draft plans + owner proposals).

- [ ] **Step 1: Write the failing tests**

Create `apps/office-web/src/ui/ProposalCard.test.tsx`:

```tsx
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Proposal } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { ProposalCard } from './ProposalCard.tsx';

vi.mock('../net/api.ts', () => ({ api: { approveProposal: vi.fn(async () => ({})), rejectProposal: vi.fn(async () => ({})) } }));
const { api } = await import('../net/api.ts');

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: 'q1', ts: 1, by: 'ada', kind: 'purchase', title: 'Telefon hattı', text: 'Müşteriler bizi arayabilsin.', usd: 12, planId: null, status: 'owner',
  routedTo: null, decidedBy: null, note: null, decidedAt: null, ...over,
});

beforeEach(() => useOffice.setState({ proposals: {}, views: {} }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProposalCard', () => {
  it('asks the owner to approve or reject what waits for them', async () => {
    render(<ProposalCard proposal={proposal()} />);
    expect(screen.getByText('Satın alma')).toBeTruthy();
    expect(screen.getByText('Telefon hattı')).toBeTruthy();
    expect(screen.getByText(/\$12/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Onayla' }));
    await waitFor(() => expect(api.approveProposal).toHaveBeenCalledWith('q1'));
  });

  it('has no buttons while the coordinator decides, and shows the decision once made', () => {
    useOffice.setState({ proposals: { q1: proposal({ kind: 'idea', status: 'accepted', note: 'Başla.' }) } });
    render(<ProposalCard proposal={proposal({ kind: 'idea', status: 'open' })} />);
    expect(screen.queryByRole('button', { name: 'Onayla' })).toBeNull();
    expect(screen.getByText('Kabul edildi')).toBeTruthy();
    expect(screen.getByText(/Başla\./)).toBeTruthy();
  });

  it('shows the server’s error', async () => {
    vi.mocked(api.rejectProposal).mockRejectedValueOnce(new Error('Bu öneri sahibinin kararını beklemiyor.'));
    render(<ProposalCard proposal={proposal()} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Reddet' })));
    expect(screen.getByRole('alert').textContent).toMatch(/beklemiyor/);
  });
});
```

Append to `apps/office-web/src/ui/CompanyView.test.tsx` (inside its `describe`):

```ts
  it('lists what waits for the owner first in the Öneriler tab', () => {
    office([person('koor', { kind: 'coordinator' }), person('ada', { name: 'Ada' })]);
    useOffice.setState({
      proposals: {
        a: { id: 'a', ts: 2, by: 'ada', kind: 'idea', title: 'Blog', text: 't', usd: null, planId: null, status: 'open', routedTo: 'koor', decidedBy: null, note: null, decidedAt: null },
        b: { id: 'b', ts: 1, by: 'ada', kind: 'purchase', title: 'Telefon', text: 't', usd: 9, planId: null, status: 'owner', routedTo: null, decidedBy: null, note: null, decidedAt: null },
      },
    });
    render(<CompanyView />);
    fireEvent.click(screen.getByRole('tab', { name: 'Öneriler' }));
    const owner = screen.getByRole('region', { name: 'Senin kararını bekleyenler' });
    expect(within(owner).getByText('Telefon')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Ekipte karar bekleyenler' })).getByText('Blog')).toBeTruthy();
  });
```

Create `apps/office-web/src/ui/TopBar.test.tsx` (or append if it exists):

```tsx
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useOffice } from '../store/office.ts';
import { TopBar } from './TopBar.tsx';

afterEach(cleanup);

describe('TopBar — what waits for the owner', () => {
  it('counts draft plans and proposals waiting for the owner on the Şirket button', () => {
    useOffice.setState({
      plans: { p: { id: 'p', title: 'P', goal: '', approach: '', people: '', steps: [], quotaPct: null, usd: null, days: null, risks: '', status: 'draft', version: 1, proposedBy: 'c', createdAt: 1, updatedAt: 1, approvedAt: null } },
      proposals: { q: { id: 'q', ts: 1, by: 'a', kind: 'purchase', title: 'T', text: '', usd: null, planId: null, status: 'owner', routedTo: null, decidedBy: null, note: null, decidedAt: null } },
    });
    render(<TopBar />);
    expect(screen.getByRole('button', { name: /Şirket/ }).textContent).toContain('2');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-web exec vitest run src/ui/ProposalCard.test.tsx src/ui/CompanyView.test.tsx src/ui/TopBar.test.tsx`
Expected: FAIL.

- [ ] **Step 3: The card**

Create `apps/office-web/src/ui/ProposalCard.tsx`:

```tsx
import { useState } from 'react';
import type { Proposal } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';
import { PROPOSAL_KIND_LABELS, PROPOSAL_STATUS_LABELS } from './labels.ts';

/** A need, idea, objection or purchase someone raised, as it stands now; the owner settles what waits for them. */
export function ProposalCard({ proposal }: { proposal: Proposal }) {
  const live = useOffice((s) => s.proposals[proposal.id]) ?? proposal;
  const views = useOffice((s) => s.views);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameOf = (id: string | null) => (id === null ? '—' : id === 'owner' ? 'sahibi' : (views[id]?.employee.name ?? '—'));
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={`proposal-card ${live.kind}`} aria-label={`${PROPOSAL_KIND_LABELS[live.kind]}: ${live.title}`}>
      <header className="row">
        <span className="badge">{PROPOSAL_KIND_LABELS[live.kind]}</span>
        <strong>{live.title}</strong>
        <span className={`badge proposal-${live.status}`}>{PROPOSAL_STATUS_LABELS[live.status]}</span>
      </header>
      <p className="prose">{live.text}</p>
      <p className="muted">
        {nameOf(live.by)}
        {live.usd !== null ? ` · $${live.usd}` : ''}
        {live.status === 'open' && live.routedTo ? ` · karar: ${nameOf(live.routedTo)}` : ''}
      </p>
      {live.note && <p className="muted">Not: {live.note}</p>}
      {live.status === 'owner' && (
        <div className="row end">
          <button type="button" disabled={busy} onClick={() => void act(() => api.rejectProposal(live.id))}>
            Reddet
          </button>
          <button type="button" className="primary" disabled={busy} onClick={() => void act(() => api.approveProposal(live.id))}>
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

- [ ] **Step 4: Wire it in**

`apps/office-web/src/ui/EventItem.tsx`: import `ProposalCard`; before `default:` add:

```tsx
    case 'proposal.changed':
      return e.change === 'opened' || e.change === 'escalated' ? <ProposalCard proposal={e.proposal} /> : <div className="note">{`Öneri “${e.proposal.title}”: ${e.change === 'accepted' ? 'kabul edildi' : 'reddedildi'}`}</div>;
```

`apps/office-web/src/ui/CompanyView.tsx`:
- import `ProposalCard`; `TABS` gains `['proposals', 'Öneriler'],` after `['tasks', 'Görevler'],`;
- add a component above `CompanyView`:

```tsx
function ProposalsTab() {
  const proposals = useOffice((s) => s.proposals);
  const all = Object.values(proposals).sort((a, b) => b.ts - a.ts);
  const owner = all.filter((p) => p.status === 'owner');
  const open = all.filter((p) => p.status === 'open');
  const decided = all.filter((p) => p.status === 'accepted' || p.status === 'declined').slice(0, 20);
  if (all.length === 0) return <p className="muted">Henüz öneri yok. Çalışanlar ihtiyaç, fikir, itiraz ve satın alma taleplerini buraya getirir.</p>;
  const section = (label: string, items: typeof all) =>
    items.length > 0 && (
      <section aria-label={label} className="proposal-list">
        <h3>{label}</h3>
        {items.map((p) => (
          <ProposalCard key={p.id} proposal={p} />
        ))}
      </section>
    );
  return (
    <div className="proposals">
      {section('Senin kararını bekleyenler', owner)}
      {section('Ekipte karar bekleyenler', open)}
      {section('Karara bağlananlar', decided)}
    </div>
  );
}
```

- add the branch to the tab chain: `) : tab === 'proposals' ? (\n          <ProposalsTab />\n        ) : tab === 'decisions' ? (` in place of `) : tab === 'decisions' ? (`.

`apps/office-web/src/ui/TopBar.tsx`:

```tsx
  const waiting = useOffice(
    (s) => Object.values(s.plans).filter((p) => p.status === 'draft').length + Object.values(s.proposals).filter((p) => p.status === 'owner').length,
  );
```

and the Şirket button's content becomes:

```tsx
        Şirket
        {waiting > 0 && (
          <span className="count" aria-label={`${waiting} karar bekliyor`}>
            {waiting}
          </span>
        )}
```

Append to `apps/office-web/src/styles.css`:

```css
.proposal-card { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); font-size: 14px; }
.proposal-card p { margin: 0; }
.proposal-card.purchase { border-left: 3px solid var(--accent); }
.proposal-card.objection { border-left: 3px solid var(--bad); }
.badge.proposal-owner { color: var(--warn); }
.badge.proposal-accepted { color: var(--ok); }
.badge.proposal-declined { color: var(--muted); }
.proposals { display: flex; flex-direction: column; gap: 14px; }
.proposal-list { display: flex; flex-direction: column; gap: 8px; }
.proposal-list h3 { margin: 0; font-size: 13px; color: var(--muted); }
.count { margin-left: 6px; min-width: 18px; padding: 0 5px; border-radius: 99px; background: var(--accent); color: var(--accent-ink); font-size: 12px; line-height: 18px; display: inline-block; text-align: center; }
```

- [ ] **Step 5: Run the tests and the build**

Run: `pnpm --filter @cc/office-web exec vitest run && pnpm typecheck && pnpm --filter @cc/office-web build`
Expected: PASS; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/office-web/src
git commit -m "feat(office-web): proposal cards, the Öneriler tab, and what waits for the owner

Proposals show as cards in the feed and in a new Öneriler tab (waiting for the
owner first); the owner approves or rejects purchases and escalated proposals
there. The Şirket button counts what waits for the owner."
```

---

### Task 9: 3D — the meeting room, richer tags

**Files:**
- Modify: `apps/office-web/src/office/behavior.ts`, `apps/office-web/src/office/layout.ts`, `apps/office-web/src/scene/CharactersLayer.tsx`, `apps/office-web/src/scene/Character.tsx`, `apps/office-web/src/styles.css`
- Test: `apps/office-web/src/office/behavior.test.ts`, `apps/office-web/src/office/layout.test.ts`, `apps/office-web/src/scene/CharactersLayer.test.tsx`

**Interfaces:**
- Produces: `Zone` gains `'meeting'`; `BehaviorInput.planning?: boolean` (→ meeting, standing, while working or idle); `Layout.meetingSpots: Spot[]` and `spotFor(layout, 'meeting', …)`; the tag shows a ★ for a lead, the running task's title, a pass note for 8 s and an unread-report count.

- [ ] **Step 1: Write the failing tests**

Append to `apps/office-web/src/office/behavior.test.ts` (it has an `input(lifecycle, over?)` helper — adapt to its signature):

```ts
  it('sends a coordinator discussing a plan to the meeting room, working or between turns', () => {
    expect(behaviorOf({ ...input('working'), planning: true })).toEqual({ zone: 'meeting', activity: 'idle', marker: 'none' });
    expect(behaviorOf({ ...input('idle'), planning: true })).toEqual({ zone: 'meeting', activity: 'idle', marker: 'none' });
    expect(behaviorOf({ ...input('stopped'), planning: true }).zone).toBe('desk');
  });
```

Append to `apps/office-web/src/office/layout.test.ts`:

```ts
  it('the meeting spot is free and reachable from every desk', () => {
    const spot = spotFor(LAYOUT, 'meeting', 3);
    expect(isFreeAt(GRID, spot)).toBe(true);
    for (const seat of LAYOUT.seats) expect(findPath(GRID, seat, spot).length).toBeGreaterThan(0);
  });
```

(import `findPath`, `isFreeAt` from `./grid.ts` and `GRID`, `LAYOUT`, `spotFor` from `./layout.ts` if not already.)

Append to `apps/office-web/src/scene/CharactersLayer.test.tsx` a test in its style (it renders the layer with employees in the store and reads the tags' text): a lead with an in-progress task, a fresh ping and two unread reports shows `★`, the task title, `Yeni iş: …` and `2`:

```tsx
  it('puts the lead badge, the running task, a pass note and unread reports on the tag', async () => {
    const lead = { ...person('ada', 0), name: 'Ada', kind: 'lead' as const, team: 'İçerik' };
    useOffice.setState({
      views: { ada: { employee: lead, events: [], openTools: {}, idleSince: null, eventsLoaded: true } },
      tasks: { t1: { id: 't1', kind: 'work', planId: null, title: 'Lansman metni', description: '', done: [], requester: 'owner', assignee: 'ada', priority: 2, dependsOn: [], status: 'in_progress', chainDepth: 0, note: null, result: null, nudged: false, createdAt: 1, startedAt: 2, finishedAt: null } },
      pings: { ada: { text: 'Yeni iş: Slogan', at: Date.now() } },
      unseenReports: { ada: 2 },
    });
    const tag = await renderTag('ada');
    expect(tag.textContent).toContain('★');
    expect(tag.textContent).toContain('Lansman metni');
    expect(tag.textContent).toContain('Yeni iş: Slogan');
    expect(tag.querySelector('.tag-report')?.textContent).toContain('2');
  });
```

(`person` and the way the file renders and finds a tag already exist there; if it has no `renderTag`, write a small helper in the test file that renders `<CharactersLayer />` the way its other tests do and returns `document.querySelector('.tag')` once present.)

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-web exec vitest run src/office src/scene/CharactersLayer.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Behaviour and layout**

`apps/office-web/src/office/behavior.ts`:
- `export type Zone = 'desk' | 'server' | 'coffee' | 'lounge' | 'meeting';`
- `BehaviorInput` gains `/** The coordinator is discussing a plan with the owner (a draft of theirs waits): it stands at the meeting table. */ planning?: boolean;`
- first line of `behaviorOf`'s body: `if (i.planning && (i.lifecycle === 'working' || i.lifecycle === 'idle')) return at('meeting', 'idle');`

`apps/office-web/src/office/layout.ts`:
- `Layout` gains `meetingSpots: Spot[];`
- `LAYOUT` gains, after `serverSpots`:

```ts
  // South of the meeting table, facing it (reachable through the glass room's door; checked by the layout test).
  meetingSpots: [{ x: 10.5, z: 3.3, rotY: PI }],
```

- `spotFor`: `const list = zone === 'desk' ? layout.seats : zone === 'coffee' ? layout.coffeeSpots : zone === 'lounge' ? layout.loungeSpots : zone === 'meeting' ? layout.meetingSpots : layout.serverSpots;`

- [ ] **Step 4: The characters and their tags**

`apps/office-web/src/scene/CharactersLayer.tsx`:
- read `tasks`, `plans`, `pings`, `unseenReports` from the store;
- in the `map`, pass `planning: e.kind === 'coordinator' && Object.values(plans).some((p) => p.status === 'draft' && p.proposedBy === e.id)` to `behaviorOf`;
- give `Character` three props:

```tsx
            task={Object.values(tasks).find((t) => t.assignee === e.id && t.status === 'in_progress')?.title ?? null}
            ping={pings[e.id] && now - pings[e.id]!.at < 8000 ? pings[e.id]!.text : null}
            reports={unseenReports[e.id] ?? 0}
```

`apps/office-web/src/scene/Character.tsx`:
- props gain `task?: string | null; ping?: string | null; reports?: number;`
- in the tag, after the `tag-name` `<strong>`: `{employee.kind === 'lead' && <span className="tag-badge" aria-label="ekip lideri">★</span>}` and `{reports ? <span className="tag-report" aria-label={`${reports} okunmamış rapor`}>📋 {reports}</span> : null}`
- after the `tag-usage` line: `{task && <span className="tag-task">{task.length > 28 ? `${task.slice(0, 27)}…` : task}</span>}` and `{ping && <span className="tag-ping">{ping}</span>}`

Append to `apps/office-web/src/styles.css`:

```css
.tag-badge { color: #c98a00; font-size: 12px; }
.tag-report { font-size: 11px; padding: 0 4px; border-radius: 99px; background: #fff1d6; }
.tag-task { display: block; max-width: 160px; font-size: 11px; color: var(--info); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tag-ping { display: block; font-size: 11px; color: var(--accent); font-weight: 600; }
.dot.sleeping { background: #b8bcc6; }
```

- [ ] **Step 5: Run the tests and the build**

Run: `pnpm --filter @cc/office-web exec vitest run && pnpm typecheck && pnpm --filter @cc/office-web build`
Expected: PASS; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/office-web/src
git commit -m "feat(office-web): the coordinator meets in the glass room; tags tell more

While a plan of theirs waits for the owner the coordinator stands at the
meeting table. Tags show a star for team leads, the running task, a short note
when a colleague passes work, and the coordinator's unread reports."
```

---

### Task 10: Real claude, README and spec

**Files:**
- Modify: `apps/office-server/test/company.smoke.real.test.ts`, `README.md`, `docs/superpowers/specs/2026-10-06-company-design.md`

- [ ] **Step 1: Extend the opt-in smoke test**

In `apps/office-server/test/company.smoke.real.test.ts`, after the decision check and before the `setModel` block, add:

```ts
      // A purchase goes to the owner, who approves it.
      const asked = s.events.lastSeq();
      engine.send(writer!.id, 'Müşterilerin bizi araması için bir telefon hattı lazım. Bunu propose ile satın alma talebi olarak aç (tahmini 12 USD/ay).');
      const raised = await waitFor(s.events, (e) => e.event.type === 'proposal.changed' && e.event.proposal.kind === 'purchase', { after: asked, timeoutMs: 300_000 });
      const purchase = (raised.event as { proposal: { id: string; status: string } }).proposal;
      expect(purchase.status).toBe('owner');
      expect(company.ownerDecideProposal(purchase.id, true).status).toBe('accepted');
      // The coordinator asks the writer without interrupting them.
      const asking = s.events.lastSeq();
      engine.send(coordinator.id, 'askColleague ile yazara NOTES.md dosyasına ne yazdığını sor ve cevabı bana tek cümleyle söyle.');
      await waitFor(s.events, (e) => e.employeeId === writer!.id && e.event.type === 'side.question', { after: asking, timeoutMs: 300_000 });
```

- [ ] **Step 2: Run it once with the real claude**

Run: `OFFICE_SMOKE=1 pnpm --filter @cc/office-server exec vitest run test/company.smoke.real.test.ts`
Expected: PASS. Afterwards: `rm -rf ~/.claude/projects/-tmp-cc-test-*`.

- [ ] **Step 3: README**

After the "Bütçe ve anayasa" section add:

```markdown
## Öneriler ve ekip liderleri

- Çalışanlar **ihtiyaç**, **fikir**, **itiraz** ("yanlış yoldayız") ve **satın alma** taleplerini `propose` ile açar.
  Liderleri ya da koordinatör karara bağlar (karar defterine yazılır) ya da büyükse size getirir. **Satın almalar her
  zaman size gelir**: Şirket görünümünün **Öneriler** sekmesinde (ve koordinatörün sohbetinde) Onayla / Reddet. Şirket
  düğmesindeki sayı sizi bekleyen plan ve talepleri gösterir.
- `askColleague`: bir çalışan arkadaşına onu bölmeden soru sorar.
- Bir ekip büyüyünce koordinatör `appointLead` ile ekip lideri atar; lider kendi ekibine iş açar ve dağıtır, etiketinde
  ★ görünür.
- Bir revizyonu reddederseniz plan onaylı sürümüyle sürer. Koordinatör her gün kısa bir özet raporlar; okunmamış rapor
  etiketinde 📋 olarak görünür. Koordinatör sizinle plan konuşurken toplantı odasına geçer.
```

- [ ] **Step 4: Spec amendments**

In `docs/superpowers/specs/2026-10-06-company-design.md`:
- §4.4, end: "Bir lider öneriyi koordinatöre, koordinatör sahibine götürebilir (`escalate`); satın alma ve sahibine götürülen her öneri sahibinin kartında Onayla / Reddet ile kapanır ve karar defterine sahibinin kararı olarak yazılır."
- §4.1, after the states line: "Onaylı bir planın revizyonu sahibince reddedilirse plan onaylı sürümüne döner (`kept`); hiç onaylanmamış plan reddedilirse vazgeçilir."
- §9 Olaylar line: replace `proposal.*` with `proposal.changed` and `employee.slept/woke` with "`lifecycle.changed` (`sleeping`)".

- [ ] **Step 5: Full verification and commit**

Run: `pnpm test && pnpm typecheck && pnpm --filter @cc/office-web build`
Expected: all green.

```bash
git add apps/office-server/test/company.smoke.real.test.ts README.md docs/superpowers/specs/2026-10-06-company-design.md
git commit -m "test(company): a real purchase request and a colleague question; README and spec

The opt-in smoke test has the writer raise a purchase the owner approves and the
coordinator ask the writer a question without interrupting them. README explains
proposals and leads; the spec records escalation, kept revisions and events."
```
