import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER, type Employee } from '@cc/shared';
import { prepareCodexDesk } from '../src/codex/desk.ts';
import { useCompanyCapabilities } from '../src/company/capabilities.ts';
import { asCapability, CustomCapabilities } from '../src/company/custom-capabilities.ts';
import { CustomCapabilityStore } from '../src/company/custom-capability-store.ts';
import { SpecialContactsDesks } from '../src/company/special-contacts.ts';
import { deskDir, prepareDesk, SPECIAL_CONTACTS_FILE } from '../src/desk.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

/** Final review I4.2: the owner's special contacts reach the desks of those who send, publish, call or invite. */

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
  useCompanyCapabilities(null);
});

function make() {
  const s = setup();
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, ['coder']);
  const caps = new CustomCapabilities({ store: new CustomCapabilityStore(s.db), roster: s.roster, events: s.events, notices: c.notices, coordinator: () => c.company.coordinator() });
  useCompanyCapabilities(() => caps.active().map(asCapability));
  const coordinator = c.company.hireCoordinator();
  const ada = c.company.hire(OWNER, { name: 'Ada', role: 'r' });
  const can = c.company.hire(OWNER, { name: 'Can', role: 'r' });
  c.company.editRoleCard(coordinator.id, ada.id, { capabilities: ['email.read', 'email.send'] });
  c.company.editRoleCard(coordinator.id, can.id, { capabilities: ['email.read', 'docs.write'] });
  const desks = new SpecialContactsDesks({ dataDir: s.dataDir, roster: s.roster, events: s.events, contacts: () => c.budget.constitution().specialContacts });
  desks.refresh();
  const file = (e: Employee) => join(deskDir(s.dataDir, e.slug), SPECIAL_CONTACTS_FILE);
  const block = (e: Employee) => (existsSync(file(e)) ? readFileSync(file(e), 'utf8') : null);
  const card = (e: Employee) => readFileSync(join(prepareDesk(s.dataDir, s.roster.get(e.id)), 'CLAUDE.md'), 'utf8');
  return { ...s, ...c, caps, coordinator, ada, can, desks, file, block, card };
}

describe('the special contacts on the senders’ desks (final review I4.2)', () => {
  it('an empty list writes nothing anywhere: no file, no import — an office without the feature is as today', () => {
    const t = make();
    for (const e of [t.coordinator, t.ada, t.can]) {
      expect(t.block(e), e.name).toBeNull();
      expect(t.card(e), e.name).not.toContain(SPECIAL_CONTACTS_FILE);
    }
    // A change that leaves the list empty writes nothing either.
    t.budget.ownerSetConstitution({ sendsPerHour: 10 });
    expect([t.block(t.ada), t.block(t.can)]).toEqual([null, null]);
  });

  it('the owner’s list reaches those whose capabilities send, publish, call or invite — imported by the card once, every contact a code span — and follows every change', () => {
    const t = make();
    t.budget.ownerSetConstitution({ specialContacts: ['ali@firma.com', '@AliVeli', 'Ahmet   Yılmaz', 'ld_ali'] });
    const ada = t.block(t.ada)!;
    expect(ada).toMatch(/^## Özel kişiler\n/);
    expect(ada).toContain('approvalRequest');
    expect(ada).toContain('kapı açık da olsa kapalı da');
    // A code span: Claude Code takes `@…` outside one for a file to import.
    expect(ada).toContain('- `ali@firma.com`\n- `@AliVeli`\n- `Ahmet Yılmaz`\n- `ld_ali`\n');
    expect(t.card(t.ada).match(/@special-contacts\.md/g)).toHaveLength(1);
    expect(t.card(t.ada).match(/@special-contacts\.md/g)).toHaveLength(1);
    // Neither a reader and writer of documents nor the coordinator without a sending capability.
    expect([t.block(t.can), t.block(t.coordinator)]).toEqual([null, null]);
    expect(t.card(t.can)).not.toContain(SPECIAL_CONTACTS_FILE);
    // A role card that now calls: their desk has it at once; the card rewritten keeps the import.
    t.company.editRoleCard(t.coordinator.id, t.can.id, { capabilities: ['calls.make'] });
    expect(t.block(t.can)).toBe(ada);
    expect(t.card(t.can).match(/@special-contacts\.md/g)).toHaveLength(1);
    // The owner changes the list: every sender's copy follows.
    t.budget.ownerSetConstitution({ specialContacts: ['veli@firma.com'] });
    expect(t.block(t.ada)).toContain('- `veli@firma.com`\n');
    expect(t.block(t.ada)).not.toContain('ali@firma.com');
    expect(t.block(t.can)).toBe(t.block(t.ada));
    // Ada stops sending: her copy is emptied; the list emptied: everyone's.
    t.company.editRoleCard(t.coordinator.id, t.ada.id, { capabilities: ['email.read'] });
    expect(t.block(t.ada)).toBe('');
    t.budget.ownerSetConstitution({ specialContacts: [] });
    expect([t.block(t.ada), t.block(t.can)]).toEqual(['', '']);
  });

  it('a company capability counts by its kind, also when the owner changes it; a Codex desk gets the list inline', () => {
    const t = make();
    t.budget.ownerSetConstitution({ specialContacts: ['ali@firma.com'] });
    t.caps.ownerAdd({ id: 'sms.read', title: 'SMS okuma', summary: 'Gelen SMS.', kind: 'read', tools: ['mcp__netgsm__inbox'] });
    t.company.editRoleCard(t.coordinator.id, t.can.id, { capabilities: ['sms.read'] });
    expect(t.block(t.can)).toBeNull();
    t.caps.setKind('sms.read', 'send');
    expect(t.block(t.can)).toContain('- `ali@firma.com`');
    const agents = readFileSync(join(prepareCodexDesk(t.dataDir, t.roster.get(t.can.id)), 'AGENTS.md'), 'utf8');
    expect(agents).toContain('## Özel kişiler');
    expect(agents).toContain('- `ali@firma.com`');
    expect(agents).not.toContain('@special-contacts.md');
  });
});
