import { afterEach, describe, expect, it } from 'vitest';
import type { Capability, Integration, IntegrationDesk } from '@cc/shared';
import { capabilityIds, capabilityKind, capabilityVocabulary, coverage, invalidateVocabulary, productToolOwner, productVocabulary, toolClass, unclassifiedTools, useCompanyCapabilities } from '../src/company/capabilities.ts';
import { classifyCall } from '../src/company/gate-policy.ts';
import { sessionDeny } from '../src/company/session-deny.ts';
import { DESK, testContext } from './gate-helpers.ts';

afterEach(() => useCompanyCapabilities(null));

const SMS = 'mcp__netgsm__send_sms';
const sms = (over: Partial<Capability> = {}): Capability => ({ id: 'sms.send', title: 'SMS gönderme', summary: 'Netgsm ile SMS gönderir.', kind: 'send', outward: true, builtin: [], tools: [SMS], company: true, ...over });
const ctx = testContext();

describe('the vocabulary with the company’s capabilities (spec capabilities §4.1)', () => {
  it('an active company capability follows the product’s; its tools are classified by its kind, a role may declare it, coverage counts it', () => {
    useCompanyCapabilities(() => [sms()]);
    const v = capabilityVocabulary();
    expect(v.version).toBe(3);
    expect(v.capabilities).toHaveLength(productVocabulary().capabilities.length + 1);
    expect(v.capabilities.at(-1)).toMatchObject({ id: 'sms.send', company: true });
    expect(toolClass(SMS)).toEqual({ kind: 'classified', capability: 'sms.send', outward: true });
    expect(capabilityKind('sms.send')).toBe('send');
    expect(classifyCall(SMS, { to: '05321112233', text: 'x' }, DESK, ctx).parts).toEqual([expect.objectContaining({ kind: 'send', capability: 'sms.send' })]);
    expect(capabilityIds(['sms.send', 'email.read'], 'Yetenekler')).toEqual(['sms.send', 'email.read']);
    expect(coverage([], ['sms.send'])[0]).toMatchObject({ id: 'sms.send', status: 'missing' });
    // The product's own never changes, and no product capability names the company's tool.
    expect(productVocabulary().capabilities.some((c) => c.id === 'sms.send')).toBe(false);
    expect(productToolOwner(SMS)).toBeNull();
    expect(productToolOwner('mcp__claude_ai_jeeta__jeeta_reallocate_budget')).toBe('ads.manage');
  });

  it('kept until told: a change is seen after invalidateVocabulary (the service calls it on every change)', () => {
    let list = [sms()];
    useCompanyCapabilities(() => list);
    expect(toolClass(SMS).kind).toBe('classified');
    list = [];
    expect(toolClass(SMS).kind).toBe('classified');
    invalidateVocabulary();
    expect(toolClass(SMS)).toEqual({ kind: 'unclassified', outward: true });
    expect(classifyCall(SMS, {}, DESK, ctx).parts[0]).toMatchObject({ kind: 'other' });
    expect(classifyCall(SMS, {}, DESK, ctx).parts[0]).not.toHaveProperty('capability');
  });

  it('a session closes a company capability’s outward tools unless its role declares it; a read one stays open; a classified tool is no longer listed unclassified', () => {
    useCompanyCapabilities(() => [sms(), sms({ id: 'sms.read', kind: 'read', outward: false, tools: ['mcp__netgsm__inbox'] })]);
    expect(sessionDeny({ capabilities: [], seen: [], closedServers: [] })).toContain(SMS);
    expect(sessionDeny({ capabilities: ['sms.send'], seen: [], closedServers: [] })).not.toContain(SMS);
    expect(sessionDeny({ capabilities: [], seen: ['mcp__netgsm__inbox'], closedServers: [] })).not.toContain('mcp__netgsm__inbox');
    const desk: IntegrationDesk = { employeeId: 'a', name: 'Ada', deskIndex: 0, status: 'connected', raw: 'connected', tools: 3, toolNames: [SMS, 'mcp__netgsm__inbox', 'mcp__netgsm__balance'], seenAt: 1, open: true, closedBy: null };
    const netgsm: Integration = { name: 'netgsm', kind: 'local_mcp', status: 'connected', registryClosed: false, desks: [desk], capabilities: [], authNeeded: null, costNote: null, note: null, registeredBy: null, registeredAt: null, firstSeen: null, lastSeen: null };
    expect(unclassifiedTools([netgsm])).toEqual([expect.objectContaining({ server: 'netgsm', unclassified: ['mcp__netgsm__balance'], atLeast: 1 })]);
  });

  it('a pay kind is pay at the gate; a connector known by name only is known by its tool once the company classifies one', () => {
    useCompanyCapabilities(() => [sms({ id: 'sms.credits', kind: 'pay', tools: ['mcp__netgsm__buy_credits'] }), sms({ id: 'slack.send', tools: ['mcp__claude_ai_Slack__send_message'] })]);
    expect(classifyCall('mcp__netgsm__buy_credits', {}, DESK, ctx).parts[0]).toMatchObject({ kind: 'pay', capability: 'sms.credits' });
    expect(capabilityVocabulary().knownConnectors.map((k) => k.name)).toEqual(['claude.ai Google Drive']);
    useCompanyCapabilities(null);
    expect(capabilityVocabulary().knownConnectors.map((k) => k.name)).toEqual(['claude.ai Slack', 'claude.ai Google Drive']);
    expect(toolClass('mcp__netgsm__buy_credits')).toEqual({ kind: 'unclassified', outward: true });
  });

  it('the gate holds a classified outward tool as other when the vocabulary gives its capability no outward kind (read): never a part the system may handle', () => {
    // A company capability that disagrees with itself (kind read, outward true) is refused by the service; the gate still does not trust it.
    useCompanyCapabilities(() => [sms({ kind: 'read' })]);
    expect(toolClass(SMS)).toEqual({ kind: 'classified', capability: 'sms.send', outward: true });
    expect(classifyCall(SMS, {}, DESK, ctx).parts).toEqual([expect.objectContaining({ kind: 'other', capability: 'sms.send' })]);
  });
});
