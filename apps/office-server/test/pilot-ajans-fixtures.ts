import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * The pilot agency package (C5-3; pilot-hazirlik-analizi §3.1): a synthetic agency, "Kıyı Ajans", and its six synthetic
 * clients. Read by the package's tests here and by the pilot's end-to-end K3 test (C5-4).
 */
export const PILOT_DIR = fileURLToPath(new URL('./fixtures/pilot-ajans/', import.meta.url));

/** The six clients: their file name and the name their playbook topic and notes use. */
export const CLIENTS = [
  { slug: 'pastane-ada', name: 'Pastane Ada' },
  { slug: 'dis-klinigi-mavi', name: 'Diş Kliniği Mavi' },
  { slug: 'yoga-studyosu-nefes', name: 'Yoga Stüdyosu Nefes' },
  { slug: 'kahve-tezgahi-kivilcim', name: 'Kahve Tezgâhı Kıvılcım' },
  { slug: 'butik-otel-kiyi', name: 'Butik Otel Kıyı' },
  { slug: 'cicekci-zeytin', name: 'Çiçekçi Zeytin' },
] as const;

export const brandTopic = (name: string) => `Marka dili — ${name} (sentetik)`;

export const pilotFile = (...path: string[]) => readFileSync(join(PILOT_DIR, ...path), 'utf8');
export const pilotFiles = (dir: string) => readdirSync(join(PILOT_DIR, dir)).filter((f) => f.endsWith('.md')).sort();

/** blueprint.json as blueprintPropose takes it. */
export const pilotBlueprint = () => JSON.parse(pilotFile('blueprint.json')) as {
  closedMode: { deny: string[] };
  playbook: Array<{ topic: string; text: string }>;
  roles: Array<{ key: string; name: string; template?: string; model?: string; capabilities?: string[] }>;
  goals: Array<{ key: string; title: string }>;
  routines: Array<{ key: string; title: string; cron: string }>;
  tasks: Array<{ key: string; title: string; role: string; reviewer?: string }>;
  [key: string]: unknown;
};

/** profil.json: the agency's profile, section by section, as profileUpdate takes it (the onboarding's answers). */
export const pilotProfile = () => JSON.parse(pilotFile('profil.json')) as Record<string, Record<string, unknown>>;

/** A client profile note (musteriler/<slug>.md): its first line is the title, its second "etiketler: a, b". */
export function clientNote(slug: string): { title: string; tags: string[]; text: string } {
  const [first = '', second = '', ...rest] = pilotFile('musteriler', `${slug}.md`).split('\n');
  return { title: first.replace(/^#\s*/, '').trim(), tags: second.replace(/^etiketler:\s*/, '').split(',').map((t) => t.trim()).filter(Boolean), text: rest.join('\n').trim() };
}
