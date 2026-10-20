import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONSTITUTION, OWNER, type Employee } from '@cc/shared';
import { ReleasePolicyDesks, releasePolicyBlock } from '../src/company/release-policy.ts';
import { deskDir, prepareDesk, RELEASE_POLICY_FILE } from '../src/desk.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

/** The owner leaves releases to the office: merges, deploys and migrations go without asking, and every desk is told. */

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make() {
  const s = setup();
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, ['coder']);
  const coordinator = c.company.hireCoordinator();
  const ada = c.company.hire(OWNER, { name: 'Ada', role: 'r' });
  const desks = new ReleasePolicyDesks({ dataDir: s.dataDir, roster: s.roster, events: s.events, policy: () => c.budget.constitution().releasePolicy });
  desks.refresh();
  const file = (e: Employee) => join(deskDir(s.dataDir, e.slug), RELEASE_POLICY_FILE);
  const block = (e: Employee) => (existsSync(file(e)) ? readFileSync(file(e), 'utf8') : null);
  const card = (e: Employee) => readFileSync(join(prepareDesk(s.dataDir, s.roster.get(e.id)), 'CLAUDE.md'), 'utf8');
  return { ...s, ...c, coordinator, ada, desks, file, block, card };
}

describe('the release policy (constitution releasePolicy)', () => {
  it('is the owner’s by default, validated in Turkish, and told to the coordinator as a change', () => {
    const t = make();
    expect(DEFAULT_CONSTITUTION.releasePolicy).toBe('owner');
    expect(t.budget.setConstitution({ releasePolicy: 'office' })).toMatchObject({ releasePolicy: 'office' });
    expect(() => t.budget.setConstitution({ releasePolicy: 'belki' })).toThrow(/Canlıya alma ve birleştirme/);
  });

  it('with the owner’s policy no desk gets a block; with the office’s every desk does — the card imports it once — and it goes again when the owner takes it back', () => {
    const t = make();
    for (const e of [t.coordinator, t.ada]) {
      expect(t.block(e), e.name).toBeNull();
      expect(t.card(e), e.name).not.toContain(RELEASE_POLICY_FILE);
    }
    t.budget.ownerSetConstitution({ releasePolicy: 'office' });
    for (const e of [t.coordinator, t.ada]) {
      const text = t.block(e)!;
      expect(text, e.name).toMatch(/^## Canlıya alma ve birleştirme\n/);
      expect(text).toContain('sahibine sormadan yap');
      expect(text).toContain('Rol kartın, yöntem ya da görev metni "sahibinin onayıyla" dese de');
      expect(text).toContain('Ödeme ve silme bu kuralın dışındadır');
      expect(t.card(e), e.name).toContain(`@${RELEASE_POLICY_FILE}`);
    }
    // A new hire gets it before its first session.
    const can = t.company.hire(OWNER, { name: 'Can', role: 'r' });
    expect(t.block(can)).toContain('## Canlıya alma ve birleştirme');
    t.budget.ownerSetConstitution({ releasePolicy: 'owner' });
    expect(t.block(t.ada)).toBe('');
    expect(releasePolicyBlock('owner')).toBe('');
  });
});
