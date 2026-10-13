import { afterEach, describe, expect, it } from 'vitest';
import { OWNER, type Employee } from '@cc/shared';
import { capabilityIds, toolClass, useCompanyCapabilities } from '../src/company/capabilities.ts';
import { asCapability, coordinatorMayChange, CustomCapabilities } from '../src/company/custom-capabilities.ts';
import { CustomCapabilityStore } from '../src/company/custom-capability-store.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
  useCompanyCapabilities(null);
});

const SMS = 'mcp__netgsm__send_sms';
const proposal = (over: Record<string, unknown> = {}) => ({ id: 'sms.send', title: 'SMS gönderme', summary: 'Netgsm ile müşteriye SMS gönderir.', kind: 'send', tools: [SMS], ...over });

function make() {
  let now = 1_000;
  const clock = () => now;
  const s = setup(8, clock);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, ['coder'], clock);
  const store = new CustomCapabilityStore(s.db);
  const caps = new CustomCapabilities({ store, roster: s.roster, events: s.events, notices: c.notices, coordinator: () => c.company.coordinator(), now: clock });
  // As main.ts wires it.
  useCompanyCapabilities(() => caps.active().map(asCapability));
  const coordinator = c.company.hireCoordinator();
  const ada = c.company.hire(OWNER, { name: 'Ada', role: 'r' });
  const changes = () => s.events.list({ limit: 1000 }).filter((e) => e.event.type === 'capability.changed').map((e) => (e.event as { change: string }).change);
  const said = (who: Employee) => c.notices.pending(who.id).map((n) => `${n.topic}: ${n.text}`).join('\n');
  return { ...s, ...c, caps, store, coordinator, ada, changes, said, tick: (ms: number) => void (now += ms) };
}

