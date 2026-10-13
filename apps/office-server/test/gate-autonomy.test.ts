import { afterEach, describe, expect, it, vi } from 'vitest';
import { OWNER, type Approval, type Employee, type OutboxEntry } from '@cc/shared';
import { ApprovalStore } from '../src/company/approval-store.ts';
import { Approvals } from '../src/company/approvals.ts';
import { useCompanyCapabilities } from '../src/company/capabilities.ts';
import { asCapability, CustomCapabilities } from '../src/company/custom-capabilities.ts';
import { CustomCapabilityStore } from '../src/company/custom-capability-store.ts';
import { Gate, type GateDeps } from '../src/company/gate.ts';
import { OutboxStore } from '../src/company/outbox-store.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { DATA, HOME, testContext } from './gate-helpers.ts';
import { setup } from './helpers.ts';

/** Spec capabilities §5–§7: the gate's system path, its rules and the outbox. */

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const c of cleanups.splice(0)) await c();
  useCompanyCapabilities(null);
});

const HOUR = 3_600_000;
const GMAIL = 'mcp__claude_ai_Gmail__send_message';

/** `git`: the gate asks it first (an await before the classification); `reads`: the system path's constitution reads, `fail` makes them throw. */
function make(o: { git?: GateDeps['git'] } = {}) {
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
  const reads = { n: 0, fail: null as Error | null };
  const constitution = () => {
    reads.n += 1;
    if (reads.fail) throw reads.fail;
    return c.budget.constitution();
  };
  const gate = new Gate({
    approvals, events: s.events, roster: s.roster, enabled: () => c.budget.constitution().gateEnabled,
    context: (e) => testContext({ deskDir: `${DATA}/desks/${e.slug}` }), ...(o.git ? { git: o.git } : {}),
    autonomy: { constitution, outbox, now: clock },
  });
  const coordinator = c.company.hireCoordinator();
  const sales = c.departments!.create(OWNER, { name: 'Satış', mission: 'm' });
  const marketing = c.departments!.create(OWNER, { name: 'Pazarlama', mission: 'm' });
  const hire = (name: string, departmentId?: string) => c.company.hire(OWNER, { name, role: 'r', ...(departmentId ? { departmentId } : {}) });
  const ask = (who: Employee, tool_name: string, tool_input: unknown) => gate.check(who.id, { tool_name, tool_input, cwd: `${DATA}/desks/${who.slug}` });
  const mail = (who: Employee, to: string | string[] = 'musteri@x.co') => ask(who, GMAIL, { to, subject: 'Siparişiniz', body: 'Kargoya verildi.' });
  const ev = (type: string) => s.events.list({ limit: 5000 }).filter((e) => e.event.type === type);
  return { ...s, ...c, approvals, outbox, gate, reads, coordinator, sales, marketing, hire, ask, mail, ev, advance: (ms: number) => void (now += ms) };
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

  it('final review C1: Gmail’s send of a draft and a reply to everyone go to the owner — their recipients are not in the input; a reply to one is the system’s', async () => {
    const t = make();
    t.budget.setConstitution({ specialContacts: ['ali@firma.com'] });
    const ada = t.hire('Ada');
    const draft = await t.ask(ada, GMAIL, { draftId: 'r-123' });
    expect(draft).toMatchObject({ decision: 'deny', kind: 'send' });
    expect(draft.reason).toContain('onaysız yapılamaz (alıcılar girdide yok (taslak / hepsini yanıtla)). Sistem bu çağrıyı kuralı yüzünden kendi geçirmedi.');
    const all = await t.ask(ada, 'mcp__claude_ai_Gmail__reply', { messageId: 'm1', replyAll: true, body: 'Teşekkürler, %30 indirim sizin.' });
    expect(all).toMatchObject({ decision: 'deny', kind: 'send' });
    expect(all.reason).toMatch(/\(alıcılar girdide yok \(taslak \/ hepsini yanıtla\)\)/);
    expect(t.outbox.list()).toEqual([]);
    expect(await t.ask(ada, 'mcp__claude_ai_Gmail__reply', { messageId: 'm1', body: 'Teşekkürler.' })).toMatchObject({ decision: 'allow', reason: 'sistemce (otonomi politikası)' });
    expect(t.outbox.list()).toEqual([expect.objectContaining({ tool: 'mcp__claude_ai_Gmail__reply', via: 'system', recipients: [] })]);
  });

  it('final review I1: a capability the coordinator activated stays the owner’s at the gate until the owner confirms it; what the owner added, and the product’s, are the system’s', async () => {
    const t = make();
    const caps = new CustomCapabilities({ store: new CustomCapabilityStore(t.db), roster: t.roster, events: t.events, notices: t.notices, coordinator: () => t.company.coordinator() });
    useCompanyCapabilities(() => caps.active().map(asCapability));
    const ada = t.hire('Ada');
    const SMS = 'mcp__netgsm__send_sms';
    caps.propose(ada.id, { id: 'sms.send', title: 'SMS', summary: 'Netgsm ile SMS.', kind: 'send', tools: [SMS] });
    // Review focus 3's case: the coordinator accepts it with the kind proposed.
    caps.decide(t.coordinator.id, 'sms.send', { accept: true });
    const sms = () => t.ask(ada, SMS, { phone: '+905320000000', text: 'Kargonuz yolda.' });
    const held = await sms();
    expect(held).toMatchObject({ decision: 'deny', kind: 'send' });
    expect(held.reason).toMatch(/onaysız yapılamaz \(koordinatörün açtığı yetenek: sahibi sisteme açana dek sahibine sorulur\)\. approvalRequest/);
    expect(t.outbox.list()).toEqual([]);
    caps.confirm('sms.send');
    expect(await sms()).toMatchObject({ decision: 'allow', reason: 'sistemce (otonomi politikası)', kind: 'send' });
    caps.ownerAdd({ id: 'wa.send', title: 'WhatsApp', summary: 'Mesaj.', kind: 'send', tools: ['mcp__wa__send_message'] });
    expect(await t.ask(ada, 'mcp__wa__send_message', { to: '+905320000001', text: 'Merhaba' })).toMatchObject({ decision: 'allow', reason: 'sistemce (otonomi politikası)' });
    expect(await t.mail(ada)).toMatchObject({ decision: 'allow', reason: 'sistemce (otonomi politikası)' });
    expect(t.outbox.list().map((e) => e.tool)).toEqual([GMAIL, 'mcp__wa__send_message', SMS]);
  });

  it('final review I3: a call the employee asked the owner about is never the system’s while the owner has not answered, nor for a day after a no; a yes is used as the owner’s', async () => {
    const t = make();
    const ada = t.hire('Ada');
    const args = { to: 'musteri@x.co', subject: 'İade', body: 'İadenizi yapacağız.' };
    const ask = (summary: string) => {
      const seen = t.gate.preview(ada.id, GMAIL, args)!;
      return t.approvals.request(ada.id, { kind: seen.kind, tool: GMAIL, target: seen.target, summary });
    };
    const pending = ask('İade sözü');
    const waiting = await t.ask(ada, GMAIL, args);
    expect(waiting).toMatchObject({ decision: 'deny', kind: 'send', target: 'send_message to=musteri@x.co' });
    expect(waiting.reason).toMatch(/onaysız yapılamaz \(sahibine soruldu, cevap bekleniyor\)\. approvalRequest/);
    // Another call to someone else is still the system's.
    expect((await t.mail(ada, 'baska@x.co')).decision).toBe('allow');
    t.approvals.decide(pending.id, false, { via: 'page', note: 'İade yok.' });
    t.advance(23 * HOUR);
    expect((await t.ask(ada, GMAIL, args)).reason).toMatch(/onaysız yapılamaz \(sahibi bu çağrıyı reddetti\)\. approvalRequest/);
    // A refusal holds as long as an approval would stand: a day.
    t.advance(HOUR);
    expect(await t.ask(ada, GMAIL, args)).toMatchObject({ decision: 'allow', reason: 'sistemce (otonomi politikası)' });
    const yes = ask('İkinci iade');
    t.approvals.decide(yes.id, true, { via: 'page' });
    expect(await t.ask(ada, GMAIL, args)).toMatchObject({ decision: 'allow', reason: 'sahibinin onayıyla', approvalId: yes.id });
    expect(t.outbox.list().map((e) => `${e.via}:${e.recipients.join()}`)).toEqual(['owner:musteri@x.co', 'system:musteri@x.co', 'system:baska@x.co']);
    // Someone else's request for the same call is theirs alone.
    const can = t.hire('Can');
    t.approvals.request(can.id, { kind: 'send', tool: GMAIL, target: 'send_message to=musteri@x.co', summary: 's' });
    expect((await t.ask(ada, GMAIL, args)).decision).toBe('allow');
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

describe('the gate’s writes (Task 8 review M1, M2, M4, M5)', () => {
  /** Held as the owner's, as before the policy: the part's own why, no word of a rule. */
  const ownersReason = /^OFİS KAPISI: gönderim — “send_message to=musteri@x\.co” onaysız yapılamaz \(dışarıya gönderir \(email\.send\)\)\. approvalRequest/;

  it('M1: an approved call whose outbox line cannot be written fails closed — its approval unspent, no allow on record; with the outbox back it passes on that approval', async () => {
    const t = make();
    const selin = t.hire('Selin', t.sales.id);
    const six = Array.from({ length: 6 }, (_, i) => `k${i}@x.co`);
    const held = await t.mail(selin, six);
    const a = t.approvals.request(selin.id, { kind: 'send', tool: GMAIL, target: held.target, summary: 'Kampanya duyurusu' });
    t.approvals.decide(a.id, true, { via: 'page' });
    // Nothing is announced either: the line is written before the approval's use and the allow are.
    const heard: string[] = [];
    cleanups.push(t.events.subscribe((e) => heard.push(e.event.type)));
    vi.spyOn(t.outbox, 'add').mockImplementationOnce(() => {
      throw new Error('disk dolu');
    });
    await expect(t.mail(selin, six)).rejects.toThrow('disk dolu');
    expect(heard).toEqual([]);
    expect(t.ev('gate.checked').map((e) => (e.event as { decision: string }).decision)).toEqual(['deny']);
    expect(t.ev('approval.changed').map((e) => (e.event as { change: string }).change)).toEqual(['requested', 'approved']);
    expect(t.approvals.get(a.id).status).toBe('approved');
    expect([t.outbox.list(), t.ev('outbox.sent')]).toEqual([[], []]);
    // A write after the line fails: the line, the approval's use and the allow go back with it.
    const append = t.events.append.bind(t.events);
    const events = vi.spyOn(t.events, 'append').mockImplementation((id, event) => {
      if (event.type === 'gate.checked') throw new Error('olay yazılamadı');
      return append(id, event);
    });
    await expect(t.mail(selin, six)).rejects.toThrow('olay yazılamadı');
    expect([t.outbox.list(), t.approvals.get(a.id).status, t.ev('gate.checked').length]).toEqual([[], 'approved', 1]);
    // The approval's use was written before the failure and went back with it: it was never heard (hardening round 2).
    expect(heard).toEqual([]);
    events.mockRestore();
    expect(await t.mail(selin, six)).toMatchObject({ decision: 'allow', approvalId: a.id });
    expect(heard).toEqual(['approval.changed', 'gate.checked', 'outbox.sent']);
    expect(t.outbox.list()).toEqual([expect.objectContaining({ via: 'owner', approvalId: a.id })]);
    expect(t.ev('gate.checked').map((e) => (e.event as { decision: string }).decision)).toEqual(['deny', 'allow']);
  });

  it('M1: the system’s line and its outbox.sent are written together or not at all; a call the outbox cannot take stays the owner’s', async () => {
    const t = make();
    const ada = t.hire('Ada');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(t.outbox, 'add').mockImplementationOnce(() => {
      throw new Error('disk dolu');
    });
    const held = await t.mail(ada);
    expect(held).toMatchObject({ decision: 'deny', kind: 'send' });
    expect(held.reason).toMatch(ownersReason);
    expect([t.outbox.list(), t.ev('outbox.sent')]).toEqual([[], []]);
    // The line is added and its event cannot be: the line goes too.
    const append = t.events.append.bind(t.events);
    const events = vi.spyOn(t.events, 'append').mockImplementation((id, event) => {
      if (event.type === 'outbox.sent') throw new Error('olay yazılamadı');
      return append(id, event);
    });
    expect((await t.mail(ada)).decision).toBe('deny');
    expect([t.outbox.list(), t.ev('outbox.sent')]).toEqual([[], []]);
    expect(error).toHaveBeenCalledTimes(2);
    events.mockRestore();
    expect((await t.mail(ada)).decision).toBe('allow');
    expect([t.outbox.list(), t.ev('outbox.sent')].map((x) => x.length)).toEqual([1, 1]);
  });

  it('M2: the outbox line carries the approval of the part it records, the allow the first part’s', async () => {
    const t = make();
    const ada = t.hire('Ada');
    const line = { command: `echo x > ${HOME}/.claude/settings.json; git push origin main` };
    const ids: string[] = [];
    for (const kind of ['self', 'publish']) {
      const held = await t.ask(ada, 'Bash', line);
      expect(held).toMatchObject({ decision: 'deny', kind });
      const a = t.approvals.request(ada.id, { kind: held.kind!, tool: 'Bash', target: held.target!, summary: 'Ayar ve sürüm' });
      t.approvals.decide(a.id, true, { via: 'page' });
      ids.push(a.id);
    }
    expect(await t.ask(ada, 'Bash', line)).toMatchObject({ decision: 'allow', kind: 'self', approvalId: ids[0] });
    expect(t.ev('gate.checked').at(-1)!.event).toMatchObject({ decision: 'allow', kind: 'self', approvalId: ids[0] });
    expect(t.outbox.list()).toEqual([expect.objectContaining({ kind: 'publish', target: 'git push origin', via: 'owner', approvalId: ids[1] })]);
  });

  it('M4: the constitution is read only for a call whose every part is a connector’s; a throw on the system path holds the call as the owner’s, never a 500', async () => {
    const t = make();
    const ada = t.hire('Ada');
    await t.ask(ada, 'Bash', { command: 'git push origin main' });
    await t.ask(ada, 'SendMessage', { to: 'x', message: 'y' });
    await t.ask(ada, 'mcp__netgsm__send_sms', { to: '0532' });
    expect(t.reads.n).toBe(0);
    expect((await t.mail(ada)).decision).toBe('allow');
    expect(t.reads.n).toBe(1);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    t.reads.fail = new Error('anayasa okunamadı');
    const held = await t.mail(ada);
    expect(held).toMatchObject({ decision: 'deny', kind: 'send' });
    expect(held.reason).toMatch(ownersReason);
    expect(t.gate.lastHeld(ada.id)).toEqual({ tool: GMAIL, kind: 'send', target: 'send_message to=musteri@x.co', scope: 'call' });
    expect(t.ev('gate.checked').at(-1)!.event).toMatchObject({ decision: 'deny', kind: 'send' });
    t.reads.fail = null;
    vi.spyOn(t.outbox, 'countSystem').mockImplementation(() => {
      throw new Error('sayılamadı');
    });
    expect((await t.mail(ada)).reason).toMatch(ownersReason);
    expect(error).toHaveBeenCalledTimes(2);
    expect(error.mock.calls[0]![0]).toMatch(/sistem yolu/);
    expect(t.outbox.list()).toHaveLength(1);
  });

  it('M5: two mails at once at sendsPerHour 1 — exactly one is let out, also when both wait for git first', async () => {
    // git answering at once: both calls take up again in the same turn of the event loop, one right after the other.
    for (const git of [undefined, { missing: () => true, refresh: async () => undefined }]) {
      const t = make(git ? { git } : {});
      t.budget.setConstitution({ sendsPerHour: 1 });
      const ada = t.hire('Ada');
      const both = await Promise.all([t.mail(ada, 'a@x.co'), t.mail(ada, 'b@x.co')]);
      expect(both.map((d) => d.decision).sort()).toEqual(['allow', 'deny']);
      expect(t.outbox.list()).toHaveLength(1);
    }
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
