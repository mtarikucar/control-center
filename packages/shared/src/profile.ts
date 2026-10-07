/**
 * The company profile (B2): what the company is, in sections the office can query — blueprints, role templates and
 * KPIs read known fields, not free text. Spec: docs/superpowers/specs/2026-10-08-company-profile-design.md.
 */

export const PROFILE_SECTIONS = ['identity', 'offer', 'customers', 'tools', 'constraints', 'goals', 'success'] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

/** A field holds one text or a list of texts. */
export type ProfileFieldKind = 'text' | 'list';
export type ProfileValue = string | string[];
export type ProfileFields = Record<string, ProfileValue>;

export interface ProfileSectionSpec {
  label: string;
  /** Field key → its Turkish label and kind, in display order; every section also has `notes`. */
  fields: Record<string, { label: string; kind: ProfileFieldKind }>;
}

const text = (label: string) => ({ label, kind: 'text' as const });
const list = (label: string) => ({ label, kind: 'list' as const });
const notes = { notes: text('Not') };

export const PROFILE_SPEC: Record<ProfileSection, ProfileSectionSpec> = {
  identity: { label: 'Kimlik', fields: { name: text('Ad'), sector: text('Sektör'), summary: text('Ne yapıyor'), country: text('Ülke'), languages: list('Diller'), ...notes } },
  offer: { label: 'Teklif', fields: { products: list('Ürün ve hizmetler'), pricing: text('Fiyatlandırma'), ...notes } },
  customers: { label: 'Müşteri ve kanallar', fields: { segments: list('Müşteriler'), channels: list('Kanallar'), platforms: list('Platformlar'), ...notes } },
  tools: {
    label: 'Araçlar ve hesaplar',
    fields: { email: list('E-posta'), social: list('Sosyal medya'), payment: list('Ödeme'), accounting: list('Muhasebe'), ecommerce: list('E-ticaret'), other: list('Diğer'), ...notes },
  },
  constraints: { label: 'Kısıtlar', fields: { budget: text('Bütçe'), legal: list('Yasal'), brandVoice: text('Marka dili'), timezone: text('Saat dilimi'), other: list('Diğer'), ...notes } },
  goals: { label: "Hedefler ve KPI'lar", fields: { goals: list('Hedefler'), kpis: list("KPI'lar"), ...notes } },
  success: { label: 'Başarı tanımı', fields: { done: list('Başarı'), ...notes } },
};

/** One version of one section: the section as it stood after that change. */
export interface ProfileEntry {
  id: string;
  /** Company-wide: every change to any section takes the next number. */
  version: number;
  section: ProfileSection;
  fields: ProfileFields;
  /** Filled in by assumption, not from the owner. */
  assumed: boolean;
  by: string;
  ts: number;
}

export interface CompanyProfile {
  /** The latest version of any section; 0 while the profile is empty. */
  version: number;
  /** Each section's current entry; sections never written are absent. */
  sections: Partial<Record<ProfileSection, ProfileEntry>>;
}
