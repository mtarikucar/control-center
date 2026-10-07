import {
  ONBOARDING_BLOCK, ONBOARDING_MAX_ASKS, ONBOARDING_QUESTIONS, type CompanyProfile, type Onboarding, type OnboardingQuestionView, type OnboardingView, type ProfileSection,
} from '@cc/shared';
import { ValidationError } from '../errors.ts';

/** Each question's state, read from the profile, and how often this onboarding asked it (spec 2026-10-08-onboarding-design §2). */
export function onboardingView(profile: CompanyProfile, onboarding: Onboarding | null): OnboardingView {
  const questions = ONBOARDING_QUESTIONS.map((q): OnboardingQuestionView => {
    const entry = profile.sections[q.section];
    const filled = q.fields.filter((f) => entry?.fields[f] !== undefined);
    const state = filled.length === 0 ? 'open' : filled.some((f) => entry!.assumedFields.includes(f)) ? 'assumed' : 'answered';
    // Asked = a round with it that the owner replied to; a block shown again before any reply is not asking twice.
    const asked = onboarding?.rounds.filter((r) => r.replied && r.questions.includes(q.id)).length ?? 0;
    return { ...q, fields: [...q.fields], state, asked, value: Object.fromEntries(filled.map((f) => [f, entry!.fields[f]!])) };
  });
  return { onboarding, questions, complete: questions.every((v) => !v.required || v.state !== 'open') };
}

/**
 * What to ask next: the questions still open or only assumed, asked fewer than ONBOARDING_MAX_ASKS times, in order,
 * at most ONBOARDING_BLOCK — the required ones first; the optional ones only when asked for and the required are in.
 * `assume`: required questions asked that often and still open — fill them by assumption, never ask them again.
 */
export function nextBlock(view: OnboardingView, optional: boolean): { ask: OnboardingQuestionView[]; assume: OnboardingQuestionView[] } {
  const pending = view.questions.filter((v) => v.state !== 'answered' && v.asked < ONBOARDING_MAX_ASKS);
  const required = pending.filter((v) => v.required);
  const pool = required.length > 0 ? required : optional && view.complete ? pending : [];
  return {
    ask: pool.slice(0, ONBOARDING_BLOCK),
    assume: view.questions.filter((v) => v.required && v.state === 'open' && v.asked >= ONBOARDING_MAX_ASKS),
  };
}

/** The owner's answers ({question id: value}) as one patch per profile section; every id and field checked. */
export function answerPatches(answers: unknown): { ids: string[]; patches: Map<ProfileSection, Record<string, unknown>> } {
  if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) throw new ValidationError("Onboarding: cevaplar (answers) soru id'si → değer nesnesi olmalı.");
  const ids = Object.keys(answers);
  if (ids.length === 0) throw new ValidationError('En az bir cevap ver.');
  const patches = new Map<ProfileSection, Record<string, unknown>>();
  for (const id of ids) {
    const q = ONBOARDING_QUESTIONS.find((x) => x.id === id);
    if (!q) throw new ValidationError(`Bilinmeyen onboarding sorusu: ${id}. Sorular: ${ONBOARDING_QUESTIONS.map((x) => x.id).join(', ')}.`);
    const value = (answers as Record<string, unknown>)[id];
    const patch = patches.get(q.section) ?? {};
    if (q.fields.length === 1) patch[q.fields[0]!] = value;
    else {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ValidationError(`“${id}” birden çok alana yazılır: {${q.fields.join(', ')}} gibi bir nesne ver.`);
      for (const [field, v] of Object.entries(value)) {
        if (!q.fields.includes(field)) throw new ValidationError(`“${id}” sorusunun alanı değil: ${field}. Alanları: ${q.fields.join(', ')}.`);
        patch[field] = v;
      }
    }
    patches.set(q.section, patch);
  }
  return { ids, patches };
}

