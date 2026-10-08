import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONSTITUTION, type Employee, type StoredEvent } from '@cc/shared';
import { Dispatcher } from '../src/company/dispatcher.ts';
import { IntegrationRegistry } from '../src/company/integrations.ts';
import { CapabilityPrecheck, HOLD_NOTE } from '../src/company/precheck.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup, until } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

/**
 * Ada: Gmail and jeeta waiting for authorisation, Google Calendar open, Higgsfield denied by her desk. Can: Gmail open.
 * Efe: no session yet, and no capabilities declared. Ada and Can declare the outward ones their tasks need (review,
 * Kerem round 1: an outward capability the role lacks is held for the role, not the connector). By hand: a CLI that
 * reads payments. The switch on unless `off`.
 */
function make(o: { off?: boolean } = {}) {
  const s = setup();
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, ['coder']);
  if (!o.off) c.budget.setConstitution({ capabilityPrecheckEnabled: true });
  const integrations = new IntegrationRegistry({ db: s.db, roster: s.roster, events: s.events });
  const precheck = new CapabilityPrecheck({
    company: c.company, tasks: c.tasks, roster: s.roster, integrations, proposals: c.proposals, events: s.events, enabled: () => c.budget.constitution().capabilityPrecheckEnabled,
  });
  const coordinator = c.company.hireCoordinator();
  const ada = c.company.hire(coordinator.id, { name: 'Ada', role: 'r', capabilities: ['email.read', 'email.send', 'media.generate'] });
  const can = c.company.hire(coordinator.id, { name: 'Can', role: 'r', capabilities: ['email.read', 'email.send'] });
  const efe = c.company.hire(coordinator.id, { name: 'Efe', role: 'r' });
  const session = (who: Employee, mcp: Array<[string, string, number, string[]]>) =>
    s.events.append(who.id, { type: 'session.started', model: 'm', mcp: mcp.map(([name, status, tools, toolNames]) => ({ name, status, tools, toolNames })) });
  session(ada, [['office', 'connected', 1, ['myTasks']], ['claude.ai Gmail', 'needs-auth', 0, []], ['claude.ai jeeta', 'needs-auth', 0, []], ['claude.ai Google Calendar', 'connected', 2, ['list_events', 'get_event']], ['claude.ai Higgsfield', 'connected', 0, []]]);
  session(can, [['office', 'connected', 1, ['myTasks']], ['claude.ai Gmail', 'connected', 2, ['send_message', 'get_message']]]);
  integrations.register(coordinator.id, { name: 'iyzico-cli', kind: 'cli', capabilities: ['payments.read'] });
  const task = (who: Employee, title: string, requires: string[] = []) => c.company.createTask(coordinator.id, { assignee: who.id, title, requires } as never);
  // The store lists the newest first: by title here, so the order never depends on two proposals' timestamps.
  const needs = () => c.proposals.list({ limit: 100 }).filter((p) => p.kind === 'need').sort((a, b) => a.title.localeCompare(b.title, 'tr') || a.ts - b.ts);
  const need = (capability: string) => needs().find((p) => p.title.startsWith(`Yetki gerekiyor: ${capability} `))!;
  return { ...s, ...c, f, integrations, precheck, coordinator, ada, can, efe, session, task, needs, need };
}

