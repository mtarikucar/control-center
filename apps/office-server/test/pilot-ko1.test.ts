import { describe, expect, it } from 'vitest';
import { splitOnboardingRounds } from '../src/pilot-metrics.ts';
import { pilotKo1 } from './pilot-harness.ts';

/**
 * The pilot test's KÖ1 (pilotKo1, pilot.smoke.real.test.ts step 2) by the same rule as pilotMetrics (decision 2908968d):
 * the required rounds only; an optional round is reported apart. At K1, and on the five C5-4 attempts that reached the
 * onboarding, recounted from their K3 records (outputs/pilot-k3), no claude run.
 */
const RECORDS = [
  { run: 2, file: 'kayit-kosu2-dosya-maddeleri.md', line: '- tur 2 (≤ 2), soru 10 (≤ 10): name, sector, products, segments, channels | goals, success, tools, budget, limits' },
  { run: 3, file: 'kayit-kosu3-kö1.md', line: '- tur 3 (≤ 2), soru 15 (≤ 10): name, sector, products, segments, channels | goals, success, tools, budget, limits | pricing, platforms, brandVoice, legal, timezone' },
  { run: 5, file: 'kayit-kosu5-core-on-main.md', line: '- tur 3 (≤ 2), soru 15 (≤ 10): name, sector, products, segments, channels | goals, success, tools, budget, limits | pricing, platforms, brandVoice, legal, timezone' },
  { run: 6, file: 'kayit-kosu6-core-on-main.md', line: '- tur 3 (≤ 2), soru 15 (≤ 10): name, sector, products, segments, channels | goals, success, tools, budget, limits | pricing, platforms, brandVoice, legal, timezone' },
  { run: 7, file: 'kayit-kosu7-core-on-main.md', line: '- tur 2 (≤ 2), soru 10 (≤ 10): name, sector, products, segments, channels | goals, success, tools, budget, limits' },
];

/** A record's rounds line (the questions of each round as asked, rounds split by “ | ”). */
const roundsOf = (line: string) => line.slice(line.indexOf(': ') + 2).split(' | ').map((r) => ({ questions: r.split(', ') }));

describe('pilot test’s KÖ1: the required rounds only, the optional round apart (K1)', () => {
  it('two required rounds and an optional one: KÖ1 holds, the optional round is reported', () => {
    const ko1 = pilotKo1(roundsOf(RECORDS[1]!.line));
    expect(ko1.met).toBe(true);
    expect(ko1.measured).toBe('onboarding 2 zorunlu tur, 10 soru (eşik ≤ 2 tur, ≤ 10 soru)');
    expect(ko1.optional).toBe('isteğe bağlı 1 tur, 5 soru (KÖ1’e sayılmaz)');
    expect(ko1.line).toBe('zorunlu tur 2 (≤ 2), soru 10 (≤ 10): name, sector, products, segments, channels | goals, success, tools, budget, limits; isteğe bağlı tur 1, soru 5: pricing, platforms, brandVoice, legal, timezone');
  });

  it('a third required round or an eleventh required question still fails it; an unknown question counts as required', () => {
    const required = roundsOf(RECORDS[0]!.line);
    expect(pilotKo1([...required, { questions: ['name'] }]).met).toBe(false);
    expect(pilotKo1([{ questions: [...required[0]!.questions, 'goals'] }, required[1]!]).met).toBe(false);
    expect(splitOnboardingRounds([{ questions: ['pricing', 'x'] }]).optional).toEqual([]);
    expect(splitOnboardingRounds([{ questions: [] }]).optional).toEqual([]);
  });

  it('the five C5-4 attempts recounted from their records: KÖ1 held in 2 of 5 as counted then, in 5 of 5 by the required rounds', () => {
    const table = RECORDS.map(({ run, line }) => {
      const rounds = roundsOf(line);
      const asked = rounds.reduce((n, r) => n + r.questions.length, 0);
      const before = rounds.length <= 2 && asked <= 10;
      const ko1 = pilotKo1(rounds);
      const { required, optional } = splitOnboardingRounds(rounds);
      return { run, before, required: required.length, questions: required.reduce((n, r) => n + r.questions.length, 0), optional: optional.length, after: ko1.met };
    });
    expect(table).toEqual([
      { run: 2, before: true, required: 2, questions: 10, optional: 0, after: true },
      { run: 3, before: false, required: 2, questions: 10, optional: 1, after: true },
      { run: 5, before: false, required: 2, questions: 10, optional: 1, after: true },
      { run: 6, before: false, required: 2, questions: 10, optional: 1, after: true },
      { run: 7, before: true, required: 2, questions: 10, optional: 0, after: true },
    ]);
  });
});
