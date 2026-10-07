import { readFileSync } from 'node:fs';
import { WORK_TYPES, WORK_TYPE_LABELS, type WorkType } from '@cc/shared';
import { ValidationError } from '../errors.ts';

/**
 * The coordination craft ships with the office (spec §3): the same in every company, versioned with the product, never
 * written into a company's playbook. The core and the working rules go into the office guide (every session start);
 * the work-type methods are read on demand with methodRead, so they cost nothing until needed.
 */
export const CRAFT_VERSION = '1.0';
export const METHOD_HEADINGS = ['## Aşamalar', '## Roller', '## Kalite kontrolleri', '## Kanıt', '## Sık yapılan hatalar', '## Model önerisi'] as const;

const DIR = new URL('./craft/', import.meta.url);
const read = (name: string): string => readFileSync(new URL(name, DIR), 'utf8').trim();

export const isWorkType = (v: unknown): v is WorkType => (WORK_TYPES as readonly unknown[]).includes(v);

/** What everyone needs: evidence on hand-in, what a reviewer-gated task means, how to review (spec §4.1). */
export function workingText(): string {
  return read('working.md');
}

/** The core every coordinator and lead carries (spec §4.1); short, so it stays cheap in every turn. */
export function coordinationText(): string {
  return read('coordination.md');
}

/** methodRead: without a type the list of types, with one its method; an unreadable file falls back to the general method. */
export function methodText(type?: string, reader: (name: string) => string = read): string {
  if (type === undefined || type.trim() === '') {
    return [`Koordinatörlük ${CRAFT_VERSION} — iş türleri (birini methodRead ile oku):`, ...WORK_TYPES.map((t) => `• ${t} — ${WORK_TYPE_LABELS[t]}`)].join('\n');
  }
  const wanted = type.trim();
  if (!isWorkType(wanted)) throw new ValidationError(`Bilinmeyen iş türü: ${wanted}. Türler: ${WORK_TYPES.join(', ')}.`);
  try {
    return reader(`methods/${wanted}.md`);
  } catch {
    try {
      return `(“${wanted}” yöntem dosyası okunamadı; genel yöntem aşağıda.)\n\n${reader('methods/general.md')}`;
    } catch {
      return 'Yöntem dosyaları okunamadı. Genel yol: hedef → ölçülebilir bitti tanımı → yapan ve denetleyen ayrı → her madde için kanıt → teslim → değerlendirme.';
    }
  }
}

/** How the coordinator runs the onboarding dialog (B1): handed over by onboardingStart, not carried every turn. */
export function onboardingGuideText(): string {
  return read('onboarding.md');
}

/** The coordinator's part of the core: the project manager in a living loop (spec §6). */
export function pmText(): string {
  return read('pm.md');
}
