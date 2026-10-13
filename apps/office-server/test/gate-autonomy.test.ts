import { afterEach, describe, expect, it } from 'vitest';
import { OWNER, type Approval, type Employee, type OutboxEntry } from '@cc/shared';
import { ApprovalStore } from '../src/company/approval-store.ts';
import { Approvals } from '../src/company/approvals.ts';
import { Gate } from '../src/company/gate.ts';
import { OutboxStore } from '../src/company/outbox-store.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { DATA, testContext } from './gate-helpers.ts';
import { setup } from './helpers.ts';

/** Spec capabilities §5–§7: the gate's system path, its rules and the outbox. */

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const HOUR = 3_600_000;
const GMAIL = 'mcp__claude_ai_Gmail__send_message';

function make() {
  // Tuesday 13 October 2026, 11:00 local: inside the call hours.
  let now = new Date(2026, 9, 13, 11, 0).getTime();
  const clock = () => now;
  const s = setup(8, clock);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, ['coder'], clock, undefined, { departments: true });
  c.budget.setConstitution({ gateEnabled: true });
  const approvals = new Approvals({ store: new ApprovalStore(s.db, clock), events: s.events, notices: c.notices, roster: s.roster, tasks: c.tasks, coordinator: () => c.company.coordinator(), memory: c.memory, now: clock, defer: (fn) => fn() });
  const outbox = new OutboxStore(s.db, clock);
  const gate = new Gate({
    approvals, events: s.events, roster: s.roster, enabled: () => c.budget.constitution().gateEnabled,
    context: (e) => testContext({ deskDir: `${DATA}/desks/${e.slug}` }),
    autonomy: { constitution: () => c.budget.constitution(), outbox, now: clock },
  });
  const coordinator = c.company.hireCoordinator();
  const sales = c.departments!.create(OWNER, { name: 'Satış', mission: 'm' });
  const marketing = c.departments!.create(OWNER, { name: 'Pazarlama', mission: 'm' });
  const hire = (name: string, departmentId?: string) => c.company.hire(OWNER, { name, role: 'r', ...(departmentId ? { departmentId } : {}) });
  const ask = (who: Employee, tool_name: string, tool_input: unknown) => gate.check(who.id, { tool_name, tool_input, cwd: `${DATA}/desks/${who.slug}` });
  const mail = (who: Employee, to: string | string[] = 'musteri@x.co') => ask(who, GMAIL, { to, subject: 'Siparişiniz', body: 'Kargoya verildi.' });
  const ev = (type: string) => s.events.list({ limit: 5000 }).filter((e) => e.event.type === type);
  return { ...s, ...c, approvals, outbox, gate, coordinator, sales, marketing, hire, ask, mail, ev, advance: (ms: number) => void (now += ms) };
}

