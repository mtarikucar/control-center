import type { Employee, Lifecycle } from '@cc/shared';
import { formatReset } from './format.ts';

const LABELS: Record<Lifecycle, string> = {
  starting: 'Başlıyor',
  idle: 'Boşta',
  working: 'Çalışıyor',
  stopped: 'Durduruldu',
  in_terminal: 'Terminalde',
  limited: 'Limit doldu',
  interrupted: 'Kesildi',
  error: 'Hata',
  archived: 'İşten çıkarıldı',
};

export const lifecycleLabel = (l: Lifecycle): string => LABELS[l] ?? l;
export const canStop = (l: Lifecycle): boolean => l === 'idle' || l === 'working' || l === 'limited' || l === 'starting';
export const canResume = (l: Lifecycle): boolean => l === 'stopped' || l === 'interrupted' || l === 'error' || l === 'limited';

/** Spec §6: a limited employee shows when the subscription window opens again. */
export function limitNote(e: Pick<Employee, 'lifecycle' | 'limitResetsAt'>, now: number): string | null {
  return e.lifecycle === 'limited' && e.limitResetsAt !== null ? `açılış ${formatReset(e.limitResetsAt, now)}` : null;
}
