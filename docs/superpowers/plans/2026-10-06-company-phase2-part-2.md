# Company Phase 2 — part 2 (Tasks 6–11)

> Continues `docs/superpowers/plans/2026-10-06-company-phase2.md`. Its header, Global Constraints, rulings and Review
> Focus apply here too.

---

### Task 6: Hand-over before leaving, and the "özet değişti" line

**Files:**
- Create: `apps/office-server/test/company-helpers.ts`
- Modify: `apps/office-server/src/company/company.ts`, `apps/office-server/src/company/dispatcher.ts`
- Test: `apps/office-server/test/company.test.ts`, `apps/office-server/test/dispatcher.test.ts`

**Interfaces:**
- Consumes: `Task.kind` (Task 1), `Memory` (Task 4), `briefPath` (`./brief.ts`), phase 1 `releaseTasksOf`, `Engine.fire`.
- Produces:
  - `Company.beginHandover(id): Task` (idempotent; refuses an archived employee), `Company.handedOver(id): boolean`, `Company.briefUpdatedAt(): number`; `releaseTasksOf` cancels open hand-over tasks.
  - `DispatchEngine.fire(id): Promise<void>`; the Dispatcher delivers a waiting hand-over first, fires the employee once it is handed in and they are idle, sweeps on `decision.recorded`, and adds "Şirket özeti değişti; güncelini briefRead ile oku." to a delivery when the brief changed since the employee's previous task started.
  - test helper `companyFor(s: TestSetup, f: FakeEngine, characters?: string[]): { tasks; plans; notices; memory; company; reloaded: string[] }`

- [ ] **Step 1: The test helper**

Create `apps/office-server/test/company-helpers.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing tests**

Append to `apps/office-server/test/company.test.ts`:

```ts
describe('Company — hand-over', () => {
  it('review focus: one hand-over task however often the owner asks, priority 1, and the coordinator hears', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    const first = t.company.beginHandover(ada.id);
    expect(first).toMatchObject({ kind: 'handover', priority: 1, requester: OWNER, assignee: ada.id, status: 'waiting' });
    expect(t.company.beginHandover(ada.id).id).toBe(first.id);
    expect(t.notices.pending(c.id).at(-1)?.text).toMatch(/Ada işten çıkarılıyor/);
    expect(t.company.handedOver(ada.id)).toBe(false);
    t.company.start(first.id);
    t.company.finish(ada.id, first.id, { summary: 'Devrettim.', outputs: [], learned: '' });
    expect(t.company.handedOver(ada.id)).toBe(true);
    await t.engine.fire(ada.id);
    expect(() => t.company.beginHandover(ada.id)).toThrow(/zaten işten çıkarıldı/);
  });

  it('review focus: firing at once during a hand-over cancels it and returns only the real work', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    const work = t.company.createTask(c.id, { assignee: ada.id, title: 'gerçek iş' });
    const handover = t.company.beginHandover(ada.id);
    await t.engine.fire(ada.id);
    t.company.releaseTasksOf(ada.id);
    expect(t.tasks.get(handover.id).status).toBe('cancelled');
    expect(t.tasks.get(work.id).status).toBe('waiting');
    const note = t.notices.pending(c.id).at(-1)!.text;
    expect(note).toContain('gerçek iş');
    expect(note).not.toContain('Devir');
  });
});
```

Append to `apps/office-server/test/dispatcher.test.ts` (it already has `make`, `systemMessages`, `sleep`; add `import { companyFor } from './company-helpers.ts';` at the top):

```ts
describe('Dispatcher — hand-over and the brief', () => {
  function makeFull() {
    const s = setup();
    const f = fakeEngine(s);
    const c = companyFor(s, f);
    const stop = new Dispatcher({ events: s.events, roster: s.roster, tasks: c.tasks, notices: c.notices, plans: c.plans, company: c.company, engine: f.engine }).start();
    cleanups.push(stop, f.cleanup, s.cleanup);
    return { ...s, ...c, engine: f.engine };
  }

  it('hands the hand-over over first even with a task open, then lets the person go and returns their work', async () => {
    const t = makeFull();
    const coord = t.company.hireCoordinator();
    const ada = t.company.hire(coord.id, { name: 'Ada', role: 'r' });
    const work = t.company.createTask(coord.id, { assignee: ada.id, title: 'Uzun iş' });
    await until(() => t.tasks.get(work.id).status === 'in_progress');
    const handover = t.company.beginHandover(ada.id);
    await until(() => systemMessages(t.events.list({ limit: 5000 }), ada.id).some((m) => m.includes('Devir: işten ayrılıyorsun')), 8000);
    expect(t.tasks.get(handover.id).status).toBe('in_progress');
    t.company.finish(ada.id, handover.id, { summary: 'Bildiklerimi yazdım.', outputs: [], learned: 'Müşteri sabah arar.' });
    await until(() => t.roster.get(ada.id).lifecycle === 'archived', 8000);
    await until(() => t.tasks.get(work.id).status === 'waiting');
    await until(() => systemMessages(t.events.list({ limit: 5000 }), coord.id).some((m) => m.includes('Uzun iş') && m.includes('işten çıkarıldı')), 8000);
    expect(t.memory.notes('müşteri')).toHaveLength(1);
  });

  it('review focus: a stopped employee’s hand-over waits until they run again', async () => {
    const t = makeFull();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    await t.engine.stop(ada.id);
    const handover = t.company.beginHandover(ada.id);
    await sleep(400);
    expect(t.tasks.get(handover.id).status).toBe('waiting');
    expect(t.roster.get(ada.id).lifecycle).toBe('stopped');
  });

  it('tells the employee once that the brief changed since their previous task', async () => {
    const t = makeFull();
    const coord = t.company.hireCoordinator();
    const ada = t.company.hire(coord.id, { name: 'Ada', role: 'r' });
    const delivered = (title: string) => systemMessages(t.events.list({ limit: 5000 }), ada.id).find((m) => m.includes(`## Görev: ${title}`));
    const run = async (title: string) => {
      const task = t.company.createTask(coord.id, { assignee: ada.id, title });
      await until(() => delivered(title) !== undefined, 8000);
      t.company.finish(ada.id, task.id, { summary: 'tamam', outputs: [], learned: '' });
      return delivered(title)!;
    };
    expect(await run('bir')).not.toContain('Şirket özeti değişti');
    await sleep(20);
    t.company.updateBrief(coord.id, '# Özet\n\nYeni kural: her iş testli teslim edilir.\n');
    await sleep(20);
    expect(await run('iki')).toContain('Şirket özeti değişti');
    expect(await run('üç')).not.toContain('Şirket özeti değişti');
  });
});
```

(Add `OWNER` to the `@cc/shared` import of `dispatcher.test.ts` if it is not there; it is.)

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/company.test.ts test/dispatcher.test.ts`
Expected: FAIL — `beginHandover is not a function`.

- [ ] **Step 4: Company**

In `apps/office-server/src/company/company.ts`:
- imports: add `statSync` from `node:fs` (new import line `import { statSync } from 'node:fs';`) and `briefPath` to the `./brief.ts` import;
- add after `const BRIEF_MAX = 8000;`:

```ts
const HANDOVER_TITLE = 'Devir: işten ayrılıyorsun';
const HANDOVER_TEXT = `Sahibi seni işten çıkarıyor. Ayrılmadan önce bildiklerini şirkete devret: öğrendiklerini ve yarım kalan işlerin
durumunu yaz, işe yarayacak dosyaları göster. Bu görevi taskFinish ile teslim edince ofis seni işten çıkaracak; açık
görevlerin koordinatöre döner.`;
const HANDOVER_DONE = [
  'Öğrendiklerin ve başkasının bilmesi gerekenler noteWrite ile şirket notlarında',
  'Elindeki işlerin durumu teslim özetinde (açık görevlerin koordinatöre dönecek)',
  'İşe yarayacak dosyalar teslimin outputs listesinde',
];
```

- replace `releaseTasksOf` with:

