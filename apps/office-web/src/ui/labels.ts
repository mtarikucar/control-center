import type { Employee, EmployeeKind, Lifecycle, ModelAlias, PlanStatus, TaskStatus } from '@cc/shared';
import { formatReset } from './format.ts';

const LABELS: Record<Lifecycle, string> = {
  starting: 'Başlıyor',
  idle: 'Boşta',
  working: 'Çalışıyor',
  stopped: 'Durduruldu',
  sleeping: 'Uyuyor',
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

/** By family, not version: the aliases always point at the newest model. */
export const MODEL_LABELS: Record<ModelAlias, string> = {
  fable: 'Fable — en güçlü',
  opus: 'Opus — güçlü',
  sonnet: 'Sonnet — dengeli',
  haiku: 'Haiku — hızlı ve ucuz',
};

export const KIND_LABELS: Record<EmployeeKind, string> = { coordinator: 'Koordinatör', lead: 'Ekip lideri', member: 'Çalışan' };

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  waiting: 'Bekliyor',
  in_progress: 'Sürüyor',
  blocked: 'Takıldı',
  done: 'Bitti',
  cancelled: 'İptal',
};

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = { draft: 'Onay bekliyor', approved: 'Onaylandı', done: 'Bitti', declined: 'Vazgeçildi' };