describe('the gate lets the system send (spec capabilities §5–§7)', () => {
  it('the owner’s default policy: a connector’s send passes without the owner, written as the system’s with outbox.sent — no approval, no gate.checked; a publish and a call too; a read is written nowhere', async () => {
    const t = make();
    const selin = t.hire('Selin', t.sales.id);
    expect(await t.mail(selin, ['a@x.co', 'b@x.co'])).toMatchObject({ decision: 'allow', reason: 'sistemce (otonomi politikası)', kind: 'send', target: 'send_message to=a@x.co,b@x.co' });
    const [entry] = t.outbox.list() as [OutboxEntry];
    expect(entry).toMatchObject({ employeeId: selin.id, departmentId: t.sales.id, tool: GMAIL, kind: 'send', target: 'send_message to=a@x.co,b@x.co', recipients: ['a@x.co', 'b@x.co'], via: 'system', approvalId: null });
    expect(entry.summary).toContain('Kargoya verildi.');
    expect(t.ev('outbox.sent')).toEqual([expect.objectContaining({ employeeId: selin.id, event: { type: 'outbox.sent', entry } })]);
    expect([t.ev('gate.checked'), t.ev('approval.changed')]).toEqual([[], []]);
    expect((await t.ask(selin, 'mcp__claude_ai_jeeta__jeeta_publish_social_post', { post_id: 'p1' })).decision).toBe('allow');
    expect((await t.ask(selin, 'mcp__claude_ai_jeeta__jeeta_click_to_dial', { phone: '+905321112233' })).decision).toBe('allow');
    expect((await t.ask(selin, 'mcp__claude_ai_Gmail__get_message', { id: 'm1' })).decision).toBe('allow');
    expect(t.outbox.list().map((e) => e.kind)).toEqual(['call', 'publish', 'send']);
  });

  it('a calendar invitation waits for the owner by default; left to the system, it passes', async () => {
    const t = make();
    const ada = t.hire('Ada');
    const invite = () => t.ask(ada, 'mcp__claude_ai_Google_Calendar__create_event', { summary: 'Tanışma', attendees: ['a@x.co'] });
    const held = await invite();
    expect(held).toMatchObject({ decision: 'deny', kind: 'calendar' });
    expect(held.reason).toMatch(/OFİS KAPISI: takvim — “create_event summary=Tanışma” onaysız yapılamaz \(takvime yazar, katılımcılara davet gider \(calendar\.write\)\)/);
    t.budget.setConstitution({ outwardPolicy: { calendar: 'system' } });
    expect(await invite()).toMatchObject({ decision: 'allow', kind: 'calendar' });
    expect(t.outbox.list()).toEqual([expect.objectContaining({ kind: 'calendar', via: 'system', departmentId: null })]);
  });

  it('review focus 4: a Bash curl POST, a mail command, a git push or a SendMessage is never the system’s, whatever the policy', async () => {
    const t = make();
    const ada = t.hire('Ada');
    const curl = await t.ask(ada, 'Bash', { command: 'curl -X POST https://api.mail.io/send -d to=a@x.co' });
    expect(curl).toMatchObject({ decision: 'deny', kind: 'send' });
    expect(curl.reason).toMatch(/^OFİS KAPISI: gönderim/);
    expect((await t.ask(ada, 'Bash', { command: 'mail a@x.co' })).decision).toBe('deny');
    expect((await t.ask(ada, 'Bash', { command: 'git push origin main' })).decision).toBe('deny');
    expect((await t.ask(ada, 'SendMessage', { to: 'x', message: 'y' })).decision).toBe('deny');
    expect([t.outbox.list(), t.ev('outbox.sent')]).toEqual([[], []]);
  });

  it('pay, delete, the browser and unclassified tools are always the owner’s; a send the owner kept for themselves too', async () => {
    const t = make();
    const ada = t.hire('Ada');
    for (const [tool, kind] of [['mcp__claude_ai_jeeta__jeeta_reallocate_budget', 'pay'], ['mcp__claude_ai_Gmail__trash_message', 'delete'], ['mcp__plugin_playwright_playwright__browser_click', 'browser'], ['mcp__netgsm__send_sms', 'other']] as const) {
      expect(await t.ask(ada, tool, { id: 'x' }), tool).toMatchObject({ decision: 'deny', kind });
    }
    t.budget.setConstitution({ outwardPolicy: { send: 'owner' } });
    expect(await t.mail(ada)).toMatchObject({ decision: 'deny', kind: 'send' });
    expect(t.outbox.list()).toEqual([]);
  });

  it('review focus 1 at the gate: a mail to six is held with the rule; the owner approves it: it passes, written as the owner’s and counted nowhere', async () => {
    const t = make();
    t.budget.setConstitution({ sendsPerHour: 1 });
    const selin = t.hire('Selin', t.sales.id);
    const six = Array.from({ length: 6 }, (_, i) => `k${i}@x.co`);
    const held = await t.mail(selin, six);
    expect(held).toMatchObject({ decision: 'deny', kind: 'send' });
    expect(held.reason).toMatch(/onaysız yapılamaz \(toplu gönderim: 6 alıcı > 5\)\. Sistem bu çağrıyı kuralı yüzünden kendi geçirmedi\./);
    expect(t.ev('gate.checked')).toHaveLength(1);
    const a = t.approvals.request(selin.id, { kind: 'send', tool: GMAIL, target: held.target, summary: 'Kampanya duyurusu' });
    t.approvals.decide(a.id, true, { via: 'page' });
    expect(await t.mail(selin, six)).toMatchObject({ decision: 'allow', approvalId: a.id });
    expect(t.outbox.list()).toEqual([expect.objectContaining({ via: 'owner', approvalId: a.id, recipients: six })]);
    // Not counted: the hour's one system send is still free.
    expect((await t.mail(selin)).decision).toBe('allow');
    expect((await t.mail(selin)).reason).toMatch(/saatlik gönderim sınırı \(1\) doldu/);
  });

  it('review focus 5: the hourly cap is each department’s own; someone without a department counts alone; the hour moves on', async () => {
    const t = make();
    t.budget.setConstitution({ sendsPerHour: 2 });
    const [selin, sena, pelin, ada, can] = [t.hire('Selin', t.sales.id), t.hire('Sena', t.sales.id), t.hire('Pelin', t.marketing.id), t.hire('Ada'), t.hire('Can')];
    expect((await t.mail(selin)).decision).toBe('allow');
    expect((await t.mail(sena)).decision).toBe('allow');
    const third = await t.mail(selin);
    expect(third).toMatchObject({ decision: 'deny', kind: 'send' });
    expect(third.reason).toMatch(/saatlik gönderim sınırı \(2\) doldu/);
    // Satış's cap is not Pazarlama's, nor the centre's.
    expect((await t.mail(pelin)).decision).toBe('allow');
    expect((await t.mail(ada)).decision).toBe('allow');
    expect((await t.mail(ada)).decision).toBe('allow');
    expect((await t.mail(ada)).decision).toBe('deny');
    expect((await t.mail(can)).decision).toBe('allow');
    t.advance(HOUR + 1);
    expect((await t.mail(sena)).decision).toBe('allow');
  });

  it('calls: the day’s cap per department; outside the call hours held with the time', async () => {
    const t = make();
    t.budget.setConstitution({ callsPerDay: 1 });
    const selin = t.hire('Selin', t.sales.id);
    const dial = () => t.ask(selin, 'mcp__claude_ai_jeeta__jeeta_click_to_dial', { phone: '+905321112233' });
    expect((await dial()).decision).toBe('allow');
    expect((await dial()).reason).toMatch(/günlük arama sınırı \(1\) doldu/);
    t.advance(10 * HOUR + 40 * 60_000);
    expect((await dial()).reason).toMatch(/mesai dışı arama \(21:40\)/);
  });

  it('review focus 2 at the gate: a special contact goes to the owner, however it is written', async () => {
    const t = make();
    t.budget.setConstitution({ specialContacts: ['Ali@Firma.com', '+90 (532) 111 22 33'] });
    const ada = t.hire('Ada');
    expect((await t.mail(ada, 'ALI@firma.com')).reason).toMatch(/özel kişi: Ali@Firma\.com/);
    expect((await t.ask(ada, 'mcp__claude_ai_jeeta__jeeta_click_to_dial', { phone: '0532 111 22 33' })).reason).toMatch(/özel kişi: \+90 \(532\) 111 22 33/);
    expect(t.outbox.list()).toEqual([]);
  });

  it('an outward call the owner approved is an outbox line whatever its tool (a git push is a publish); a payment is not', async () => {
    const t = make();
    const ada = t.hire('Ada');
    const push = { command: 'git push origin main' };
    const held = await t.ask(ada, 'Bash', push);
    const a = t.approvals.request(ada.id, { kind: 'publish', tool: 'Bash', target: held.target, summary: 'Sürüm' });
    t.approvals.decide(a.id, true, { via: 'page' });
    expect((await t.ask(ada, 'Bash', push)).decision).toBe('allow');
    const budget = { campaign_id: 'c1' };
    const heldPay = await t.ask(ada, 'mcp__claude_ai_jeeta__jeeta_reallocate_budget', budget);
    const b = t.approvals.request(ada.id, { kind: 'pay', tool: 'mcp__claude_ai_jeeta__jeeta_reallocate_budget', target: heldPay.target, summary: 'Bütçe' });
    t.approvals.decide(b.id, true, { via: 'page' });
    expect((await t.ask(ada, 'mcp__claude_ai_jeeta__jeeta_reallocate_budget', budget)).decision).toBe('allow');
    expect(t.outbox.list()).toEqual([expect.objectContaining({ tool: 'Bash', kind: 'publish', target: 'git push origin', via: 'owner', approvalId: a.id, recipients: [] })]);
  });

  it('the gate off: everything passes and nothing is written — the policy needs the gate on', async () => {
    const t = make();
    t.budget.setConstitution({ gateEnabled: false });
    const ada = t.hire('Ada');
    expect((await t.mail(ada)).decision).toBe('allow');
    expect((await t.ask(ada, 'Bash', { command: 'curl -X POST https://api.mail.io/send' })).decision).toBe('allow');
    expect([t.outbox.list(), t.ev('outbox.sent'), t.ev('gate.checked')]).toEqual([[], [], []]);
  });
});

