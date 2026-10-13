import type { Constitution, OutwardPolicyKind } from '@cc/shared';
import { hiddenRecipients, readable, recipientsOf, specialContact } from './recipients.ts';

const HOUR = 60 * 60_000;
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export interface OutwardCall {
  input: unknown;
  /** The kinds of the call's parts, each one the owner's policy leaves to the system. */
  kinds: readonly OutwardPolicyKind[];
  rules: Pick<Constitution, 'specialContacts' | 'bulkRecipients' | 'callHours' | 'sendsPerHour' | 'callsPerDay'>;
  now: number;
  /** Calls of these kinds the system let out since `since`, in the caller's department (alone, without one). */
  count: (kinds: readonly OutwardPolicyKind[], since: number) => number;
}

/**
 * The rule a call the system would let out breaks, in Turkish — the held call's reason —, or null (spec capabilities
 * §6). Cheapest first: the counters are read only for a call that could still pass. A limit is reached at `>=`. An
 * input too deep or too big to read to its end may hide a contact or a recipient: it is the owner's (review I5); so is
 * a send whose recipients its input does not show (final review C1).
 */
export function outwardRule(c: OutwardCall): string | null {
  if (!readable(c.input)) return 'okunamayan girdi: çok derin ya da çok büyük';
  const special = specialContact(c.input, c.rules.specialContacts);
  if (special) return `özel kişi: ${special}`;
  // A draft sent by its id, a reply to everyone: whom it reaches is not in the call (final review C1).
  if (c.kinds.includes('send') && hiddenRecipients(c.input)) return 'alıcılar girdide yok (taslak / hepsini yanıtla)';
  const recipients = recipientsOf(c.input).length;
  if (recipients > c.rules.bulkRecipients) return `toplu gönderim: ${recipients} alıcı > ${c.rules.bulkRecipients}`;
  if (c.kinds.includes('call')) {
    const at = new Date(c.now);
    const minute = at.getHours() * 60 + at.getMinutes();
    const [from, to] = c.rules.callHours;
    if (minute < from * 60 || minute >= to * 60) return `mesai dışı arama (${hhmm(at)})`;
    const midnight = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
    if (c.count(['call'], midnight) >= c.rules.callsPerDay) return `günlük arama sınırı (${c.rules.callsPerDay}) doldu`;
  }
  if (c.kinds.some((k) => k === 'send' || k === 'publish') && c.count(['send', 'publish'], c.now - HOUR) >= c.rules.sendsPerHour) {
    return `saatlik gönderim sınırı (${c.rules.sendsPerHour}) doldu`;
  }
  return null;
}