describe('Capability precheck — holding a task before it is handed out', () => {
  it('a capability shut or missing on the assignee’s desk holds the task: blocked, a note, the coordinator told, one need to the owner', () => {
    const t = make();
    const send = t.task(t.ada, 'Müşteriye cevap', ['email.read', 'email.send']);
    expect(t.precheck.hold(t.tasks.get(send.id))).toBe(true);
    const held = t.tasks.get(send.id);
    expect(held.status).toBe('blocked');
    expect(held.note).toBe(`${HOLD_NOTE} Ada masasında açık değil: email.read [kapalı], email.send [kapalı]. Yetenek açılınca görev kendiliğinden sıraya döner.`);
    expect(t.notices.pending(t.coordinator.id).at(-1)?.text).toBe(`“Müşteriye cevap” görevi (Ada) bloklandı: ${held.note!.slice(HOLD_NOTE.length + 1)} Sahibine yetki önerisi açıldı.`);
    // One need per capability, to the owner (the coordinator's own proposal goes straight to them).
    expect(t.needs().map((p) => [p.title, p.status, p.by])).toEqual([
      ['Yetki gerekiyor: email.read (E-posta okuma)', 'owner', t.coordinator.id],
      ['Yetki gerekiyor: email.send (E-posta gönderme)', 'owner', t.coordinator.id],
    ]);
    const text = t.need('email.send').text;
    expect(text).toContain('“Müşteriye cevap” görevi (Ada) email.send (E-posta gönderme) istiyor; Ada masasında açık değil.');
    expect(text).toContain('• claude.ai Gmail: yetki bekliyor — claude.ai bağlayıcı ayarlarından yetkilendir. Başka masada açık: Can.');
    expect(text).toContain('• claude.ai jeeta: yetki bekliyor — claude.ai bağlayıcı ayarlarından yetkilendir.');
  });

  it('review focus: what does not hold — open, by hand, unseen (no session yet), and a task requiring nothing', () => {
    const t = make();
    for (const [who, title, requires] of [
      [t.ada, 'Takvim', ['calendar.read']],
      [t.ada, 'Ödemeler', ['payments.read']],
      [t.efe, 'Gelen kutusu', ['email.read']],
      [t.ada, 'Düz iş', []],
    ] as const) {
      const task = t.task(who, title, [...requires]);
      expect(t.precheck.hold(t.tasks.get(task.id)), title).toBe(false);
      expect(t.tasks.get(task.id)).toMatchObject({ status: 'waiting', note: null });
    }
    expect(t.needs()).toEqual([]);
  });

  it('review focus: missing everywhere, denied by the desk — both hold, and the need says what to do for each', () => {
    const t = make();
    const orders = t.task(t.ada, 'Siparişler', ['ecommerce.orders']);
    expect(t.precheck.hold(t.tasks.get(orders.id))).toBe(true);
    expect(t.need('ecommerce.orders').text).toContain('Bu yeteneği sağlayan bir bağlantı yok: bir bağlayıcı bağla ya da koordinatör integrationRegister ile kaydetsin.');
    const media = t.task(t.ada, 'Görsel', ['media.generate']);
    expect(t.precheck.hold(t.tasks.get(media.id))).toBe(true);
    expect(t.need('media.generate').text).toContain('• claude.ai Higgsfield: masa ayarı: oturumda aracı yok — Ada masasının .claude/settings.json dosyası bu sunucuyu kapatıyor; bilinçliyse görevi başka birine ver.');
  });

  it('review focus: one need per capability — not again while it waits or after the owner said no; again after a yes if still missing', () => {
    const t = make();
    const first = t.task(t.ada, 'Bir', ['email.send']);
    t.precheck.hold(t.tasks.get(first.id));
    const second = t.task(t.ada, 'İki', ['email.send']);
    expect(t.precheck.hold(t.tasks.get(second.id))).toBe(true);
    expect(t.needs()).toHaveLength(1);
    t.company.ownerDecideProposal(t.need('email.send').id, false, 'Gmail yetkisi vermeyeceğim.');
    t.precheck.hold(t.tasks.get(t.task(t.ada, 'Üç', ['email.send']).id));
    expect(t.needs()).toHaveLength(1);
    // A different capability is its own question.
    t.precheck.hold(t.tasks.get(t.task(t.ada, 'Dört', ['email.read']).id));
    expect(t.needs().map((p) => p.title)).toEqual(['Yetki gerekiyor: email.read (E-posta okuma)', 'Yetki gerekiyor: email.send (E-posta gönderme)']);
    t.company.ownerDecideProposal(t.need('email.read').id, true, 'Tamam, bağlarım.');
    t.precheck.hold(t.tasks.get(t.task(t.ada, 'Beş', ['email.read']).id));
    expect(t.needs().filter((p) => p.title.startsWith('Yetki gerekiyor: email.read '))).toHaveLength(2);
  });

  it('a held task goes back to the queue once its capabilities are there; switching off sends every held one back', () => {
    const t = make();
    const send = t.task(t.ada, 'Gönder', ['email.send']);
    const orders = t.task(t.ada, 'Siparişler', ['ecommerce.orders']);
    t.precheck.hold(t.tasks.get(send.id));
    t.precheck.hold(t.tasks.get(orders.id));
    // Still missing: stays held.
    t.precheck.release();
    expect(t.tasks.get(send.id).status).toBe('blocked');
    // Ada's next session has Gmail with its tools.
    t.session(t.ada, [['office', 'connected', 1, ['myTasks']], ['claude.ai Gmail', 'connected', 2, ['send_message', 'get_message']]]);
    t.precheck.release();
    expect(t.tasks.get(send.id)).toMatchObject({ status: 'waiting', note: null });
    expect(t.tasks.get(orders.id).status).toBe('blocked');
    // A block someone else set is not the precheck's to lift.
    const own = t.task(t.ada, 'Kendi takıldığı');
    t.tasks.update(own.id, { status: 'blocked', note: 'Test ortamına erişimim yok.' });
    t.budget.setConstitution({ capabilityPrecheckEnabled: false });
    t.precheck.release();
    expect(t.tasks.get(orders.id)).toMatchObject({ status: 'waiting', note: null });
    expect(t.tasks.get(own.id)).toMatchObject({ status: 'blocked', note: 'Test ortamına erişimim yok.' });
  });
});

