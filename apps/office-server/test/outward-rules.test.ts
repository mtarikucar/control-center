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

  it('a special contact that is a name (spaces in it) is found as a whole phrase: folded, runs of whitespace as one, at word boundaries, in any string of the input', () => {
    expect(contactKey('  Ahmet   Yılmaz ')).toEqual({ kind: 'handle', value: 'ahmet yilmaz' });
    const contacts = ['Ahmet Yılmaz', 'ipek kaya', 'ACME Ltd.'];
    expect(specialContact({ to: 'ahmet  YILMAZ <a@x.co>' }, contacts)).toBe('Ahmet Yılmaz');
    expect(specialContact({ message: { body: 'Merhaba ahmet \n YILMAZ bey,' } }, contacts)).toBe('Ahmet Yılmaz');
    expect(specialContact({ to: ['İPEK KAYA'] }, contacts)).toBe('ipek kaya');
    expect(specialContact({ text: 'Teklif: Acme Ltd. adına' }, contacts)).toBe('ACME Ltd.');
    expect(specialContact({ text: 'acme ltd' }, contacts)).toBe('ACME Ltd.');
    // Not the same person or company: a longer or a joined word, another first name, the words in two fields.
    expect(specialContact({ to: 'Ahmet Yılmazoğlu' }, contacts)).toBeNull();
    expect(specialContact({ to: 'Mahmet Yılmaz', text: 'ipek kayalar, acme ltdsti' }, contacts)).toBeNull();
    expect(specialContact({ first: 'Ahmet', last: 'Yılmaz' }, contacts)).toBeNull();
    // A name is found again after a near miss earlier in the same string.
    expect(specialContact({ text: 'Mahmet Yılmaz ve Ahmet Yılmaz' }, contacts)).toBe('Ahmet Yılmaz');
  });

  it('the summary the outbox keeps: the input without secret-looking fields, its first 300 characters', () => {
    expect(callSummary({ to: 'a@x.co', api_key: 'k', auth: { password: 'p', user: 'u' }, text: 'x' })).toBe('{"to":"a@x.co","auth":{"user":"u"},"text":"x"}');
    expect(callSummary({ text: 'y'.repeat(500) })).toHaveLength(300);
    // By code point, as the outbox keeps it: an emoji across the 300th place is whole or gone, never half.
    expect(callSummary(`${'y'.repeat(299)}😀z`)).toBe(`${'y'.repeat(299)}😀`);
    expect(callSummary(`${'y'.repeat(300)}😀`)).toBe('y'.repeat(300));
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

  it('final review C1: a send whose recipients the input cannot show — a draft sent by its id, a reply to everyone — is held; a reply to one is not', () => {
    const hidden = 'alıcılar girdide yok (taslak / hepsini yanıtla)';
    expect(check({ draftId: 'r-123' }, ['send'])).toEqual({ rule: hidden, asked: [] });
    // The key folded, at any depth, whatever stands beside it: a `to` the draft ignores counts for nothing.
    expect(check({ message: { Draft_ID: 'r-1' }, to: ['x@y.co'] }, ['send']).rule).toBe(hidden);
    expect(check({ 'draft-id': '' }, ['send']).rule).toBe(hidden);
    expect(check({ messageId: 'm1', replyAll: true, body: 'Teşekkürler' }, ['send']).rule).toBe(hidden);
    expect(check({ options: { reply_all: 'TRUE' } }, ['send']).rule).toBe(hidden);
    expect(check({ messageId: 'm1', replyAll: false, body: 'x' }, ['send']).rule).toBeNull();
    expect(check({ messageId: 'm1', body: 'x' }, ['send']).rule).toBeNull();
    // Only a send: a post published from its draft goes to no one's mailbox.
    expect(check({ draftId: 'd1' }, ['publish']).rule).toBeNull();
    // A special contact named in it is still the first reason.
    expect(check({ draftId: 'd1', note: 'ali@firma.com' }, ['send'], { rules: { specialContacts: ['ali@firma.com'] } }).rule).toBe('özel kişi: ali@firma.com');
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

  it('review I6: the order, pairwise — with both rules broken and the counters at their limits, the earlier rule is the reason', () => {
    const six = Array.from({ length: 6 }, (_, i) => `k${i}@x.co`);
    const full = { counts: { call: 20, 'send+publish': 30 } };
    const late = at(21, 40);
    // An input not read to its end, before the special contact in it.
    let deep: unknown = 'x';
    for (let i = 0; i < 100; i += 1) deep = [deep];
    expect(check({ to: 'ali@firma.com', deep }, ['send'], { rules: { specialContacts: ['ali@firma.com'] } }).rule).toBe('okunamayan girdi: çok derin ya da çok büyük');
    // Special contact before bulk.
    expect(check({ to: [...six, 'ali@firma.com'] }, ['send'], { ...full, rules: { specialContacts: ['ali@firma.com'] } }).rule).toBe('özel kişi: ali@firma.com');
    // Bulk before the call hours.
    expect(check({ phones: six }, ['call'], { ...full, now: late })).toEqual({ rule: 'toplu gönderim: 6 alıcı > 5', asked: [] });
    // The call hours before the day's calls.
    expect(check({ phone: '0532' }, ['call'], { ...full, now: late })).toEqual({ rule: 'mesai dışı arama (21:40)', asked: [] });
    // The day's calls before the hour's sends.
    expect(check({ phone: '0532', to: 'a@x.co' }, ['call', 'send'], full)).toEqual({ rule: 'günlük arama sınırı (20) doldu', asked: [['call', at(0)]] });
  });

  it('a calendar invitation keeps the special contacts and the bulk threshold, and never reads a counter', () => {
    const counts = { 'send+publish': 99, call: 99 };
    expect(check({ attendees: ['IPEK@firma.com'] }, ['calendar'], { counts, rules: { specialContacts: ['ipek@firma.com'] } })).toEqual({ rule: 'özel kişi: ipek@firma.com', asked: [] });
    const six = Array.from({ length: 6 }, (_, i) => ({ email: `k${i}@x.co` }));
    expect(check({ event: { attendees: six } }, ['calendar'], { counts })).toEqual({ rule: 'toplu gönderim: 6 alıcı > 5', asked: [] });
    expect(check({ event: { attendees: six.slice(1) } }, ['calendar'], { counts, now: at(23) })).toEqual({ rule: null, asked: [] });
  });

  it('callsPerDay 0: the system never calls, not even the day’s first', () => {
    expect(check({ phone: '0532' }, ['call'], { rules: { callsPerDay: 0 } })).toEqual({ rule: 'günlük arama sınırı (0) doldu', asked: [['call', at(0)]] });
  });

  it('a call with a call and a send part keeps both counters: the day’s calls from midnight, then the hour’s sends', () => {
    const both: OutwardPolicyKind[] = ['call', 'send'];
    expect(check({ phone: '0532', to: 'a@x.co' }, both, { counts: { call: 19, 'send+publish': 29 } })).toEqual({ rule: null, asked: [['call', at(0)], ['send+publish', at(11) - 3_600_000]] });
    expect(check({ phone: '0532', to: 'a@x.co' }, both, { counts: { call: 19, 'send+publish': 30 } }).rule).toBe('saatlik gönderim sınırı (30) doldu');
    expect(check({ phone: '0532', to: 'a@x.co' }, both, { now: at(8) }).rule).toBe('mesai dışı arama (08:00)');
  });
});

describe('reading a call’s input: linear, complete, never a throw (Task 7 review C1, I2–I5)', () => {
  const rule = (input: unknown, kinds: OutwardPolicyKind[] = ['send']) =>
    outwardRule({ input, kinds, rules: DEFAULT_CONSTITUTION, now: new Date(2026, 9, 13, 11).getTime(), count: () => 0 });
  const nest = (depth: number, leaf: unknown, wrap: (v: unknown) => unknown) => {
    let v = leaf;
    for (let i = 0; i < depth; i += 1) v = wrap(v);
    return v;
  };

  it('C1: the work is linear in the input — inputs that made the old patterns backtrack finish at once', () => {
    const contacts = ['Ali@Firma.com', '+90 (532) 111 22 33', '111 22 33', '@AliVeli', 'Ahmet Yılmaz'];
    for (const text of ['a@'.repeat(5000), 'A'.repeat(200_000), 'QUJD'.repeat(50_000), '1 '.repeat(100_000), 'a.'.repeat(100_000)]) {
      const started = performance.now();
      expect(specialContact({ body: text, to: text }, contacts)).toBeNull();
      expect(recipientsOf({ to: text })).toHaveLength(1);
      // Each takes a few milliseconds (well under 200); a second leaves room for a slow machine, not for backtracking.
      expect(performance.now() - started, text.slice(0, 8)).toBeLessThan(1000);
    }
  });

  it('hardening round 2: phones are scanned once against the contacts’ own numbers and stop at the first found — a megabyte of spaced digits in well under 300 ms', () => {
    const contacts = Array.from({ length: 100 }, (_, i) => `+90 532 ${String(i).padStart(3, '0')} 22 33`);
    const body = '1 '.repeat(500_000);
    const started = performance.now();
    expect(specialContact({ body }, [...contacts, '111 22 33'])).toBeNull();
    // Measured at a few tens of milliseconds; 300 leaves room for a loaded machine, not for a per-candidate copy.
    expect(performance.now() - started).toBeLessThan(300);
    // The one found, wherever it is in the owner's list; an e-mail before the phones is still tried first.
    expect(specialContact({ body: `${body}Ara: 0532 042 22 33` }, contacts)).toBe('+90 532 042 22 33');
    expect(specialContact({ to: 'ali@firma.com', phone: '05320422233' }, ['ali@firma.com', ...contacts])).toBe('ali@firma.com');
    // One number written twice in the owner's list: as it was first written.
    expect(specialContact({ phone: '05321112233' }, ['0532 111 22 33', '+90 532 111 22 33'])).toBe('0532 111 22 33');
    // Of two phones, the one the text has first.
    expect(specialContact({ text: '0532 111 22 33 ve 0532 000 00 00' }, ['+90 532 000 00 00', '+90 532 111 22 33'])).toBe('+90 532 111 22 33');
  });

  it('I2: an e-mail is found beside any punctuation, in a link or a query, with its own apostrophe; not inside a longer address', () => {
    const contacts = ['Ali@Firma.com', "o'brien@x.com"];
    const found = ['ali@firma.com!', 'ali@firma.com?', '[ali@firma.com]', '**ali@firma.com**', '“ali@firma.com”', 'ali@firma.com/', 'mailto:ali@firma.com?subject=x', '?to=ali@firma.com&subject=x', 'Yazın: ALI@firma.com.'];
    for (const text of found) expect(specialContact({ text }, contacts), text).toBe('Ali@Firma.com');
    expect(specialContact({ to: "O'Brien@X.com" }, contacts)).toBe("o'brien@x.com");
    for (const text of ['xali@firma.com', 'ali@firma.company', 'ali@firma.com.tr', 'veli.ali@firma.com', 'ali@firma.com2']) expect(specialContact({ text }, contacts), text).toBeNull();
  });

  it('I3: a phone is read line by line, as its own spaced groups — never merged with the next line’s number or with text after it', () => {
    const contacts = ['+90 (532) 111 22 33'];
    const found = ['0532 111 22 33\n0533 000 00 00', '0533 000 00 00\r\n0532-111-22-33', 'Ara: 0532 111 22 33 2 kez', '… 0532 111 22 33 14:30', 'Numaralar: 0533 000 00 00 ve 0532.111.22.33', '00905321112233', '532 111 22 33'];
    for (const text of found) expect(specialContact({ text }, contacts), text).toBe('+90 (532) 111 22 33');
    expect(specialContact({ phone: 905321112233 }, contacts)).toBe('+90 (532) 111 22 33');
    for (const text of ['0532 111 22 34', '0532 111 22\n33', '0532 111 22 no 33']) expect(specialContact({ text }, contacts), text).toBeNull();
    // A local number without its area code is a whole group sequence of its own.
    expect(specialContact({ text: 'Santral: 111 22 33.' }, ['111 22 33'])).toBe('111 22 33');
    expect(specialContact({ text: 'Dahili 111 22 33 44' }, ['111 22 33 44'])).toBe('111 22 33 44');
    expect(specialContact({ text: '1112234' }, ['111 22 33'])).toBeNull();
  });

  it('I4: recipients under a recipient field that is an object are read from it: its lists, an address deeper down, the first who-field that is filled', () => {
    const six = ['a@x.co', 'b@x.co', 'c@x.co', 'd@x.co', 'e@x.co', 'f@x.co'];
    expect(recipientsOf({ recipients: { to: six.slice(0, 3), cc: six.slice(3) } })).toEqual(six);
    expect(rule({ message: { recipients: { to: six.slice(0, 3), cc: six.slice(3) } } })).toBe('toplu gönderim: 6 alıcı > 5');
    expect(recipientsOf({ message: { to: [{ emailAddress: { name: 'Ali', address: 'a@x.co' } }] } })).toEqual(['a@x.co']);
    expect(recipientsOf({ contacts: [{ email: '', phone: '0532 111 22 33', name: 'Ali' }, { email: ' ', id: 7 }] })).toEqual(['0532 111 22 33', '7']);
  });

  it('I5: an input too deep or too big is not read but held for the owner — never a RangeError; the outbox’s summary of it does not throw', () => {
    const reason = 'okunamayan girdi: çok derin ya da çok büyük';
    const deep = [nest(5000, 'a@x.co', (v) => [v]), nest(10_000, 'a@x.co', (v) => ({ x: v })), { to: nest(5000, 'a@x.co', (v) => [v]) }];
    for (const input of deep) {
      expect(rule(input)).toBe(reason);
      expect(rule(input, ['call'])).toBe(reason);
      expect(() => recipientsOf(input)).not.toThrow();
      expect(() => specialContact(input, ['a@x.co'])).not.toThrow();
      expect(callSummary(input).length).toBeLessThanOrEqual(300);
    }
    // At most 64 levels below the input and 10 000 values in all: the root, the list and 9 998 addresses are read.
    expect(rule({ to: nest(63, 'a@x.co', (v) => [v]) })).toBeNull();
    expect(rule({ to: nest(64, 'a@x.co', (v) => [v]) })).toBe(reason);
    const many = (n: number) => ({ to: Array.from({ length: n }, (_, i) => `k${i}@x.co`) });
    expect(rule(many(9_998))).toBe('toplu gönderim: 9998 alıcı > 5');
    expect(rule(many(9_999))).toBe(reason);
  });

  it('minor 8: a user name is found beside quotes, emphasis, brackets, a link’s slash, a suffix after an apostrophe or a dash; not inside a longer name or an address', () => {
    const contacts = ['@AliVeli', 'İpek'];
    for (const text of ['“@aliveli”', '**@aliveli**', '[@aliveli]', '@AliVeli: merhaba', 'x.com/aliveli', 'aliveli.']) expect(specialContact({ text }, contacts), text).toBe('@AliVeli');
    for (const text of ['İpek’e', "ipek'e", 'ipek—ali', '(IPEK)']) expect(specialContact({ text }, contacts), text).toBe('İpek');
    for (const text of ['aliveli2', 'aliveli_bot', 'aliveli@x.com', 'veli.aliveli', 'aliveli.tr', 'ipekyolu', 'ipek-ali']) expect(specialContact({ text }, contacts), text).toBeNull();
  });
});