```ts
  /** Someone was fired: their open work waits again and the coordinator hands it out (spec §10); a hand-over is cancelled. */
  releaseTasksOf(id: string): void {
    const work: Task[] = [];
    for (const task of this.#d.tasks.list({ assignee: id, statuses: ['waiting', 'in_progress', 'blocked'] })) {
      if (task.kind === 'handover') {
        this.#taskEvent('updated', this.#d.tasks.update(task.id, { status: 'cancelled', finishedAt: this.#now() }));
        continue;
      }
      work.push(task);
      if (task.status !== 'waiting') this.#taskEvent('updated', this.#d.tasks.update(task.id, { status: 'waiting', startedAt: null, nudged: false }));
    }
    if (work.length === 0) return;
    const list = work.map((t) => `“${t.title}” (no ${t.id})`).join(', ');
    this.#tellCoordinator(id, `${this.nameOf(id)} işten çıkarıldı; açık görevleri sahipsiz bekliyor: ${list}. taskAssign ile yeniden dağıt.`);
  }

  /**
   * The owner's "İşten çıkar": first a hand-over task (write down what you know), delivered before anything else; the
   * Dispatcher lets the person go once it is handed in (spec §3.4). Asking again returns the same task.
   */
  beginHandover(id: string): Task {
    const employee = this.#d.roster.get(id);
    if (employee.lifecycle === 'archived') throw new ConflictError(`${employee.name} zaten işten çıkarıldı.`);
    const open = this.#d.tasks.list({ assignee: id, statuses: ['waiting', 'in_progress', 'blocked'] }).find((t) => t.kind === 'handover');
    if (open) return open;
    const task = this.#d.tasks.create({
      kind: 'handover', planId: null, title: HANDOVER_TITLE, description: HANDOVER_TEXT, done: HANDOVER_DONE,
      requester: OWNER, assignee: id, priority: 1, dependsOn: [], chainDepth: 0,
    });
    this.#taskEvent('created', task);
    this.#tellCoordinator(id, `${employee.name} işten çıkarılıyor; önce devir notlarını yazıyor. Açık görevleri sonra sana dönecek.`);
    return task;
  }

  /** The hand-over is in: the office may let them go. */
  handedOver(id: string): boolean {
    return this.#d.tasks.list({ assignee: id, statuses: ['done'] }).some((t) => t.kind === 'handover');
  }

  /** When the company brief last changed (0 = never written). */
  briefUpdatedAt(): number {
    try {
      return statSync(briefPath(this.#d.dataDir)).mtimeMs;
    } catch {
      return 0;
    }
  }
```

- [ ] **Step 5: Dispatcher**

In `apps/office-server/src/company/dispatcher.ts`:
- `DispatchEngine` gains `fire(id: string): Promise<void>;`
- add a field `readonly #leaving = new Set<string>();`
- in `start()`, sweep on decisions too: `else if (ev.type === 'task.changed' || ev.type === 'plan.changed' || ev.type === 'decision.recorded') this.#scheduleSweep();`
- replace `#consider` with:

```ts
  #consider(id: string): void {
    if (!this.#d.engine.ready(id)) return;
    if (this.#d.company.handedOver(id)) {
      this.#letGo(id);
      return;
    }
    const pending = this.#d.notices.pending(id);
    const current = this.#d.tasks.inProgressOf(id);
    const handover = this.#d.tasks.list({ assignee: id, statuses: ['waiting'] }).find((t) => t.kind === 'handover');
    let body = '';
    let started: Task | null = null;
    if (handover) {
      // Leaving comes first, even with another task open: that task goes back to the coordinator afterwards.
      started = this.#d.company.start(handover.id);
    } else if (current) {
      if (!current.nudged) body = this.#nudge(current);
      else this.#escalate(id, current);
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
    if (!started && current && !current.nudged) this.#d.tasks.update(current.id, { nudged: true });
    this.#d.notices.markDelivered(pending.map((n) => n.id));
  }

  /** The hand-over is in and they are idle: fire them, then their open work goes back to the coordinator. */
  #letGo(id: string): void {
    if (this.#leaving.has(id)) return;
    this.#leaving.add(id);
    void this.#d.engine
      .fire(id)
      .then(() => this.#d.company.releaseTasksOf(id))
      .catch(() => this.#leaving.delete(id));
  }

  /** The brief changed since this employee's previous task started (or since they were hired). */
  #briefChanged(task: Task): boolean {
    const changed = this.#d.company.briefUpdatedAt();
    if (changed === 0) return false;
    const earlier = this.#d.tasks
      .list({ assignee: task.assignee })
      .filter((t) => t.id !== task.id && t.startedAt !== null)
      .map((t) => t.startedAt as number);
    const since = earlier.length ? Math.max(...earlier) : this.#d.roster.get(task.assignee).createdAt;
    return changed >= since;
  }
```

- in `#delivery`, after the `const deps = …` line add `const brief = this.#briefChanged(task) ? '\nŞirket özeti değişti; güncelini briefRead ile oku.' : '';` and put `${brief}` right after `${deps}` in the returned text.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @cc/office-server exec vitest run test/company.test.ts test/dispatcher.test.ts && pnpm --filter @cc/office-server test && pnpm typecheck`
Expected: PASS. (`main.ts` passes the real `Engine`, which has `fire`; `dispatcher.test.ts`'s phase-1 `make` passes the fake engine, which is an `Engine` too.)

- [ ] **Step 7: Commit**

```bash
git add apps/office-server/src/company/company.ts apps/office-server/src/company/dispatcher.ts apps/office-server/test/company-helpers.ts apps/office-server/test/company.test.ts apps/office-server/test/dispatcher.test.ts
git commit -m "feat(memory): a hand-over before anyone leaves, and news of a changed brief

İşten çıkar first gives a priority-1 hand-over task, delivered before anything
else; once it is handed in the office lets the person go and their open work
returns to the coordinator. A delivery says when the company brief changed since
the employee's previous task. Reverted decisions reach the coordinator at once."
```

---

### Task 7: The memory tools

**Files:**
- Modify: `apps/office-server/src/mcp/tools.ts`, `apps/office-server/test/company.smoke.real.test.ts` (signature only), `apps/office-server/src/main.ts` (signature only)
- Test: `apps/office-server/test/mcp-tools.test.ts`

**Interfaces:**
- Consumes: `Memory` (Task 4), `MemoryHit` (Task 1).
- Produces: `officeTools(o: { company; roster; tasks; characters; memory: Memory }): McpTool[]` with new tools `memorySearch`, `noteWrite`, `playbookRead`, `decisionsRead` (everyone), `playbookUpdate`, `decisionRecord` (lead + coordinator), `employeeNote` (coordinator); `taskFinish` reports the archive path.

- [ ] **Step 1: Write the failing tests**

In `apps/office-server/test/mcp-tools.test.ts`:
- replace `make()` with:

```ts
function make() {
  const s = setup();
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, ['coder', 'designer']);
  const tools = officeTools({ company: c.company, roster: s.roster, tasks: c.tasks, characters: () => ['coder', 'designer'], memory: c.memory });
  const call = async (employee: Employee, name: string, args: Record<string, unknown> = {}) => {
    const tool = tools.find((t: McpTool) => t.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    const current = s.roster.get(employee.id);
    if (!tool.kinds.includes(current.kind)) throw new Error(`closed: ${name}`);
    return tool.run({ employee: current }, args);
  };
  return { ...s, ...c, tools, call };
}
```

(and replace the imports of `Company`, `NoticeStore`, `PlanStore`, `TaskStore` with `import { companyFor } from './company-helpers.ts';`)
- replace the first test ("splits the tools…") with:

```ts
  it('splits the tools between everyone, leads and the coordinator', () => {
    const t = make();
    const names = (kind: 'member' | 'lead' | 'coordinator') => t.tools.filter((x) => x.kinds.includes(kind)).map((x) => x.name).sort();
    expect(names('member')).toEqual(['briefRead', 'decisionsRead', 'memorySearch', 'myTasks', 'noteWrite', 'officeStatus', 'playbookRead', 'taskFinish', 'taskPass', 'taskUpdate']);
    expect(names('lead').filter((n) => !names('member').includes(n))).toEqual(['decisionRecord', 'playbookUpdate']);
    expect(names('coordinator').filter((n) => !names('lead').includes(n))).toEqual([
      'briefUpdate', 'editRoleCard', 'employeeNote', 'hire', 'planPropose', 'planRevise', 'reportToOwner', 'taskAssign', 'taskCreate', 'taskReprioritize',
    ]);
    for (const tool of t.tools) expect(tool.inputSchema).toMatchObject({ type: 'object' });
  });