describe('Capability precheck — an outward capability the role does not declare (review, Kerem round 1; B9b)', () => {
  /** Efe's session as B9b leaves it: the outward Gmail tools his role lacks are out, the reading one stays. */
  const asB9bLeavesIt = (t: ReturnType<typeof make>, toolNames: string[]) =>
    t.session(t.efe, [['office', 'connected', 1, ['myTasks']], ['claude.ai Gmail', 'connected', toolNames.length, toolNames]]);

  it('review focus: held for the role — the coordinator is told to add it with editRoleCard or give the task to someone who has it; no need to the owner', () => {
    const t = make();
    asB9bLeavesIt(t, ['get_message']);
    const send = t.task(t.efe, 'Müşteriye yaz', ['email.send']);
    expect(t.precheck.hold(t.tasks.get(send.id))).toBe(true);
    expect(t.tasks.get(send.id)).toMatchObject({ status: 'blocked', note: `${HOLD_NOTE} Efe için rolde yok: email.send (dışa dönük; rolün yeteneklerinde değil). Yetenek rolüne eklenince görev kendiliğinden sıraya döner.` });
    expect(t.notices.pending(t.coordinator.id).at(-1)?.text).toBe('“Müşteriye yaz” görevi (Efe) bloklandı: email.send, Efe adlı çalışanın rolünde yok (dışa dönük yetenek). editRoleCard ile rolüne ekle ya da görevi bu yeteneği olana ver (taskAssign).');
    expect(t.needs()).toEqual([]);
    // While the role lacks it, a sweep keeps the task held.
    t.precheck.release();
    expect(t.tasks.get(send.id).status).toBe('blocked');
    // The coordinator adds it to Efe's role: the next sweep lets the task go.
    t.company.editRoleCard(t.coordinator.id, t.efe.id, { capabilities: ['email.send'] } as never);
    t.precheck.release();
    expect(t.tasks.get(send.id)).toMatchObject({ status: 'waiting', note: null });
  });

  it('review focus: the role’s reason comes first — B9b closing every tool of a server reads as the role, not as the desk’s settings file', () => {
    const t = make();
    asB9bLeavesIt(t, []);
    const send = t.task(t.efe, 'Gönder', ['email.send']);
    expect(t.precheck.hold(t.tasks.get(send.id))).toBe(true);
    expect(t.tasks.get(send.id).note).toContain('Efe için rolde yok: email.send');
    expect(t.notices.pending(t.coordinator.id).at(-1)?.text).not.toContain('settings.json');
    expect(t.needs()).toEqual([]);
  });

  it('review focus: what the role rule leaves alone — a capability that is not outward, or one the role declares', () => {
    const t = make();
    asB9bLeavesIt(t, ['get_message']);
    // Reading is not outward: B9b keeps its tool, the role need not declare it.
    expect(t.precheck.hold(t.tasks.get(t.task(t.efe, 'Oku', ['email.read']).id))).toBe(false);
    // Can declares email.send and has Gmail with its tools.
    expect(t.precheck.hold(t.tasks.get(t.task(t.can, 'Gönder', ['email.send']).id))).toBe(false);
  });

  it('both reasons at once: the role for one capability, the connector for another — one note, the owner asked only for the connector', () => {
    const t = make();
    // Ada declares email.send but not calendar.write (outward); her Gmail waits for authorisation.
    const both = t.task(t.ada, 'Davet ve e-posta', ['email.send', 'calendar.write']);
    expect(t.precheck.hold(t.tasks.get(both.id))).toBe(true);
    expect(t.tasks.get(both.id).note).toBe(`${HOLD_NOTE} Ada için rolde yok: calendar.write (dışa dönük; rolün yeteneklerinde değil). Ada masasında açık değil: email.send [kapalı]. Yetenek açılınca ya da rolüne eklenince görev kendiliğinden sıraya döner.`);
    expect(t.needs().map((p) => p.title)).toEqual(['Yetki gerekiyor: email.send (E-posta gönderme)']);
  });
});

