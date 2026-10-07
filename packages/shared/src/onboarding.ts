/**
 * The onboarding (B1): the questions that turn the owner's one sentence into the company profile, asked in blocks
 * (spec 2026-10-08-onboarding-design). Product knowledge: ships with the office, never written to the database.
 */
import type { ProfileFields, ProfileSection } from './profile.ts';

export interface OnboardingQuestion {
  id: string;
  section: ProfileSection;
  /** The profile fields it fills; any one filled answers it. */
  fields: string[];
  text: string;
  /** The ten required ones make the profile enough to set the office up (KÖ1: ≤ 10 questions). */
  required: boolean;
}

const q = (id: string, section: ProfileSection, fields: string[], text: string, required: boolean): OnboardingQuestion => ({ id, section, fields, text, required });

/** Required first and in the order they are asked (two blocks of five), then the optional ones. */
export const ONBOARDING_QUESTIONS: readonly OnboardingQuestion[] = [
  q('name', 'identity', ['name'], 'Firmanızın adı ne?', true),
  q('sector', 'identity', ['sector'], 'Hangi sektörde çalışıyorsunuz?', true),
  q('products', 'offer', ['products'], 'Ne satıyorsunuz ya da hangi hizmetleri veriyorsunuz?', true),
  q('segments', 'customers', ['segments'], 'Müşterileriniz kimler (tür ve yaklaşık sayı)?', true),
  q('channels', 'customers', ['channels'], 'Müşteriler size nereden geliyor, hangi kanallarda çalışıyorsunuz?', true),
  q('goals', 'goals', ['goals'], 'Önümüzdeki 1–3 ayda neyi başarmak istiyorsunuz?', true),
  q('success', 'success', ['done'], 'Hangi durumda “bu ofis işe yaradı” dersiniz?', true),
  q('tools', 'tools', ['email', 'social', 'payment', 'accounting', 'ecommerce', 'other'], 'Hangi hesap ve araçları kullanıyorsunuz (e-posta, sosyal medya, ödeme, muhasebe, e-ticaret)?', true),
  q('budget', 'constraints', ['budget'], 'Araç, abonelik ve reklam için aylık ne kadar harcanabilir?', true),
  q('limits', 'constraints', ['other'], 'Ofisin sizden onaysız yapmaması gereken işler var mı?', true),
  q('pricing', 'offer', ['pricing'], 'Fiyatlandırmanız nasıl?', false),
  q('platforms', 'customers', ['platforms'], 'Hangi platformlarda satış ya da yayın yapıyorsunuz?', false),
  q('brandVoice', 'constraints', ['brandVoice'], 'Marka diliniz nasıl olmalı?', false),
  q('legal', 'constraints', ['legal'], 'Uymanız gereken yasal kurallar var mı (KVKK vb.)?', false),
  q('timezone', 'constraints', ['timezone'], 'Hangi saat diliminde çalışıyorsunuz?', false),
  q('country', 'identity', ['country'], 'Hangi ülkede, hangi şehirde çalışıyorsunuz?', false),
  q('languages', 'identity', ['languages'], 'Hangi dillerde iş yapıyorsunuz?', false),
  q('kpis', 'goals', ['kpis'], 'Hedeflerinizi hangi sayılarla ölçersiniz?', false),
];

/** At most this many questions in one message to the owner (hedef mimari A1). */
export const ONBOARDING_BLOCK = 5;
/** A question still unanswered after this many asks is filled by assumption, not asked again (A1). */
export const ONBOARDING_MAX_ASKS = 2;

/** From the profile: none of its fields filled; filled but one of them an assumption; filled by the owner's word. */
export type OnboardingQuestionState = 'open' | 'assumed' | 'answered';

export interface OnboardingRound {
  round: number;
  questions: string[];
  askedAt: number;
  /** The owner replied after it (a chat message to the coordinator or answers on screen): only then it counts as asked. */
  replied: boolean;
}

export interface Onboarding {
  id: string;
  /** The owner's one sentence. */
  description: string;
  status: 'active' | 'done';
  startedBy: string;
  startedAt: number;
  finishedAt: number | null;
  rounds: OnboardingRound[];
}

export interface OnboardingQuestionView extends OnboardingQuestion {
  state: OnboardingQuestionState;
  /** How many rounds of this onboarding asked it and got a reply from the owner. */
  asked: number;
  /** Its fields as the profile holds them now. */
  value: ProfileFields;
}

export interface OnboardingView {
  /** The running onboarding, else the last one; null before the first. */
  onboarding: Onboarding | null;
  questions: OnboardingQuestionView[];
  /** No required question is open (assumptions allowed, and marked in the profile). */
  complete: boolean;
}

export type OnboardingChange = 'started' | 'round' | 'answered' | 'finished';