```

- append inside the `describe`:

```ts
  it('everyone writes and searches the memory; leads and the coordinator write the playbook and decisions', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    expect(await t.call(ada, 'noteWrite', { title: 'Seslendirme', text: 'ElevenLabs Türkçe iyi.', tags: ['ses'] })).toMatch(/Not kaydedildi/);
    expect(await t.call(ada, 'memorySearch', { query: 'turkce' })).toContain('[not] Seslendirme');
    expect(await t.call(ada, 'memorySearch', { query: 'hiçbirşey' })).toContain('bir şey yok');
    expect(await t.call(ada, 'playbookRead')).toBe('El kitabı henüz boş.');
    await t.call(c, 'playbookUpdate', { topic: 'Video üretimi', text: 'Önce senaryo, sonra ses.', reason: 'ilk sürüm' });
    expect(await t.call(ada, 'playbookRead')).toContain('Video üretimi (sürüm 1');
    expect(await t.call(ada, 'playbookRead', { topic: 'video ÜRETİMİ' })).toContain('Önce senaryo, sonra ses.');
    await t.call(c, 'decisionRecord', { title: 'Ses aracı', chosen: 'ElevenLabs', reason: 'Türkçe', alternatives: ['Polly'] });
    expect(await t.call(ada, 'decisionsRead')).toMatch(/Ses aracı → ElevenLabs — Türkçe \[alternatifler: Polly\]/);
    await expect(t.call(ada, 'decisionRecord', { title: 'x', chosen: 'y', reason: 'z' })).rejects.toThrow(/closed/);
    t.roster.update(ada.id, { kind: 'lead' });
    expect(await t.call(ada, 'playbookUpdate', { topic: 'Video üretimi', text: 'Senaryo, ses, kurgu.' })).toContain('sürüm 2');
  });

  it('lets the coordinator keep an employee file and read it back', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r', title: 'Yazar' });
    await t.call(c, 'employeeNote', { employee: 'ada', text: 'Kısa metinlerde çok iyi.' });
    const task = t.company.createTask(c.id, { assignee: ada.id, title: 'Slogan' });
    t.company.start(task.id);
    const handed = await t.call(ada, 'taskFinish', { taskId: task.id, summary: 'Üç slogan.', outputs: [] });
    expect(handed).toMatch(/arşiv: company\/archive\//);
    const file = await t.call(c, 'employeeNote', { employee: ada.id });
    expect(file).toContain('Ada — Yazar: 1 görev bitirdi.');
    expect(file).toContain('Kısa metinlerde çok iyi.');
    expect(file).toContain('Slogan: Üç slogan.');
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/mcp-tools.test.ts`
Expected: FAIL — the new tools are missing.

- [ ] **Step 3: The tools**

In `apps/office-server/src/mcp/tools.ts`:
- imports: add `type MemoryHit` to the `@cc/shared` import and `import type { Memory } from '../company/memory.ts';`
- after `const COORDINATOR: EmployeeKind[] = ['coordinator'];` add:

```ts
const LEADS: EmployeeKind[] = ['lead', 'coordinator'];
const HIT_KIND: Record<MemoryHit['kind'], string> = { note: 'not', decision: 'karar', playbook: 'el kitabı', task: 'teslim' };
const day = (ts: number) => new Date(ts).toISOString().slice(0, 10);
```

- change the signature to `export function officeTools(o: { company: Company; roster: Roster; tasks: TaskStore; characters: () => string[]; memory: Memory }): McpTool[] {` and the destructuring to `const { company, roster, tasks, memory } = o;`
- in `taskFinish`'s `run`, return `\`“${task.title}” teslim edildi${task.result?.archive ? \` (arşiv: ${task.result.archive})\` : ''}. İsteyen ve koordinatör haberdar edildi.\``
- add these tools to the returned array, after `briefRead`:

```ts
    {
      name: 'memorySearch',
      description: 'Search the company memory (knowledge notes, decisions, playbook topics and finished work) for every word you give. Use it before starting work and whenever you wonder whether the company already knows something.',
      inputSchema: object({ query: s('Words to look for.'), limit: integer('How many results (default 10).', 1, 30) }, ['query']),
      kinds: EVERYONE,
      run: (_ctx, args) => {
        const hits = memory.search(str(args, 'query'), num(args, 'limit') ?? 10);
        if (hits.length === 0) return 'Şirket hafızasında bununla ilgili bir şey yok.';
        return hits.map((h) => `• [${HIT_KIND[h.kind]}] ${h.title} (${day(h.ts)}, ${h.kind === 'playbook' ? `playbookRead konu: ${h.id}` : h.id}): ${h.snippet}`).join('\n');
      },
    },
    {
      name: 'noteWrite',
      description: 'Write a knowledge note for the whole company: something you learned that others will need (a tool that works, a pitfall, a contact, a number). Short title, the facts, a few tags.',
      inputSchema: object({ title: s('Short title.'), text: s('The note.'), tags: strings('Up to 8 tags.') }, ['title', 'text']),
      kinds: EVERYONE,
      run: ({ employee }, args) => {
        const note = memory.writeNote(employee.id, { title: str(args, 'title'), text: str(args, 'text'), tags: list(args, 'tags') });
        return `Not kaydedildi (#${note.id}).`;
      },
    },
    {
      name: 'playbookRead',
      description: 'Read the company playbook: without a topic, the list of topics; with a topic, how the company does it (the newest version). Follow it unless you have a reason not to, and say so.',
      inputSchema: object({ topic: s('Topic name.') }),
      kinds: EVERYONE,
      run: (_ctx, args) => {
        const topic = optStr(args, 'topic');
        if (!topic) {
          const topics = memory.playbookTopics();
          return topics.length ? `El kitabı konuları:\n${topics.map((t) => `• ${t.topic} (sürüm ${t.version}, ${day(t.ts)})`).join('\n')}` : 'El kitabı henüz boş.';
        }
        const entry = memory.playbookTopic(topic);
        return `# ${entry.topic} (sürüm ${entry.version}, ${company.nameOf(entry.by)}, ${day(entry.ts)})\n\n${entry.text}`;
      },
    },
    {
      name: 'decisionsRead',
      description: 'Read the company decision log, newest first: what was chosen, why, and the alternatives; reverted decisions are marked. Filter by words or by plan id.',
      inputSchema: object({ query: s('Words to look for.'), planId: s('Only this plan’s decisions.'), limit: integer('How many (default 15).', 1, 50) }),
      kinds: EVERYONE,
      run: (_ctx, args) => {
        const found = memory.decisions({ query: optStr(args, 'query'), planId: optStr(args, 'planId'), limit: num(args, 'limit') ?? 15 });
        if (found.length === 0) return 'Karar defterinde eşleşen kayıt yok.';
        const reverted = new Set(memory.decisions({ limit: 500 }).map((d) => d.reverts).filter((x): x is string => x !== null));
        return found
          .map((d) => `• ${day(d.ts)} ${d.title} → ${d.chosen}${reverted.has(d.id) ? ' (geri alındı)' : ''} — ${d.reason}${d.alternatives.length ? ` [alternatifler: ${d.alternatives.join(', ')}]` : ''} (${company.nameOf(d.by)}, ${d.id})`)
          .join('\n');
      },
    },
    {
      name: 'playbookUpdate',
      description: 'Write a new version of a playbook topic (coordinator or team lead): the whole method as it should be followed from now on, and why it changed.',
      inputSchema: object({ topic: s('Topic name, e.g. "Test prosedürü".'), text: s('The whole method, in Markdown.'), reason: s('Why it changed.') }, ['topic', 'text']),
      kinds: LEADS,
      run: ({ employee }, args) => {
        const entry = memory.updatePlaybook(employee.id, { topic: str(args, 'topic'), text: str(args, 'text'), reason: optStr(args, 'reason') });
        return `El kitabı güncellendi: “${entry.topic}” sürüm ${entry.version}.`;
      },
    },
    {
      name: 'decisionRecord',
      description: 'Record a decision in the company decision log (coordinator or team lead): what was decided about, what was chosen, why, and the alternatives considered. The owner can revert it.',
      inputSchema: object({ title: s('What was decided about.'), chosen: s('What was chosen.'), reason: s('Why.'), alternatives: strings('Other options considered.'), planId: s('The plan it belongs to.') }, ['title', 'chosen', 'reason']),
      kinds: LEADS,
      run: ({ employee }, args) => {
        const d = memory.recordDecision(employee.id, { title: str(args, 'title'), chosen: str(args, 'chosen'), reason: str(args, 'reason'), alternatives: list(args, 'alternatives'), planId: optStr(args, 'planId') ?? null });
        return `Karar kaydedildi (${d.id}).`;
      },
    },
    {
      name: 'employeeNote',
      description: 'The employee file (coordinator): with text, add an observation about someone (what they are good at, what to watch); without text, read their file (your notes and their finished work). Look at it before handing out work.',
      inputSchema: object({ employee: s('Employee id or name.'), text: s('Your observation.') }, ['employee']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const text = optStr(args, 'text');
        const who = findPerson(str(args, 'employee'));
        if (text) {
          memory.addEmployeeNote(employee.id, who.id, text);
          return `${who.name} adlı çalışanın dosyasına not eklendi.`;
        }
        const file = memory.employeeFile(who.id);
        return [
          `${who.name}${who.title ? ` — ${who.title}` : ''}: ${file.finished} görev bitirdi.`,
          ...(file.notes.length ? ['Notların:', ...file.notes.map((n) => `• ${day(n.ts)} ${n.text}`)] : ['Henüz notun yok.']),
          ...(file.recent.length ? ['Son işleri:', ...file.recent.map((r) => `• ${r.title}: ${r.summary}`)] : []),
        ].join('\n');
      },
    },
```

- [ ] **Step 4: Callers**

In `apps/office-server/test/company.smoke.real.test.ts` and `apps/office-server/src/main.ts` the call `officeTools({ company, roster…, tasks, characters })` needs `memory`; Task 8 (main) and Task 11 (smoke) wire the real one. For now, so the code compiles, the smoke test builds it with `companyFor`-style stores — replace its company construction with:

```ts
    const { DecisionStore, EmployeeNoteStore, NoteStore, PlaybookStore } = await import('../src/company/memory-store.ts');
    const { Memory } = await import('../src/company/memory.ts');
    const memory = new Memory({ roster: s.roster, events: s.events, notices, tasks, plans, dataDir: s.dataDir, decisions: new DecisionStore(s.db), playbook: new PlaybookStore(s.db), notes: new NoteStore(s.db), employeeNotes: new EmployeeNoteStore(s.db) });
    const company = new Company({ roster: s.roster, events: s.events, tasks, plans, notices, dataDir: s.dataDir, hire: (i) => engine.hire(i), characters, memory, reload: (id) => engine.reload(id) });
```

and pass `memory` to `officeTools`. In `main.ts`, Task 8 does the wiring; until then add the same stores and `Memory` there (Task 8's Step 4 shows the final code — apply it now).

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @cc/office-server exec vitest run test/mcp-tools.test.ts && pnpm --filter @cc/office-server test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/office-server/src/mcp/tools.ts apps/office-server/src/main.ts apps/office-server/test/mcp-tools.test.ts apps/office-server/test/company.smoke.real.test.ts
git commit -m "feat(mcp): memory tools

Everyone: memorySearch, noteWrite, playbookRead, decisionsRead. Leads and the
coordinator: playbookUpdate, decisionRecord. The coordinator: employeeNote
(write or read a file). taskFinish says where the hand-in was archived."
```

---

### Task 8: Owner routes and wiring

**Files:**
- Modify: `apps/office-server/src/api.ts`, `apps/office-server/src/main.ts`
- Test: `apps/office-server/test/company-api.test.ts`

**Interfaces:**
- Consumes: `Memory`, `Company.beginHandover`/`releaseTasksOf`.
- Produces:
  - `ApiDeps.company: { service: Company; tasks: TaskStore; plans: PlanStore; memory: Memory }`
  - `GET /api/memory/decisions` → `Decision[]` · `POST /api/decisions/:id/revert` → 201 `Decision` · `GET /api/memory/playbook` → `PlaybookEntry[]` · `GET /api/memory/playbook/history?topic=` → `PlaybookEntry[]` · `GET /api/memory/notes?q=` → `Array<{ note; snippet }>` · `GET /api/employees/:id/file` → `EmployeeFile`
  - `DELETE /api/employees/:id` → 202 `{ handover: Task }` (company present); `DELETE /api/employees/:id?now=1` → 204 (fire at once, open work back to the coordinator)

- [ ] **Step 1: Write the failing tests**

In `apps/office-server/test/company-api.test.ts`:
- replace the company construction inside `start()` with `const c = companyFor(s, f, ['coder', 'manager']);` and pass `company: { service: c.company, tasks: c.tasks, plans: c.plans, memory: c.memory }`; return `{ port, company: c.company, tasks: c.tasks, memory: c.memory }` (import `companyFor` from `./company-helpers.ts`; drop the now unused store imports);
- in the test "final review: firing someone mid-task…", call `DELETE /api/employees/${ada.id}?now=1`;
- append:

```ts
  it('firing first asks for a hand-over; ?now=1 fires at once', async () => {
    const t = await start();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const asked = await call(t.port, 'DELETE', `/api/employees/${ada.id}`);
    expect(asked.status).toBe(202);
    expect(asked.body.handover).toMatchObject({ kind: 'handover', assignee: ada.id });
    expect((await call(t.port, 'DELETE', `/api/employees/${ada.id}`)).body.handover.id).toBe(asked.body.handover.id);
    expect((await call(t.port, 'DELETE', `/api/employees/${ada.id}?now=1`)).status).toBe(204);
    expect(t.tasks.get(asked.body.handover.id).status).toBe('cancelled');
    expect((await call(t.port, 'GET', `/api/employees/${ada.id}/file`)).body).toMatchObject({ employee: { lifecycle: 'archived' }, finished: 0 });
    expect(c.kind).toBe('coordinator');
  });

  it('shows the memory to the owner and lets them revert a decision once', async () => {
    const t = await start();
    const c = t.company.hireCoordinator();
    const d = t.memory.recordDecision(c.id, { title: 'Ses aracı', chosen: 'ElevenLabs', reason: 'Türkçe' });
    t.memory.updatePlaybook(c.id, { topic: 'Test', text: 'birim' });
    t.memory.updatePlaybook(c.id, { topic: 'Test', text: 'birim + e2e' });
    t.memory.writeNote(c.id, { title: 'Seslendirme', text: 'ElevenLabs iyi' });
    expect((await call(t.port, 'GET', '/api/memory/decisions')).body.map((x: { id: string }) => x.id)).toEqual([d.id]);
    expect((await call(t.port, 'POST', `/api/decisions/${d.id}/revert`)).status).toBe(201);
    expect((await call(t.port, 'POST', `/api/decisions/${d.id}/revert`)).status).toBe(409);
    expect((await call(t.port, 'GET', '/api/memory/playbook')).body).toMatchObject([{ topic: 'Test', version: 2 }]);
    expect((await call(t.port, 'GET', `/api/memory/playbook/history?topic=${encodeURIComponent('test')}`)).body.map((p: { version: number }) => p.version)).toEqual([2, 1]);
    expect((await call(t.port, 'GET', `/api/memory/notes?q=${encodeURIComponent('elevenlabs')}`)).body[0].note.title).toBe('Seslendirme');
    expect((await call(t.port, 'GET', '/api/memory/notes')).body).toHaveLength(1);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/company-api.test.ts`
Expected: FAIL — 204 instead of 202; 404 on the memory routes.

- [ ] **Step 3: Routes**

In `apps/office-server/src/api.ts`:
- import `import type { Memory } from './company/memory.ts';`; `ApiDeps.company` becomes `company?: { service: Company; tasks: TaskStore; plans: PlanStore; memory: Memory };`
- next to `PLAN_ROUTE` add `const DECISION_ROUTE = /^\/api\/decisions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/revert$/;`
- add `file` to the actions of `EMPLOYEE_ROUTE`: `(?:\/(messages|side-questions|stop|resume|terminal|events|file))?$/`
- inside the `if (d.company) { … }` block, after the coordinator routes, add:

```ts
    const memory = d.company.memory;
    if (method === 'GET' && url.pathname === '/api/memory/decisions') return sendJson(res, 200, memory.decisions({ query: url.searchParams.get('q') ?? undefined, limit: 200 }));
    const revert = DECISION_ROUTE.exec(url.pathname);
    if (method === 'POST' && revert) return sendJson(res, 201, memory.revertDecision(revert[1] ?? ''));
    if (method === 'GET' && url.pathname === '/api/memory/playbook') return sendJson(res, 200, memory.playbookTopics());
    if (method === 'GET' && url.pathname === '/api/memory/playbook/history') return sendJson(res, 200, memory.playbookHistory(url.searchParams.get('topic') ?? ''));
    if (method === 'GET' && url.pathname === '/api/memory/notes') return sendJson(res, 200, memory.notes(url.searchParams.get('q') ?? undefined, 100));
```

- in the employee block, replace the `DELETE` branch with:

```ts
    if (method === 'DELETE' && action === undefined) {
      // The company asks for a hand-over first (spec §3.4); "?now=1" — or an office without the company — fires at once.
      if (d.company && url.searchParams.get('now') !== '1') return sendJson(res, 202, { handover: d.company.service.beginHandover(id) });
      await d.engine.fire(id);
      d.company?.service.releaseTasksOf(id);
      return sendEmpty(res, 204);
    }
    if (method === 'GET' && action === 'file' && d.company) return sendJson(res, 200, d.company.memory.employeeFile(id));
```

- [ ] **Step 4: Wiring**

In `apps/office-server/src/main.ts`:
- imports: `import { Memory } from './company/memory.ts';` and `import { DecisionStore, EmployeeNoteStore, NoteStore, PlaybookStore } from './company/memory-store.ts';`
- after `const notices = new NoticeStore(db);`:

```ts
const memory = new Memory({
  roster, events, notices, tasks, plans, dataDir: config.dataDir,
  decisions: new DecisionStore(db), playbook: new PlaybookStore(db), notes: new NoteStore(db), employeeNotes: new EmployeeNoteStore(db),
});
```

- pass `memory` to `new Company({ …, memory })`, to `officeTools({ company, roster, tasks, characters, memory })` and to the API deps: `company: { service: company, tasks, plans, memory }`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @cc/office-server exec vitest run test/company-api.test.ts && pnpm --filter @cc/office-server test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/office-server/src/api.ts apps/office-server/src/main.ts apps/office-server/test/company-api.test.ts
git commit -m "feat(memory): the owner sees the memory, reverts decisions, and firing asks for a hand-over

GET routes for decisions, playbook topics and history, notes (searchable) and
an employee's file; POST revert for a decision; DELETE an employee now starts
the hand-over and ?now=1 fires at once."
```

---

### Task 9: Web — memory data, client and feed lines

**Files:**
- Modify: `apps/office-web/src/net/api.ts`, `apps/office-web/src/store/reducers.ts`, `apps/office-web/src/ui/EventItem.tsx`, `apps/office-web/src/ui/format.ts`
- Test: `apps/office-web/src/store/reducers.test.ts`, `apps/office-web/src/ui/EventItem.test.tsx`

**Interfaces:**
- Produces: `api.decisions()`, `api.revertDecision(id)`, `api.playbook()`, `api.playbookHistory(topic)`, `api.notes(q?)`, `api.employeeFile(id)`, `api.fire(id, now?)` → `{ handover: Task } | null`; `OfficeData.memoryRev: number` (bumped by `decision.recorded`, `playbook.updated`, `note.written`); `formatWhen(ts): string`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/office-web/src/store/reducers.test.ts`:

```ts
describe('company memory', () => {
  it('counts memory changes so open tabs know to reload', () => {
    let d = applySnapshot(EMPTY_DATA, snapshot());
    expect(d.memoryRev).toBe(0);
    d = applyEvent(d, stored({ type: 'note.written', id: 1, title: 'n', tags: [] }));
    d = applyEvent(d, stored({ type: 'playbook.updated', topic: 'Test', version: 2, reason: '' }));
    expect(d.memoryRev).toBe(2);
    expect(applySnapshot(d, snapshot({ lastSeq: 99 })).memoryRev).toBe(2);
  });
});
```

Append to `apps/office-web/src/ui/EventItem.test.tsx` (inside the `describe`):

```ts
  it('notes decisions, reverts, playbook versions and knowledge notes in the feed', () => {
    const decision = { id: 'd1', ts: 0, by: 'c', title: 'Ses aracı', chosen: 'ElevenLabs', reason: 'r', alternatives: [], planId: null, reverts: null };
    const { rerender } = render(<EventItem stored={{ seq: 1, employeeId: 'c', ts: 0, event: { type: 'decision.recorded', decision } }} />);
    expect(screen.getByText('Karar: Ses aracı → ElevenLabs')).toBeTruthy();
    rerender(<EventItem stored={{ seq: 2, employeeId: 'c', ts: 0, event: { type: 'decision.recorded', decision: { ...decision, id: 'd2', title: 'Geri alındı: Ses aracı', reverts: 'd1' } } }} />);
    expect(screen.getByText('Sahibi bir kararı geri aldı: Ses aracı')).toBeTruthy();
    rerender(<EventItem stored={{ seq: 3, employeeId: 'c', ts: 0, event: { type: 'playbook.updated', topic: 'Test', version: 2, reason: '' } }} />);
    expect(screen.getByText('El kitabı: Test (sürüm 2)')).toBeTruthy();
    rerender(<EventItem stored={{ seq: 4, employeeId: 'c', ts: 0, event: { type: 'note.written', id: 3, title: 'Seslendirme', tags: [] } }} />);
    expect(screen.getByText('Not: Seslendirme')).toBeTruthy();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-web exec vitest run src/store/reducers.test.ts src/ui/EventItem.test.tsx`
Expected: FAIL — `memoryRev` undefined; no feed lines.

- [ ] **Step 3: Implement**

`apps/office-web/src/store/reducers.ts`:
- `OfficeData` gains `/** Bumped by every memory change, so open memory tabs reload. */ memoryRev: number;`
- `EMPTY_DATA` gets `memoryRev: 0`;
- `applySnapshot`'s returned object gets `memoryRev: d.memoryRev,`
- in `applyEvent`, next to the company lines: `if (ev.type === 'decision.recorded' || ev.type === 'playbook.updated' || ev.type === 'note.written') next.memoryRev = d.memoryRev + 1;`

`apps/office-web/src/ui/format.ts` — append:

```ts
/** "6 Eki 14:05": when a memory record was written. */
export function formatWhen(ts: number): string {
  return new Date(ts).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
```

`apps/office-web/src/ui/EventItem.tsx` — before `default:`:

```tsx
    case 'decision.recorded':
      return (
        <div className="note">
          {e.decision.reverts ? `Sahibi bir kararı geri aldı: ${e.decision.title.replace(/^Geri alındı: /, '')}` : `Karar: ${e.decision.title} → ${e.decision.chosen}`}
        </div>
      );
    case 'playbook.updated':
      return <div className="note">{`El kitabı: ${e.topic} (sürüm ${e.version})`}</div>;
    case 'note.written':
      return <div className="note">{`Not: ${e.title}`}</div>;
```

`apps/office-web/src/net/api.ts` — add `Decision`, `EmployeeFile`, `Note`, `PlaybookEntry`, `Task` to the type import; replace `fire` and add the memory calls:

```ts
  /** Without `now` the company first asks for a hand-over and answers with that task; `now` fires at once (null). */
  fire: (id: string, now = false) => request<{ handover: Task } | null>('DELETE', `${employee(id)}${now ? '?now=1' : ''}`),
  employeeFile: (id: string) => request<EmployeeFile>('GET', `${employee(id)}/file`),
  decisions: () => request<Decision[]>('GET', '/api/memory/decisions'),
  revertDecision: (id: string) => request<Decision>('POST', `/api/decisions/${encodeURIComponent(id)}/revert`),
  playbook: () => request<PlaybookEntry[]>('GET', '/api/memory/playbook'),
  playbookHistory: (topic: string) => request<PlaybookEntry[]>('GET', `/api/memory/playbook/history?topic=${encodeURIComponent(topic)}`),
  notes: (q = '') => request<Array<{ note: Note; snippet: string }>>('GET', `/api/memory/notes${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`),
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @cc/office-web exec vitest run && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/office-web/src
git commit -m "feat(office-web): memory in the client and the feed

API calls for decisions, reverts, playbook, notes and employee files; firing
returns the hand-over; decisions, playbook versions and notes show in the feed
and bump a counter open memory tabs reload on."
```

---

### Task 10: Web — memory tabs, the employee file and İşten çıkar

**Files:**
- Create: `apps/office-web/src/ui/MemoryTabs.tsx`, `apps/office-web/src/ui/FireControls.tsx`, `apps/office-web/src/ui/EmployeeFile.tsx`
- Modify: `apps/office-web/src/ui/CompanyView.tsx`, `apps/office-web/src/ui/Panel.tsx`, `apps/office-web/src/styles.css`
- Test: `apps/office-web/src/ui/MemoryTabs.test.tsx`, `apps/office-web/src/ui/FireControls.test.tsx`, `apps/office-web/src/ui/EmployeeFile.test.tsx`

**Interfaces:**
- Consumes: Task 9's client and `memoryRev`; store `tasks`, `views`, `plans`, `select`.
- Produces: `DecisionsTab()`, `PlaybookTab()`, `NotesTab()`; `FireControls({ employee })`; `EmployeeFileSection({ id })`.

- [ ] **Step 1: Write the failing tests**

Create `apps/office-web/src/ui/MemoryTabs.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Decision } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { DecisionsTab, NotesTab, PlaybookTab } from './MemoryTabs.tsx';

const decision = (over: Partial<Decision> = {}): Decision => ({ id: 'd1', ts: 1, by: 'c', title: 'Ses aracı', chosen: 'ElevenLabs', reason: 'Türkçe iyi', alternatives: ['Polly'], planId: null, reverts: null, ...over });

vi.mock('../net/api.ts', () => ({
  api: {
    decisions: vi.fn(async () => [decision({ id: 'd2', title: 'Kurgu', chosen: 'CapCut' }), decision()]),
    revertDecision: vi.fn(async () => ({})),
    playbook: vi.fn(async () => [
      { topic: 'Sürüm', version: 1, text: 'Etiketle ve yayınla.', by: 'c', reason: '', ts: 1 },
      { topic: 'Test', version: 3, text: 'Birim, sonra uçtan uca.', by: 'c', reason: 'e2e', ts: 2 },
    ]),
    playbookHistory: vi.fn(async () => [
      { topic: 'Sürüm', version: 1, text: 'Etiketle ve yayınla.', by: 'c', reason: '', ts: 1 },
    ]),
    notes: vi.fn(async (q: string) => (q ? [{ note: { id: 1, ts: 1, by: 'c', title: 'Seslendirme', text: 'uzun metin', tags: ['ses'], source: null }, snippet: '…ElevenLabs…' }] : [])),
  },
}));
const { api } = await import('../net/api.ts');

beforeEach(() => useOffice.setState({ memoryRev: 0, views: {}, plans: {} }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DecisionsTab', () => {
  it('lists decisions with their reason and alternatives, and lets the owner revert one', async () => {
    render(<DecisionsTab />);
    expect(await screen.findByText('Ses aracı')).toBeTruthy();
    expect(screen.getByText(/Türkçe iyi/)).toBeTruthy();
    expect(screen.getByText(/Polly/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Geri al' })[1]!);
    await waitFor(() => expect(api.revertDecision).toHaveBeenCalledWith('d1'));
  });

  it('marks a reverted decision and offers no second revert', async () => {
    vi.mocked(api.decisions).mockResolvedValueOnce([decision({ id: 'r1', by: 'owner', title: 'Geri alındı: Ses aracı', chosen: 'Geri alındı', reverts: 'd1' }), decision()]);
    render(<DecisionsTab />);
    expect(await screen.findByText('Geri alındı', { selector: '.badge' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Geri al' })).toBeNull();
  });

  it('reloads when the memory changes', async () => {
    render(<DecisionsTab />);
    await screen.findByText('Ses aracı');
    useOffice.setState({ memoryRev: 1 });
    await waitFor(() => expect(api.decisions).toHaveBeenCalledTimes(2));
  });
});

describe('PlaybookTab', () => {
  it('shows the first topic, switches topics, and shows older versions on demand', async () => {
    render(<PlaybookTab />);
    expect(await screen.findByText('Etiketle ve yayınla.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(screen.getByText('Birim, sonra uçtan uca.')).toBeTruthy();
    expect(screen.getByText(/sürüm 3/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sürüm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Önceki sürümler' }));
    await waitFor(() => expect(api.playbookHistory).toHaveBeenCalledWith('Sürüm'));
  });
});

describe('NotesTab', () => {
  it('searches the notes as the owner types', async () => {
    render(<NotesTab />);
    expect(await screen.findByText(/Henüz not yok/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Notlarda ara'), { target: { value: 'eleven' } });
    expect(await screen.findByText('Seslendirme')).toBeTruthy();
    expect(screen.getByText('…ElevenLabs…')).toBeTruthy();
    expect(api.notes).toHaveBeenLastCalledWith('eleven');
  });
});
```

Create `apps/office-web/src/ui/FireControls.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Employee, Task } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { FireControls } from './FireControls.tsx';

vi.mock('../net/api.ts', () => ({ api: { fire: vi.fn(async (_id: string, now?: boolean) => (now ? null : { handover: {} })), events: vi.fn(async () => []) } }));
const { api } = await import('../net/api.ts');

const ada: Employee = {
  id: 'ada', slug: 'ada', name: 'Ada', role: 'r', model: 'haiku', characterId: 'coder', title: '', team: '', kind: 'member', reportsTo: null, deskIndex: 0,
  sessionId: 's', sessionStarted: true, lifecycle: 'idle', limitResetsAt: null, lastError: null, createdAt: 1,
};
const handover = (status: Task['status']): Task => ({
  id: 'h1', kind: 'handover', planId: null, title: 'Devir', description: '', done: [], requester: 'owner', assignee: 'ada', priority: 1, dependsOn: [],
  status, chainDepth: 0, note: null, result: null, nudged: false, createdAt: 1, startedAt: null, finishedAt: null,
});

beforeEach(() => useOffice.setState({ tasks: {}, selectedId: 'ada' }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('FireControls', () => {
  it('asks whether to hand over first; the hand-over keeps the panel open', async () => {
    render(<FireControls employee={ada} />);
    fireEvent.click(screen.getByRole('button', { name: 'İşten çıkar' }));
    expect(screen.getByRole('dialog', { name: 'Ada işten çıkarılsın mı?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Devir yaptır, sonra çıkar' }));
    await waitFor(() => expect(api.fire).toHaveBeenCalledWith('ada', false));
    expect(useOffice.getState().selectedId).toBe('ada');
  });

  it('fires at once when asked, and closes the panel', async () => {
    render(<FireControls employee={ada} />);
    fireEvent.click(screen.getByRole('button', { name: 'İşten çıkar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hemen çıkar' }));
    await waitFor(() => expect(api.fire).toHaveBeenCalledWith('ada', true));
    await waitFor(() => expect(useOffice.getState().selectedId).toBeNull());
  });

  it('review focus: during a hand-over it says so and still offers to fire at once', async () => {
    useOffice.setState({ tasks: { h1: handover('in_progress') } });
    render(<FireControls employee={ada} />);
    expect(screen.getByRole('status').textContent).toMatch(/Devir yapıyor/);
    expect(screen.queryByRole('button', { name: 'İşten çıkar' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hemen çıkar' }));
    await waitFor(() => expect(api.fire).toHaveBeenCalledWith('ada', true));
  });

  it('a cancelled hand-over is no longer shown', () => {
    useOffice.setState({ tasks: { h1: handover('cancelled') } });
    render(<FireControls employee={ada} />);
    expect(screen.getByRole('button', { name: 'İşten çıkar' })).toBeTruthy();
  });
});
```

Create `apps/office-web/src/ui/EmployeeFile.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmployeeFileSection } from './EmployeeFile.tsx';

vi.mock('../net/api.ts', () => ({
  api: {
    employeeFile: vi.fn(async () => ({
      employee: {}, finished: 4, notes: [{ id: 1, ts: 1, employeeId: 'ada', by: 'c', text: 'Testte çok iyi.' }],
      recent: [{ id: 't1', title: 'Rapor', summary: 'Rapor hazır.', finishedAt: 2 }],
    })),
  },
}));
const { api } = await import('../net/api.ts');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('EmployeeFileSection', () => {
  it('loads the file only when opened', async () => {
    render(<EmployeeFileSection id="ada" />);
    expect(api.employeeFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Çalışan dosyası' }));
    expect(await screen.findByText('4 görev bitirdi.')).toBeTruthy();
    expect(screen.getByText(/Testte çok iyi/)).toBeTruthy();
    expect(screen.getByText(/Rapor hazır/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-web exec vitest run src/ui/MemoryTabs.test.tsx src/ui/FireControls.test.tsx src/ui/EmployeeFile.test.tsx`
Expected: FAIL — cannot resolve the components.

- [ ] **Step 3: Memory tabs**

Create `apps/office-web/src/ui/MemoryTabs.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { PlaybookEntry } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';
import { formatWhen } from './format.ts';

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Loads on mount and whenever `deps` change (the memory counter, a query). */
function useLoad<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    load().then(
      (value) => {
        if (!alive) return;
        setData(value);
        setError(null);
      },
      (err: unknown) => {
        if (alive) setError(message(err));
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error };
}

function useNameOf(): (id: string) => string {
  const views = useOffice((s) => s.views);
  return (id) => (id === 'owner' ? 'sahibi' : (views[id]?.employee.name ?? '—'));
}

export function DecisionsTab() {
  const rev = useOffice((s) => s.memoryRev);
  const plans = useOffice((s) => s.plans);
  const nameOf = useNameOf();
  const { data, error } = useLoad(() => api.decisions(), [rev]);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return <p className="muted">Yükleniyor…</p>;
  if (data.length === 0) return <p className="muted">Karar defteri boş. Koordinatör ve ekip liderleri önemli seçimleri buraya kaydeder.</p>;
  const reverted = new Set(data.map((d) => d.reverts).filter((x): x is string => x !== null));
  const revert = async (id: string) => {
    setBusy(id);
    setFailed(null);
    try {
      await api.revertDecision(id);
    } catch (err) {
      setFailed(message(err));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="memory-list">
      {failed && (
        <p className="error" role="alert">
          {failed}
        </p>
      )}
      {data.map((d) => (
        <article key={d.id} className={`memory-item${d.reverts ? ' revert' : ''}${reverted.has(d.id) ? ' reverted' : ''}`}>
          <header className="row">
            <strong>{d.title}</strong>
            <span className="muted">
              {nameOf(d.by)} · {formatWhen(d.ts)}
            </span>
          </header>
          {!d.reverts && (
            <>
              <p>
                <span className="muted">Seçilen:</span> {d.chosen}
              </p>
              <p>
                <span className="muted">Gerekçe:</span> {d.reason}
              </p>
              {d.alternatives.length > 0 && (
                <p>
                  <span className="muted">Alternatifler:</span> {d.alternatives.join(', ')}
                </p>
              )}
              {d.planId && plans[d.planId] && <p className="muted">Plan: {plans[d.planId]!.title}</p>}
            </>
          )}
          {reverted.has(d.id) ? (
            <span className="badge">Geri alındı</span>
          ) : (
            !d.reverts && (
              <div className="row end">
                <button type="button" disabled={busy === d.id} onClick={() => void revert(d.id)}>
                  Geri al
                </button>
              </div>
            )
          )}
        </article>
      ))}
    </div>
  );
}

function History({ topic }: { topic: string }) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<PlaybookEntry[] | null>(null);
  useEffect(() => {
    setOpen(false);
    setVersions(null);
  }, [topic]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void api.playbookHistory(topic).then((v) => alive && setVersions(v));
    return () => {
      alive = false;
    };
  }, [open, topic]);
  return (
    <div className="history">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        Önceki sürümler
      </button>
      {open &&
        (versions ? (
          versions.slice(1).map((v) => (
            <section key={v.version} className="history-version">
              <p className="muted">
                sürüm {v.version} · {formatWhen(v.ts)}
                {v.reason ? ` · ${v.reason}` : ''}
              </p>
              <div className="prose">{v.text}</div>
            </section>
          ))
        ) : (
          <p className="muted">Yükleniyor…</p>
        ))}
      {open && versions?.length === 1 && <p className="muted">Bu konunun tek sürümü var.</p>}
    </div>
  );
}

export function PlaybookTab() {
  const rev = useOffice((s) => s.memoryRev);
  const nameOf = useNameOf();
  const { data, error } = useLoad(() => api.playbook(), [rev]);
  const [topic, setTopic] = useState<string | null>(null);
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return <p className="muted">Yükleniyor…</p>;
  if (data.length === 0) return <p className="muted">El kitabı boş. Koordinatör ve ekip liderleri çalışma yöntemlerini buraya yazar.</p>;
  const current = data.find((p) => p.topic === topic) ?? data[0]!;
  return (
    <div className="playbook">
      <nav aria-label="Konular" className="playbook-topics">
        {data.map((p) => (
          <button key={p.topic} type="button" aria-pressed={p.topic === current.topic} onClick={() => setTopic(p.topic)}>
            {p.topic}
          </button>
        ))}
      </nav>
      <article className="playbook-text" aria-label={current.topic}>
        <h3>{current.topic}</h3>
        <p className="muted">
          sürüm {current.version} · {nameOf(current.by)} · {formatWhen(current.ts)}
          {current.reason ? ` · ${current.reason}` : ''}
        </p>
        <div className="prose">{current.text}</div>
        <History topic={current.topic} />
      </article>
    </div>
  );
}

export function NotesTab() {
  const rev = useOffice((s) => s.memoryRev);
  const nameOf = useNameOf();
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed.trim()), 250);
    return () => clearTimeout(timer);
  }, [typed]);
  const { data, error } = useLoad(() => api.notes(query), [rev, query]);
  return (
    <div className="notes">
      <input type="search" aria-label="Notlarda ara" placeholder="Notlarda ara…" value={typed} onChange={(e) => setTyped(e.target.value)} />
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : !data ? (
        <p className="muted">Yükleniyor…</p>
      ) : data.length === 0 ? (
        <p className="muted">{query ? 'Eşleşen not yok.' : 'Henüz not yok. Çalışanlar öğrendiklerini buraya yazar.'}</p>
      ) : (
        <div className="memory-list">
          {data.map(({ note, snippet }) => (
            <article key={note.id} className="memory-item">
              <header className="row">
                <strong>{note.title}</strong>
                <span className="muted">
                  {nameOf(note.by)} · {formatWhen(note.ts)}
                </span>
              </header>
              <p className="prose">{snippet || note.text}</p>
              {note.tags.length > 0 && (
                <p className="tags">
                  {note.tags.map((t) => (
                    <span key={t} className="badge">
                      {t}
                    </span>
                  ))}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
```

The history button is shown for every topic; a one-version topic answers "Bu konunun tek sürümü var.".

- [ ] **Step 4: İşten çıkar and the employee file**

Create `apps/office-web/src/ui/FireControls.tsx`:

```tsx
import { useState } from 'react';
import type { Employee } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';

/** "İşten çıkar": by default the employee first hands over what they know (spec §3.4); "Hemen çıkar" skips it. */
export function FireControls({ employee }: { employee: Employee }) {
  const select = useOffice((s) => s.select);
  const leaving = useOffice((s) =>
    Object.values(s.tasks).some((t) => t.kind === 'handover' && t.assignee === employee.id && (t.status === 'waiting' || t.status === 'in_progress' || t.status === 'blocked')),
  );
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (now: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const out = await api.fire(employee.id, now);
      setAsking(false);
      if (out === null) select(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const failure = error && (
    <p className="error" role="alert">
      {error}
    </p>
  );
  if (leaving) {
    return (
      <div className="leaving" role="status">
        <span>Devir yapıyor; teslim edince işten çıkarılacak.</span>
        <button type="button" className="danger" disabled={busy} onClick={() => void act(true)}>
          Hemen çıkar
        </button>
        {failure}
      </div>
    );
  }
  return (
    <>
      <button type="button" className="danger" disabled={busy} onClick={() => setAsking(true)}>
        İşten çıkar
      </button>
      {asking && (
        <div className="fire-ask" role="dialog" aria-label={`${employee.name} işten çıkarılsın mı?`}>
          <p>
            {employee.name} işten çıkarılsın mı? Önce bildiklerini şirkete devretmesi önerilir: öğrendiklerini notlara yazar, açık
            işleri koordinatöre döner.
          </p>
          <div className="row end">
            <button type="button" onClick={() => setAsking(false)}>
              Vazgeç
            </button>
            <button type="button" className="danger" disabled={busy} onClick={() => void act(true)}>
              Hemen çıkar
            </button>
            <button type="button" className="primary" disabled={busy} onClick={() => void act(false)}>
              Devir yaptır, sonra çıkar
            </button>
          </div>
        </div>
      )}
      {failure}
    </>
  );
}
```

Create `apps/office-web/src/ui/EmployeeFile.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { EmployeeFile } from '@cc/shared';
import { api } from '../net/api.ts';
import { formatWhen } from './format.ts';

/** What the company knows about this employee: the coordinator's notes and their recent work (loaded when opened). */
export function EmployeeFileSection({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<EmployeeFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    api.employeeFile(id).then(
      (f) => alive && setFile(f),
      (err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      alive = false;
    };
  }, [open, id]);
  return (
    <section className="employee-file">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        Çalışan dosyası
      </button>
      {open &&
        (error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : !file ? (
          <p className="muted">Yükleniyor…</p>
        ) : (
          <div className="employee-file-body">
            <p>{file.finished} görev bitirdi.</p>
            {file.notes.length > 0 ? (
              <ul>
                {file.notes.map((n) => (
                  <li key={n.id}>
                    {n.text} <span className="muted">· {formatWhen(n.ts)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Koordinatörün bu çalışan hakkında notu yok.</p>
            )}
            {file.recent.length > 0 && (
              <ul>
                {file.recent.map((r) => (
                  <li key={r.id}>
                    <strong>{r.title}</strong>: {r.summary}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
    </section>
  );
}
```

- [ ] **Step 5: Wire them in**

`apps/office-web/src/ui/Panel.tsx`:
- import `FireControls` and `EmployeeFileSection`;
- replace the whole `İşten çıkar` button (the `<button type="button" className="danger" …>İşten çıkar</button>` with its `window.confirm` handler) with `<FireControls employee={e} />`;
- after `{e.lastError && <p className="error">{e.lastError}</p>}` add `<EmployeeFileSection id={id} />`.

`apps/office-web/src/ui/CompanyView.tsx`:
- import `{ DecisionsTab, NotesTab, PlaybookTab }` from `./MemoryTabs.tsx`;
- above the component add:

```tsx
const TABS = [
  ['org', 'Örgüt'],
  ['tasks', 'Görevler'],
  ['decisions', 'Kararlar'],
  ['playbook', 'El kitabı'],
  ['notes', 'Notlar'],
] as const;
type Tab = (typeof TABS)[number][0];
```

- `const [tab, setTab] = useState<Tab>('org');`
- replace the two tab buttons with:

```tsx
            {TABS.map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
                {label}
              </button>
            ))}
```

- change the board branch's opening `) : (\n          <div className="board-wrap">` to `) : tab === 'tasks' ? (\n          <div className="board-wrap">`, and the closing `          </div>\n        )}\n      </section>` to:

```tsx
          </div>
        ) : tab === 'decisions' ? (
          <DecisionsTab />
        ) : tab === 'playbook' ? (
          <PlaybookTab />
        ) : (
          <NotesTab />
        )}
      </section>
```

Append to `apps/office-web/src/styles.css`:

```css
.tabs { flex-wrap: wrap; }
.memory-list { display: flex; flex-direction: column; gap: 8px; }
.memory-item { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); font-size: 14px; }
.memory-item p { margin: 0; overflow-wrap: anywhere; }
.memory-item.reverted { opacity: 0.6; }
.memory-item.revert { border-style: dashed; }
.prose { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.5; }
.playbook { display: grid; grid-template-columns: minmax(140px, 220px) 1fr; gap: 14px; }
.playbook-topics { display: flex; flex-direction: column; gap: 4px; }
.playbook-topics button { text-align: left; padding: 6px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-2); cursor: pointer; }
.playbook-topics button[aria-pressed='true'] { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.playbook-text h3 { margin: 0 0 4px; }
.history { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.history > button, .employee-file > button { align-self: flex-start; padding: 4px 10px; border: 1px solid var(--line); border-radius: 99px; background: var(--surface-2); cursor: pointer; font-size: 13px; }
.history-version { border-left: 3px solid var(--line); padding-left: 10px; }
.notes { display: flex; flex-direction: column; gap: 10px; }
.notes input[type='search'] { padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; font: inherit; }
.tags { display: flex; gap: 4px; flex-wrap: wrap; }
.fire-ask { flex-basis: 100%; display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: var(--radius); background: #fff1f0; font-size: 14px; }
.fire-ask p { margin: 0; }
.leaving { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px; border-radius: var(--radius); background: #fff7e0; font-size: 13px; }
.employee-file { display: flex; flex-direction: column; gap: 6px; margin: 6px 0; font-size: 13px; }
.employee-file ul { margin: 0; padding-left: 18px; }
@media (max-width: 760px) { .playbook { grid-template-columns: 1fr; } }
```

- [ ] **Step 6: Run the tests and the build**

Run: `pnpm --filter @cc/office-web exec vitest run && pnpm typecheck && pnpm --filter @cc/office-web build`
Expected: PASS; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/office-web/src
git commit -m "feat(office-web): the memory on screen, the employee file and a gentler İşten çıkar

The Company view gains Kararlar (with Geri al), El kitabı (topics, newest
version, older versions on demand) and Notlar (search as you type). The panel
shows the employee file on demand, and İşten çıkar asks whether to hand over
first; during a hand-over it says so and still offers to fire at once."
```

---

### Task 11: Real claude, README and spec

**Files:**
- Modify: `apps/office-server/test/company.smoke.real.test.ts`, `README.md`, `docs/superpowers/specs/2026-10-06-company-design.md`

- [ ] **Step 1: Extend the opt-in smoke test**

In `apps/office-server/test/company.smoke.real.test.ts`:
- the coordinator's first message gets one more sentence at its end: `Seçtiğin yaklaşımı decisionRecord ile karar defterine de kaydet.`
- after the `finished` wait, add:

```ts
      const handed = (finished.event as { task: { id: string; result: { archive?: string } | null } }).task;
      expect(handed.result?.archive, 'the hand-in was archived').toMatch(/^company\/archive\//);
      expect(existsSync(join(s.dataDir, handed.result!.archive!, 'teslim.md'))).toBe(true);
      await waitFor(s.events, (e) => e.event.type === 'decision.recorded', { timeoutMs: 300_000 });
      // The owner lets the writer go: a hand-over first, then the office fires them.
      company.beginHandover(writer!.id);
      await until(() => s.roster.get(writer!.id).lifecycle === 'archived', 600_000);
      const out = tasks.list({ assignee: writer!.id, statuses: ['done'] }).find((t) => t.kind === 'handover');
      expect(out?.result?.summary, 'the hand-over was handed in').toBeTruthy();
```

  (move the `const writer = …` line above this block; import `existsSync` from `node:fs`, `join` from `node:path`, and `until` from `./helpers.ts`.)

- [ ] **Step 2: Run it once with the real claude**

Run: `OFFICE_SMOKE=1 pnpm --filter @cc/office-server exec vitest run test/company.smoke.real.test.ts`
Expected: PASS (a few minutes, a few cents). Afterwards: `rm -rf ~/.claude/projects/-tmp-cc-test-*`.

If the coordinator does not record a decision, tighten the guide's coordinator line about `decisionRecord` (Task 3) and run again; ledger it.

- [ ] **Step 3: README**

After the "Şirket" section add:

```markdown
## Şirket hafızası

Şirket unutmaz; hepsi veri klasöründe (`~/.control-center/company/` ve veritabanı) durur:

- **Karar defteri:** koordinatör ve ekip liderleri önemli seçimleri (ne, neden, alternatifler) kaydeder. Şirket
  görünümünün **Kararlar** sekmesinden bir kararı **Geri al**abilirsiniz; koordinatöre haber gider.
- **El kitabı:** çalışma yöntemleri konu konu, sürüm sürüm (`company/playbook/<konu>.md`).
- **Notlar:** herkesin öğrendiği; tam metin aranır. Bir teslimdeki "öğrendiklerim" de nota dönüşür.
- **Arşiv:** her teslimin dosyaları ve bir `teslim.md` (`company/archive/<plan>/<tarih>-<görev>/`).
- **Çalışan dosyası:** koordinatörün her çalışan hakkındaki notları ve bitirdiği işler (panelde "Çalışan dosyası").

**İşten çıkar** önce bir devir görevi verir: çalışan bildiklerini yazar, teslim edince ofis onu çıkarır ve açık işleri
koordinatöre döner. Beklemek istemezseniz **Hemen çıkar**.
```

- [ ] **Step 4: Spec amendments**

In `docs/superpowers/specs/2026-10-06-company-design.md`:
- §3.2, after the role-card description, add: "Ofisin çalışma kuralları rol kartından `@office-guide.md` ile içe aktarılır; ofis bu dosyayı her oturum açılışında çalışanın türüne göre yeniden yazar."
- §3.4, end of the İşten çıkarma item: "Sahibi beklemek istemezse **Hemen çıkar** devri atlar; yarım kalan devir iptal edilir."
- §9, `employees` line: replace "`sleeping`, `token_hash` sütunları" with "`sleeping` sütunu (aşama 3); jetonlar oturum başına bellekte tutulur, DB'ye yazılmaz"; and add after the `tasks` line: "`tasks.kind` (`work` | `handover`)."

- [ ] **Step 5: Full verification and commit**

Run: `pnpm test && pnpm typecheck && pnpm --filter @cc/office-web build`
Expected: all green.

```bash
git add apps/office-server/test/company.smoke.real.test.ts README.md docs/superpowers/specs/2026-10-06-company-design.md
git commit -m "test(memory): the real claude records a decision, archives a hand-in and hands over

The opt-in smoke test also checks the archive and teslim.md, a recorded
decision, and a real hand-over ending in the writer leaving. README explains
the company memory; the spec records the office guide file and Hemen çıkar."
```