describe('Capability precheck — a connector tool’s error', () => {
  const toolRun = (t: ReturnType<typeof make>, who: Employee, id: string, name: string, isError: boolean, output = 'Error: unauthorized') => {
    t.events.append(who.id, { type: 'tool.started', toolUseId: id, name, input: {} });
    t.events.append(who.id, { type: 'tool.finished', toolUseId: id, isError, output });
  };
  const settle = () => new Promise((r) => setTimeout(r, 30));

  it('review focus: a classified tool’s error opens the need for its capability, once; others open nothing', async () => {
    const t = make();
    toolRun(t, t.can, 'u1', 'mcp__claude_ai_Gmail__send_message', true, 'Error: token expired, reconnect Gmail');
    await until(() => t.needs().length === 1);
    expect(t.needs()[0]).toMatchObject({ title: 'Yetki gerekiyor: email.send (E-posta gönderme)', status: 'owner' });
    expect(t.needs()[0]!.text).toContain('Can masasında send_message aracı hata verdi: “Error: token expired, reconnect Gmail”.');
    toolRun(t, t.can, 'u2', 'mcp__claude_ai_Gmail__reply', true);
    toolRun(t, t.can, 'u3', 'mcp__claude_ai_Gmail__get_message', false);
    toolRun(t, t.can, 'u4', 'mcp__claude_ai_jeeta__jeeta_list_team', true);
    toolRun(t, t.can, 'u5', 'mcp__office__myTasks', true);
    toolRun(t, t.can, 'u6', 'Bash', true);
    await settle();
    expect(t.needs()).toHaveLength(1);
  });
});