describe('company capabilities — proposing and deciding (spec capabilities §4.2)', () => {
  it('an employee proposes; the coordinator hears and accepts it: active, in the vocabulary at once, the proposer told', () => {
    const t = make();
    const p = t.caps.propose(t.ada.id, proposal());
    expect(p).toMatchObject({ id: 'sms.send', status: 'proposed', kind: 'send', proposedBy: t.ada.id, decidedBy: null, createdAt: 1_000 });
    expect(toolClass(SMS)).toEqual({ kind: 'unclassified', outward: true });
    expect(t.said(t.coordinator)).toMatch(/capability\.proposed: Ada sözlüğe yeni bir yetenek önerdi: sms\.send — SMS gönderme \(gönderim; araçlar: mcp__netgsm__send_sms\)/);
    t.tick(500);
    expect(t.caps.decide(t.coordinator.id, 'sms.send', { accept: true })).toMatchObject({ status: 'active', decidedBy: t.coordinator.id, decidedAt: 1_500 });
    expect(toolClass(SMS)).toEqual({ kind: 'classified', capability: 'sms.send', outward: true });
    expect(capabilityIds(['sms.send'], 'Yetenekler')).toEqual(['sms.send']);
    expect(t.said(t.ada)).toMatch(/capability\.decided: Koordinatör önerdiğin sms\.send yeteneğini kabul etti \(gönderim\)/);
    expect(t.changes()).toEqual(['proposed', 'activated']);
  });

  it('the coordinator’s own proposal is the owner’s to decide (the doer is not the checker); no one else decides', () => {
    const t = make();
    t.caps.propose(t.coordinator.id, proposal());
    expect(t.said(t.coordinator)).not.toMatch(/capability\.proposed/);
    expect(() => t.caps.decide(t.coordinator.id, 'sms.send', { accept: true })).toThrow(/Kendi önerini karara bağlayamazsın/);
    expect(() => t.caps.decide(t.ada.id, 'sms.send', { accept: true })).toThrow(/koordinatör ya da sahibi/);
    expect(t.caps.decide(OWNER, 'sms.send', { accept: true })).toMatchObject({ status: 'active', decidedBy: OWNER });
    expect(t.said(t.coordinator)).toMatch(/capability\.decided: Sahibi önerdiğin sms\.send yeteneğini kabul etti/);
  });

  it('review focus 3: the coordinator never moves a pay or delete kind and never loosens an outward one; it keeps or tightens; the owner may do any', () => {
    const t = make();
    t.caps.propose(t.ada.id, proposal({ id: 'sms.credits', kind: 'pay', tools: ['mcp__netgsm__buy_credits'] }));
    expect(() => t.caps.decide(t.coordinator.id, 'sms.credits', { accept: true, kind: 'read' })).toThrow(/ödeme\/harcama türündeki bir yetenek başka bir türe yalnız sahibince çekilir/);
    expect(() => t.caps.decide(t.coordinator.id, 'sms.credits', { accept: true, kind: 'send' })).toThrow(/yalnız sahibince/);
    expect(t.caps.get('sms.credits')).toMatchObject({ status: 'proposed', kind: 'pay' });
    expect(t.caps.decide(t.coordinator.id, 'sms.credits', { accept: true })).toMatchObject({ status: 'active', kind: 'pay' });
    t.caps.propose(t.ada.id, proposal());
    expect(() => t.caps.decide(t.coordinator.id, 'sms.send', { accept: true, kind: 'read' })).toThrow(/Koordinatör türü yalnız sıkılaştırır/);
    expect(() => t.caps.decide(t.coordinator.id, 'sms.send', { accept: true, kind: 'publish' })).toThrow(/sıkılaştırır/);
    expect(t.caps.decide(t.coordinator.id, 'sms.send', { accept: true, kind: 'pay' })).toMatchObject({ kind: 'pay' });
    t.caps.propose(t.ada.id, proposal({ id: 'sms.read', kind: 'read', tools: ['mcp__netgsm__inbox'] }));
    expect(t.caps.decide(t.coordinator.id, 'sms.read', { accept: true, kind: 'send' })).toMatchObject({ kind: 'send' });
    // The owner may loosen, also an active one.
    expect(t.caps.setKind('sms.credits', 'read')).toMatchObject({ kind: 'read', decidedBy: OWNER });
    expect(toolClass('mcp__netgsm__buy_credits')).toEqual({ kind: 'classified', capability: 'sms.credits', outward: false });
    expect([coordinatorMayChange('delete', 'pay'), coordinatorMayChange('calendar', 'delete'), coordinatorMayChange('call', 'send'), coordinatorMayChange('read', 'call')]).toEqual([false, true, false, true]);
  });

  it('review focus 3: a read proposal is accepted as read by the owner alone — the coordinator tightens it to an outward kind or leaves it to the owner', () => {
    const t = make();
    const inbox = proposal({ id: 'sms.inbox', title: 'SMS gelen kutusu', summary: 'Netgsm gelen kutusunu okur.', kind: 'read', tools: ['mcp__netgsm__inbox'] });
    t.caps.propose(t.ada.id, inbox);
    // A read tool is open in every session and passes the gate: unchanged, the coordinator may not accept it — saying what it can do.
    for (const accept of [{ accept: true }, { accept: true, kind: 'read' }]) {
      expect(() => t.caps.decide(t.coordinator.id, 'sms.inbox', accept)).toThrow(/Bir aracı okuma \(read\) olarak sınıflandırmak sahibinin kararı; dışa dönük bir türle kabul edebilirsin/);
    }
    expect(t.caps.get('sms.inbox')).toMatchObject({ status: 'proposed', kind: 'read', decidedBy: null });
    expect(toolClass('mcp__netgsm__inbox')).toEqual({ kind: 'unclassified', outward: true });
    expect(t.changes()).toEqual(['proposed']);
    // Tightened to an outward kind, it is the coordinator's to accept.
    expect(t.caps.decide(t.coordinator.id, 'sms.inbox', { accept: true, kind: 'send' })).toMatchObject({ status: 'active', kind: 'send' });
    expect(toolClass('mcp__netgsm__inbox')).toEqual({ kind: 'classified', capability: 'sms.inbox', outward: true });
    // The owner accepts it as read.
    t.caps.propose(t.ada.id, proposal({ ...inbox, id: 'sms.status', tools: ['mcp__netgsm__status'] }));
    expect(t.caps.decide(OWNER, 'sms.status', { accept: true })).toMatchObject({ status: 'active', kind: 'read', decidedBy: OWNER });
    expect(toolClass('mcp__netgsm__status')).toEqual({ kind: 'classified', capability: 'sms.status', outward: false });
  });

  it('refuses what cannot be, saying why: a product id or tool (a pay tool as read), the office’s own, a tool another active one has, a bad id, kind or list; a rejected id may be proposed again', () => {
    const t = make();
    const bad: Array<[Record<string, unknown>, RegExp]> = [
      [proposal({ id: 'email.send' }), /email\.send ürünle gelen bir yetenek/],
      [proposal({ id: 'ads.cheap', kind: 'read', tools: ['mcp__claude_ai_jeeta__jeeta_reallocate_budget'] }), /ürünle gelen ads\.manage yeteneğinde/],
      [proposal({ tools: ['mcp__office__taskFinish'] }), /ofisin kendi aracı/],
      [proposal({ id: 'SMS.send' }), /alan\.eylem biçiminde/],
      [proposal({ kind: 'spend' }), /Tür \(kind\) şunlardan biri olmalı: read, send, calendar, call, publish, pay, delete/],
      [proposal({ tools: [] }), /en az bir bağlayıcı aracının/],
      [proposal({ tools: ['send_sms'] }), /bir bağlayıcı aracı değil/],
      [proposal({ title: ' ' }), /Başlık \(title\) boş olamaz/],
    ];
    for (const [input, error] of bad) expect(() => t.caps.propose(t.ada.id, input), String(error)).toThrow(error);
    // The owner's addition is held to the same rules.
    expect(() => t.caps.ownerAdd(bad[1]![0])).toThrow(/ürünle gelen ads\.manage yeteneğinde/);
    expect(() => t.caps.ownerAdd(bad[0]![0])).toThrow(/email\.send ürünle gelen bir yetenek/);
    expect(t.caps.list()).toEqual([]);
    t.caps.ownerAdd(proposal());
    expect(() => t.caps.propose(t.ada.id, proposal({ id: 'sms.bulk' }))).toThrow(/şirketin sms\.send yeteneğinde/);
    expect(() => t.caps.propose(t.ada.id, proposal({ tools: ['mcp__netgsm__other'] }))).toThrow(/sms\.send zaten etkin/);
    t.caps.propose(t.ada.id, proposal({ id: 'sms.read', kind: 'read', tools: ['mcp__netgsm__inbox'] }));
    expect(() => t.caps.decide(t.coordinator.id, 'sms.read', { accept: false })).toThrow(/Not boş olamaz/);
    t.caps.decide(t.coordinator.id, 'sms.read', { accept: false, note: 'gerek yok' });
    expect(t.said(t.ada)).toMatch(/capability\.decided: Koordinatör önerdiğin sms\.read yeteneğini reddetti: gerek yok/);
    expect(() => t.caps.decide(t.coordinator.id, 'sms.read', { accept: true })).toThrow(/karar beklemiyor/);
    expect(t.caps.propose(t.ada.id, proposal({ id: 'sms.read', kind: 'read', tools: ['mcp__netgsm__inbox'] }))).toMatchObject({ status: 'proposed', note: null, decidedBy: null });
  });

  it('is checked again when accepted: a tool another capability took in the meantime (or the product has since) is refused, the proposal waits', () => {
    const t = make();
    // Two proposals name one tool; they may both wait, only the first accepted has it.
    t.caps.propose(t.ada.id, proposal());
    t.caps.propose(t.ada.id, proposal({ id: 'sms.bulk', title: 'Toplu SMS' }));
    t.caps.decide(t.coordinator.id, 'sms.send', { accept: true });
    expect(() => t.caps.decide(t.coordinator.id, 'sms.bulk', { accept: true })).toThrow(/şirketin sms\.send yeteneğinde/);
    expect(() => t.caps.decide(OWNER, 'sms.bulk', { accept: true })).toThrow(/şirketin sms\.send yeteneğinde/);
    expect(t.caps.get('sms.bulk')).toMatchObject({ status: 'proposed', decidedBy: null });
    expect(t.caps.active().map((c) => c.id)).toEqual(['sms.send']);
    // Rows that predate a product tool or id of the same name (the product's vocabulary grew): written past the service.
    t.store.put({ ...t.caps.get('sms.bulk'), id: 'ads.cheap', kind: 'send', tools: ['mcp__claude_ai_jeeta__jeeta_reallocate_budget'] });
    t.store.put({ ...t.caps.get('sms.bulk'), id: 'email.send', tools: ['mcp__netgsm__mail'] });
    expect(() => t.caps.decide(t.coordinator.id, 'ads.cheap', { accept: true })).toThrow(/ürünle gelen ads\.manage yeteneğinde/);
    expect(() => t.caps.decide(OWNER, 'email.send', { accept: true })).toThrow(/email\.send ürünle gelen bir yetenek/);
    expect(t.caps.get('ads.cheap').status).toBe('proposed');
    expect(toolClass('mcp__claude_ai_jeeta__jeeta_reallocate_budget')).toMatchObject({ kind: 'classified', capability: 'ads.manage' });
    expect(toolClass('mcp__netgsm__mail')).toEqual({ kind: 'unclassified', outward: true });
    // Rejecting is still possible.
    expect(t.caps.decide(t.coordinator.id, 'ads.cheap', { accept: false, note: 'ürün sözlüğünde var' })).toMatchObject({ status: 'rejected' });
  });

  it('the owner adds one (active at once, the coordinator told) and retires it: its tools are unclassified again', () => {
    const t = make();
    t.caps.ownerAdd(proposal());
    expect(toolClass(SMS).kind).toBe('classified');
    expect(t.said(t.coordinator)).toMatch(/capability\.decided: Sahibi sözlüğe sms\.send yeteneğini ekledi \(gönderim; araçlar: mcp__netgsm__send_sms\)/);
    expect(t.caps.retire('sms.send', 'Netgsm bitti')).toMatchObject({ status: 'retired', decidedBy: OWNER, note: 'Netgsm bitti' });
    expect(toolClass(SMS)).toEqual({ kind: 'unclassified', outward: true });
    expect(() => capabilityIds(['sms.send'], 'Yetenekler')).toThrow(/Bilinmeyen yetenek: sms\.send/);
    expect(t.said(t.coordinator)).toMatch(/capability\.decided: Sahibi sms\.send yeteneğini geri aldı \(Netgsm bitti\)/);
    expect(() => t.caps.retire('sms.send')).toThrow(/etkin değil/);
    expect(t.changes()).toEqual(['activated', 'retired']);
  });

  it('a retired id may be proposed again, and the vocabulary follows it each way: the tool is classified again once accepted', () => {
    const t = make();
    t.caps.ownerAdd(proposal());
    t.caps.retire('sms.send');
    expect(toolClass(SMS).kind).toBe('unclassified');
    t.caps.propose(t.ada.id, proposal());
    expect(toolClass(SMS).kind).toBe('unclassified');
    t.caps.decide(t.coordinator.id, 'sms.send', { accept: true });
    expect(toolClass(SMS)).toEqual({ kind: 'classified', capability: 'sms.send', outward: true });
    t.caps.retire('sms.send');
    // The owner puts a retired one back by adding it again.
    t.caps.ownerAdd(proposal());
    expect(toolClass(SMS)).toEqual({ kind: 'classified', capability: 'sms.send', outward: true });
    expect(t.changes()).toEqual(['activated', 'retired', 'proposed', 'activated', 'retired', 'activated']);
  });

  it('the owner sets a kind of a proposed or an active one: an active one changes the gate’s answer at once, a proposed one only its row; a decided-against or retired one stays', () => {
    const t = make();
    t.caps.propose(t.ada.id, proposal());
    expect(t.caps.setKind('sms.send', 'send')).toMatchObject({ status: 'proposed', kind: 'send' });
    expect(t.changes()).toEqual(['proposed']);
    expect(t.caps.setKind('sms.send', 'publish')).toMatchObject({ status: 'proposed', kind: 'publish', decidedBy: null });
    expect(t.changes()).toEqual(['proposed', 'kind']);
    expect(() => t.caps.setKind('sms.send', 'spend')).toThrow(/Tür \(kind\) şunlardan biri olmalı/);
    expect(() => t.caps.decide(t.coordinator.id, 'sms.send', { accept: true, kind: 'spend' })).toThrow(/Tür \(kind\) şunlardan biri olmalı/);
    expect(t.caps.decide(t.coordinator.id, 'sms.send', { accept: true })).toMatchObject({ status: 'active', kind: 'publish' });
    expect(t.caps.setKind('sms.send', 'read')).toMatchObject({ kind: 'read', decidedBy: OWNER });
    expect(toolClass(SMS)).toEqual({ kind: 'classified', capability: 'sms.send', outward: false });
    expect(t.caps.setKind('sms.send', 'delete')).toMatchObject({ kind: 'delete' });
    expect(toolClass(SMS)).toEqual({ kind: 'classified', capability: 'sms.send', outward: true });
    expect(t.changes()).toEqual(['proposed', 'kind', 'activated', 'kind', 'kind']);
    t.caps.retire('sms.send');
    expect(() => t.caps.setKind('sms.send', 'send')).toThrow(/geri alındı; türü değiştirilemez/);
  });
});
