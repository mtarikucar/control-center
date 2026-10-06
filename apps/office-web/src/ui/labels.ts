import type { Lifecycle } from '@cc/shared';

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