describe('Capability precheck — a tool error the capability survives (K4: the live copy\'s one connector error)', () => {
  const toolRun = (t: ReturnType<typeof make>, who: Employee, id: string, name: string, output: string) => {
    t.events.append(who.id, { type: 'tool.started', toolUseId: id, name, input: {} });
    t.events.append(who.id, { type: 'tool.finished', toolUseId: id, isError: true, output });
  };

  it('review focus: no need when the desk still has the capability through something else — built-in tools, or another open connector', async () => {
    const t = make();
    // The live office's case: a browser tool failed (the page closed); web.fetch is still there through WebFetch.
    t.session(t.can, [['office', 'connected', 1, ['myTasks']], ['plugin:playwright:playwright', 'connected', 1, ['browser_navigate']], ['claude.ai Gmail', 'connected', 1, ['send_message']], ['claude.ai jeeta', 'connected', 1, ['jeeta_send_email']]]);
    toolRun(t, t.can, 'p1', 'mcp__plugin_playwright_playwright__browser_navigate', 'Error: Target page, context or browser has been closed');
    // Gmail's send failed, but jeeta also sends e-mail on this desk.
    toolRun(t, t.can, 'g1', 'mcp__claude_ai_Gmail__send_message', 'Error: token expired');
    await new Promise((r) => setTimeout(r, 30));
    expect(t.needs()).toEqual([]);
    // Without jeeta, Gmail is the only way: the need is raised.
    t.session(t.can, [['office', 'connected', 1, ['myTasks']], ['claude.ai Gmail', 'connected', 1, ['send_message']]]);
    toolRun(t, t.can, 'g2', 'mcp__claude_ai_Gmail__send_message', 'Error: token expired');
    await until(() => t.needs().length === 1);
    expect(t.need('email.send').text).toContain('Can masasında send_message aracı hata verdi');
  });
});

