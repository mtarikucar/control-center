import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Capability } from '@cc/shared';
import type { ToolClass } from '../src/company/capabilities.ts';
import { capabilityKind, toolClass, useCompanyCapabilities } from '../src/company/capabilities.ts';
import { classifyCall } from '../src/company/gate-policy.ts';
import { DESK, testContext } from './gate-helpers.ts';

const SMS = 'mcp__netgsm__send_sms';
const sms: Capability = { id: 'sms.send', title: 'SMS gönderme', summary: 'Netgsm ile SMS gönderir.', kind: 'send', outward: true, builtin: [], tools: [SMS], company: true };

/** A classification as toolClass gave it before the capability was retired; null: the real toolClass answers. */
const stale = vi.hoisted(() => ({ answer: null as { kind: 'classified'; capability: string; outward: boolean } | null }));
vi.mock('../src/company/capabilities.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/company/capabilities.ts')>();
  return { ...real, toolClass: (name: string): ToolClass => (stale.answer && name === 'mcp__netgsm__send_sms' ? stale.answer : real.toolClass(name)) };
});

afterEach(() => {
  stale.answer = null;
  useCompanyCapabilities(null);
});

describe('the gate when the vocabulary loses a capability between toolClass and capabilityKind', () => {
  it('a classified outward tool whose capability is gone from the vocabulary is held as other, with the capability named; never read, never a kind the system may handle', () => {
    useCompanyCapabilities(() => [sms]);
    stale.answer = toolClass(SMS) as typeof stale.answer;
    expect(stale.answer).toEqual({ kind: 'classified', capability: 'sms.send', outward: true });
    // The company retired it after toolClass answered: the vocabulary no longer has its id.
    useCompanyCapabilities(null);
    expect(capabilityKind('sms.send')).toBeNull();
    expect(classifyCall(SMS, { to: '05321112233', text: 'x' }, DESK, testContext()).parts).toEqual([expect.objectContaining({ kind: 'other', capability: 'sms.send' })]);
  });
});