/** The office tools over make()'s office, as main.ts builds them (the gate, the approvals, the outbox, the departments). */
function withTools(t: ReturnType<typeof make>) {
  const tools = officeTools({
    company: t.company, roster: t.roster, tasks: t.tasks, characters: () => ['coder'], memory: t.memory, budget: t.budget,
    engine: { sleep: async () => undefined, wake: () => undefined, sideQuestion: async () => ({ ok: true, answer: '' }) },
    plans: () => t.plans.list(), agenda: { text: () => '' }, approvals: t.approvals, gate: t.gate, outbox: t.outbox, departments: t.departments,
  });
  return async (who: Employee, name: string, args: Record<string, unknown> = {}) => {
    const tool = tools.find((x) => x.name === name)!;
    if (!tool.kinds.includes(t.roster.get(who.id).kind)) throw new Error(`${name} not offered to ${who.kind}`);
    return String(await tool.run({ employee: t.roster.get(who.id) } as never, args));
  };
}

describe('outboxRead and asking before a call (spec capabilities §7, §8)', () => {
  it('the coordinator reads everyone’s (a department or the centre narrows it); a head reads their own department’s only; a member is not offered it', async () => {
    const t = make();
    const call = withTools(t);
    const head = t.company.hire(OWNER, { name: 'Selin', role: 'r', departmentId: t.sales.id, head: true });
    const sena = t.hire('Sena', t.sales.id);
    const pelin = t.hire('Pelin', t.marketing.id);
    const ada = t.hire('Ada');
    await t.mail(sena, 'a@x.co');
    await t.mail(pelin, 'b@x.co');
    await t.mail(ada, 'c@x.co');
    const all = await call(t.coordinator, 'outboxRead');
    expect(all).toMatch(/^Giden kutusu \(herkes\) — son 3, yeniden eskiye/);
    expect(all).toMatch(/Sena — gönderim “send_message to=a@x\.co” \(sistem\) → a@x\.co/);
    expect(await call(t.coordinator, 'outboxRead', { department: 'pazarlama' })).not.toMatch(/Sena|Ada/);
    expect(await call(t.coordinator, 'outboxRead', { department: 'merkez' })).toMatch(/^Giden kutusu \(merkez \(departmansız\)\) — son 1[\s\S]*Ada/);
    const own = await call(head, 'outboxRead', { limit: 10 });
    expect(own).toMatch(/^Giden kutusu \(Satış\) — son 1/);
    expect(own).not.toMatch(/Pelin/);
    await expect(call(head, 'outboxRead', { department: 'Pazarlama' })).rejects.toThrow(/yalnız kendi departmanının giden kutusunu okur \(Satış\)/);
    await expect(call(t.coordinator, 'outboxRead', { limit: 0 })).rejects.toThrow(/limit 1 ile 200/);
    await expect(call(sena, 'outboxRead')).rejects.toThrow(/not offered/);
  });

  it('outboxRead: since narrows it; an empty box says so; a lead who heads no department is refused', async () => {
    const t = make();
    const call = withTools(t);
    const ada = t.hire('Ada');
    expect(await call(t.coordinator, 'outboxRead')).toBe('Giden kutusu (herkes): kayıt yok.');
    await t.mail(ada, 'bir@x.co');
    t.advance(26 * HOUR);
    await t.mail(ada, 'iki@x.co');
    // The clock starts on 13 October 11:00, so the second line is of the 14th.
    const recent = await call(t.coordinator, 'outboxRead', { since: '2026-10-14' });
    expect(recent).toMatch(/^Giden kutusu \(herkes\) — son 1,/);
    expect(recent).toContain('iki@x.co');
    expect(recent).not.toContain('bir@x.co');
    await expect(call(t.coordinator, 'outboxRead', { since: 'dün' })).rejects.toThrow(/since/);
    t.roster.update(ada.id, { kind: 'lead' });
    await expect(call(ada, 'outboxRead')).rejects.toThrow(/başkanı olduğun bir departman yok/);
  });

  it('asking before a call the system would let out: approvalRequest with the call’s input takes the gate’s own target; the call then passes as the owner’s', async () => {
    const t = make();
    const call = withTools(t);
    const ada = t.hire('Ada');
    const args = { to: 'musteri@x.co', subject: 'İade', body: 'İadenizi yapacağız.' };
    expect(await call(ada, 'approvalRequest', { tool: GMAIL, input: args, summary: 'Müşteriye iade sözü veriyorum.' })).toMatch(/^Onay istendi \(no \S+\): gönderim — “send_message to=musteri@x\.co”/);
    const [a] = t.approvals.list(ada.id) as [Approval];
    t.approvals.decide(a.id, true, { via: 'page' });
    expect(await t.ask(ada, GMAIL, args)).toMatchObject({ decision: 'allow', approvalId: a.id });
    expect(t.outbox.list()).toEqual([expect.objectContaining({ via: 'owner', approvalId: a.id })]);
    await expect(call(ada, 'approvalRequest', { tool: 'mcp__claude_ai_Gmail__get_message', input: { id: 'm' }, summary: 's' })).rejects.toThrow(/kapıya takılmaz/);
    await expect(call(ada, 'approvalRequest', { input: args, summary: 's' })).rejects.toThrow(/input ile birlikte tool/);
    await expect(call(ada, 'approvalRequest', { tool: GMAIL, input: 'to=a', summary: 's' })).rejects.toThrow(/bir nesne/);
  });
});