describe('Capability precheck — the dispatcher, and the switch', () => {
  const systemMessages = (events: StoredEvent[], id: string) =>
    events.filter((e) => e.employeeId === id && e.event.type === 'message.user' && e.event.source === 'system').map((e) => (e.event as { text: string }).text);

  function dispatching(o: { off?: boolean } = {}) {
    const t = make(o);
    const dispatcher = new Dispatcher({ events: t.events, roster: t.roster, tasks: t.tasks, notices: t.notices, plans: t.plans, company: t.company, engine: t.f.engine, budget: t.budget, precheck: t.precheck });
    cleanups.unshift(dispatcher.start());
    return t;
  }

  it('review focus: a held task is not handed out; the next one is', async () => {
    const t = dispatching();
    const send = t.task(t.ada, 'Gönder', ['email.send']);
    const plain = t.task(t.ada, 'Düz iş');
    await until(() => t.tasks.get(plain.id).status === 'in_progress', 8000);
    expect(t.tasks.get(send.id).status).toBe('blocked');
    const messages = systemMessages(t.events.list({ limit: 5000 }), t.ada.id);
    expect(messages.some((m) => m.includes('## Görev: Düz iş'))).toBe(true);
    expect(messages.some((m) => m.includes('## Görev: Gönder'))).toBe(false);
  });

  it('review focus: the dispatcher’s sweep lets a task held for the role go once editRoleCard adds the capability', async () => {
    const t = make();
    const dispatcher = new Dispatcher({ events: t.events, roster: t.roster, tasks: t.tasks, notices: t.notices, plans: t.plans, company: t.company, engine: t.f.engine, budget: t.budget, precheck: t.precheck, tickMs: 50 });
    cleanups.unshift(dispatcher.start());
    t.session(t.efe, [['office', 'connected', 1, ['myTasks']], ['claude.ai Gmail', 'connected', 1, ['get_message']]]);
    const send = t.task(t.efe, 'Gönder', ['email.send']);
    await until(() => t.tasks.get(send.id).status === 'blocked', 8000);
    t.company.editRoleCard(t.coordinator.id, t.efe.id, { capabilities: ['email.send'] } as never);
    await until(() => systemMessages(t.events.list({ limit: 5000 }), t.efe.id).some((m) => m.includes('## Görev: Gönder')), 8000);
    expect(t.tasks.get(send.id)).toMatchObject({ status: 'in_progress', note: null });
  });

  it('review focus: the dispatcher’s own sweep lets a held task go once the capability is there, and hands it out (mutation D2)', async () => {
    const t = make();
    const dispatcher = new Dispatcher({ events: t.events, roster: t.roster, tasks: t.tasks, notices: t.notices, plans: t.plans, company: t.company, engine: t.f.engine, budget: t.budget, precheck: t.precheck, tickMs: 50 });
    cleanups.unshift(dispatcher.start());
    const send = t.task(t.ada, 'Gönder', ['email.send']);
    await until(() => t.tasks.get(send.id).status === 'blocked', 8000);
    // Ada's next session has Gmail with its tools; nobody calls release() — the dispatcher's tick does.
    t.session(t.ada, [['office', 'connected', 1, ['myTasks']], ['claude.ai Gmail', 'connected', 2, ['send_message', 'get_message']]]);
    await until(() => systemMessages(t.events.list({ limit: 5000 }), t.ada.id).some((m) => m.includes('## Görev: Gönder')), 8000);
    expect(t.tasks.get(send.id)).toMatchObject({ status: 'in_progress', note: null });
  });

  it('review focus: a precheck that says “held” but leaves the task waiting never spins the dispatcher (mutation P23)', async () => {
    const t = make();
    const stuck = { hold: () => true, release() {} };
    const dispatcher = new Dispatcher({ events: t.events, roster: t.roster, tasks: t.tasks, notices: t.notices, plans: t.plans, company: t.company, engine: t.f.engine, budget: t.budget, precheck: stuck });
    cleanups.unshift(dispatcher.start());
    const task = t.task(t.ada, 'Takılmasın');
    await new Promise((r) => setTimeout(r, 300));
    // The office still answers (the loop ended), and the task the precheck claimed to hold was not handed out.
    expect(t.tasks.get(task.id).status).toBe('waiting');
    expect(systemMessages(t.events.list({ limit: 5000 }), t.ada.id).some((m) => m.includes('## Görev: Takılmasın'))).toBe(false);
  });

  it('review focus: switched off, nothing changes — the task goes out, no need, the precheck writes no event', async () => {
    const t = dispatching({ off: true });
    expect(DEFAULT_CONSTITUTION.capabilityPrecheckEnabled).toBe(false);
    expect(t.budget.constitution().capabilityPrecheckEnabled).toBe(false);
    expect(t.precheck.hold(t.tasks.get(t.task(t.ada, 'Doğrudan', ['email.send']).id))).toBe(false);
    const send = t.task(t.ada, 'Gönder', ['email.send']);
    await until(() => systemMessages(t.events.list({ limit: 5000 }), t.ada.id).some((m) => m.includes('## Görev: Doğrudan')), 8000);
    const before = t.events.list({ limit: 100_000 }).filter((e) => e.event.type === 'proposal.changed').length;
    t.events.append(t.can.id, { type: 'tool.started', toolUseId: 'x', name: 'mcp__claude_ai_Gmail__send_message', input: {} });
    t.events.append(t.can.id, { type: 'tool.finished', toolUseId: 'x', isError: true, output: 'Error' });
    await new Promise((r) => setTimeout(r, 30));
    expect(t.needs()).toEqual([]);
    expect(t.events.list({ limit: 100_000 }).filter((e) => e.event.type === 'proposal.changed').length).toBe(before);
    expect(t.tasks.get(send.id).status).not.toBe('blocked');
  });

  it('the switch is the constitution’s fourth: true or false only', () => {
    const t = make({ off: true });
    t.budget.setConstitution({ capabilityPrecheckEnabled: true });
    expect(t.budget.constitution().capabilityPrecheckEnabled).toBe(true);
    expect(() => t.budget.setConstitution({ capabilityPrecheckEnabled: 'yes' } as never)).toThrow(/Yetenek ön-kontrolü anahtarı açık ya da kapalı/);
  });
});