const SUFFIX: Record<number, string> = { 0: 'ı', 1: 'i', 2: 'si', 3: 'ü', 4: 'ü', 5: 'i', 6: 'sı', 7: 'si', 8: 'i', 9: 'u' };
const TENS: Record<number, string> = { 10: 'u', 20: 'si', 30: 'u', 40: 'ı', 50: 'si', 60: 'ı', 70: 'i', 80: 'i', 90: 'ı' };
/** "8’i", "2’si", "10’u": a count of them, with the Turkish suffix it takes. */
export const ofThem = (n: number): string => `${n}’${n % 10 !== 0 ? SUFFIX[n % 10] : n === 0 ? SUFFIX[0] : (TENS[n % 100] ?? 'ü')}`;

const shown = (v: OnboardingQuestionView): string => {
  const values = Object.entries(v.value).map(([f, x]) => [f, Array.isArray(x) ? x.join(', ') : x]);
  return v.fields.length === 1 ? (values[0]?.[1] ?? '') : values.map(([f, x]) => `${f}: ${x}`).join('; ');
};

export function tally(view: OnboardingView): string {
  const req = view.questions.filter((v) => v.required);
  const count = (s: string) => req.filter((v) => v.state === s).length;
  return `zorunlu ${req.length} sorunun ${ofThem(count('answered'))} sahibinden, ${ofThem(count('assumed'))} varsayım, ${ofThem(count('open'))} açık`;
}

/**
 * What onboardingNext (mode 'next') and onboardingRead (mode 'read') say: where it stands, the block to ask now or
 * still waiting for the owner (with the guesses to confirm), what to assume.
 */
export function nextText(
  plan: { view: OnboardingView; ask: OnboardingQuestionView[]; assume: OnboardingQuestionView[]; round: { round: number } | null; waiting: boolean },
  mode: 'next' | 'read' = 'next',
): string {
  const { view, ask, assume } = plan;
  const block = { ask, assume };
  const lines = [`Onboarding: ${tally(view)}.`];
  if (mode === 'read') lines.push('Salt okunur: hiçbir tur kaydedilmedi.');
  if (block.ask.length > 0) {
    const n = plan.round?.round ?? (view.onboarding?.rounds.length ?? 0) + 1;
    const head =
      mode === 'read'
        ? plan.waiting ? `Tur ${n} sahibinin cevabını bekliyor:` : `Sıradaki tur (${n}) şunları soracak:`
        : plan.waiting ? `Tur ${n} henüz cevaplanmadı — aynı soruları sor ya da sahibinin cevabını bekle (yeni tur açılmadı):` : `Tur ${n} — sahibine tek mesajda sor:`;
    lines.push('', head);
    block.ask.forEach((v, i) => lines.push(`${i + 1}. ${v.text}${v.state === 'assumed' ? ` (şu an varsayım: ${shown(v)}; doğru mu?)` : ''}`));
    lines.push('', "Cevapları profileUpdate ile yaz: sahibinin söylediği assumed: false. Sahibi ekrandan da cevaplayabilir; o zaman sana bildirim gelir.");
  }
  if (block.assume.length > 0) {
    lines.push('', 'İki kez sorulup cevapsız kaldı — varsayımla doldur (profileUpdate, assumed: true):');
    for (const v of block.assume) lines.push(`• ${v.id} → ${v.fields.map((f) => `${v.section}.${f}`).join(' | ')}: ${v.text}`);
  }
  if (block.ask.length === 0) {
    const assumed = view.questions.filter((v) => v.required && v.state === 'assumed').map((v) => v.id);
    lines.push(
      '',
      view.complete
        ? `Zorunlu sorular tamam${assumed.length ? ` (varsayım: ${assumed.join(', ')})` : ''}. onboardingFinish ile bitir; isteğe bağlı sorular için onboardingNext(optional: true).`
        : 'Sorulacak soru kalmadı: yukarıdakileri varsayımla doldur, sonra onboardingFinish.',
    );
  }
  return lines.join('\n');
}
