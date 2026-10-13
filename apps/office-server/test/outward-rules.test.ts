import { describe, expect, it } from 'vitest';
import { DEFAULT_CONSTITUTION, type OutwardPolicyKind } from '@cc/shared';
import { outwardRule } from '../src/company/outward-rules.ts';
import { callSummary, contactKey, recipientsOf, specialContact } from '../src/company/recipients.ts';

describe('a call’s recipients and special contacts (spec capabilities §6)', () => {
  it('reads the recipient fields at any depth: lists, comma-separated text, objects of a list; each once', () => {
    expect(recipientsOf({ to: 'a@x.co, b@x.co; c@x.co', cc: ['d@x.co'], bcc: 'A@X.co', body: 'e@x.co' })).toEqual(['a@x.co', 'b@x.co', 'c@x.co', 'd@x.co']);
    expect(recipientsOf({ event: { attendees: [{ email: 'a@x.co' }, { email: 'b@x.co', displayName: 'B' }] } })).toEqual(['a@x.co', 'b@x.co']);
    expect(recipientsOf({ phone_numbers: [905321112233, '+90 533 000 00 00'], 'lead-ids': ['l1'] })).toEqual(['905321112233', '+90 533 000 00 00', 'l1']);
    expect(recipientsOf({ text: 'merhaba' })).toEqual([]);
    expect(recipientsOf('to=a@x.co')).toEqual([]);
  });

  it('a special contact’s key: an e-mail folded, a phone by its digits, else a user name without its @', () => {
    expect(contactKey(' Ali@Firma.com ')).toEqual({ kind: 'email', value: 'ali@firma.com' });
    expect(contactKey('+90 (532) 111 22 33')).toEqual({ kind: 'phone', value: '905321112233' });
    expect(contactKey('@AliVeli')).toEqual({ kind: 'handle', value: 'aliveli' });
    expect(contactKey('  ')).toBeNull();
  });

  it('review focus 2: a special contact written in another case or format is found anywhere in the input; a near one is not', () => {
    const contacts = ['Ali@Firma.com', '+90 (532) 111 22 33', '@AliVeli', 'İpek'];
    expect(specialContact({ to: 'ALI@firma.COM' }, contacts)).toBe('Ali@Firma.com');
    expect(specialContact({ message: { body: 'Sayın yetkili <ali@firma.com>,' } }, contacts)).toBe('Ali@Firma.com');
    expect(specialContact({ phone: '0532 111 22 33' }, contacts)).toBe('+90 (532) 111 22 33');
    expect(specialContact({ phone: 905321112233 }, contacts)).toBe('+90 (532) 111 22 33');
    expect(specialContact({ text: 'Merhaba @aliveli!' }, contacts)).toBe('@AliVeli');
    expect(specialContact({ to: 'IPEK' }, contacts)).toBe('İpek');
    expect(specialContact({ to: 'vali@firma.com', phone: '0532 111 22 34', text: 'aliveli2 ipekyolu' }, contacts)).toBeNull();
    expect(specialContact({ to: 'ali@firma.com' }, [])).toBeNull();
  });

  it('the summary the outbox keeps: the input without secret-looking fields, its first 300 characters', () => {
    expect(callSummary({ to: 'a@x.co', api_key: 'k', auth: { password: 'p', user: 'u' }, text: 'x' })).toBe('{"to":"a@x.co","auth":{"user":"u"},"text":"x"}');
    expect(callSummary({ text: 'y'.repeat(500) })).toHaveLength(300);
  });
});

describe('the rules the system keeps (spec capabilities §6)', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 13, h, m).getTime();
  const check = (input: unknown, kinds: OutwardPolicyKind[], o: { now?: number; counts?: Record<string, number>; rules?: Partial<typeof DEFAULT_CONSTITUTION> } = {}) => {
    const asked: Array<[string, number]> = [];
    const rule = outwardRule({
      input, kinds, rules: { ...DEFAULT_CONSTITUTION, ...o.rules }, now: o.now ?? at(11),
      count: (k, since) => {
        asked.push([k.join('+'), since]);
        return o.counts?.[k.join('+')] ?? 0;
      },
    });
    return { rule, asked };
  };

  it('review focus 1: a mail to six people (to, cc and bcc together) is a bulk send above 5; to five it passes', () => {
    const six = Array.from({ length: 6 }, (_, i) => `k${i}@x.co`);
    expect(check({ to: six }, ['send']).rule).toBe('toplu gönderim: 6 alıcı > 5');
    expect(check({ to: six.slice(0, 3), bcc: six.slice(3) }, ['send']).rule).toBe('toplu gönderim: 6 alıcı > 5');
    expect(check({ to: six.slice(0, 2).join(','), cc: six.slice(2, 5) }, ['send']).rule).toBeNull();
  });

  it('a special contact comes first', () => {
    expect(check({ to: ['ALI@firma.com', 'b@x.co'] }, ['send'], { rules: { specialContacts: ['ali@firma.com'] }, counts: { 'send+publish': 99 } }).rule).toBe('özel kişi: ali@firma.com');
  });

  it('calls: only in the call hours (local), at most callsPerDay a day counted from midnight', () => {
    expect(check({ phone: '0532' }, ['call'], { now: at(21, 40) }).rule).toBe('mesai dışı arama (21:40)');
    expect(check({ phone: '0532' }, ['call'], { now: at(8, 59) }).rule).toBe('mesai dışı arama (08:59)');
    expect(check({ phone: '0532' }, ['call'], { now: at(19, 0) }).rule).toBe('mesai dışı arama (19:00)');
    const ok = check({ phone: '0532' }, ['call'], { now: at(9, 0) });
    expect(ok).toEqual({ rule: null, asked: [['call', at(0)]] });
    expect(check({ phone: '0532' }, ['call'], { counts: { call: 20 } }).rule).toBe('günlük arama sınırı (20) doldu');
  });

  it('sends and publishes together: at most sendsPerHour in the last hour; an invitation counts against neither counter', () => {
    const r = check({ to: 'a@x.co' }, ['send'], { counts: { 'send+publish': 29 } });
    expect(r).toEqual({ rule: null, asked: [['send+publish', at(11) - 3_600_000]] });
    expect(check({ post_id: 'p' }, ['publish'], { counts: { 'send+publish': 30 } }).rule).toBe('saatlik gönderim sınırı (30) doldu');
    expect(check({ to: 'a@x.co' }, ['send'], { rules: { sendsPerHour: 0 } }).rule).toBe('saatlik gönderim sınırı (0) doldu');
    expect(check({ attendees: ['a@x.co'] }, ['calendar'], { counts: { 'send+publish': 99, call: 99 } })).toEqual({ rule: null, asked: [] });
  });
});
