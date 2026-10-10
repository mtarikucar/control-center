import type { AgendaEntry, CycleTrigger, CycleTriggerKind, Employee, EmployeeKind, GoalStatus, Lifecycle, ModelAlias, PlanStatus, ProposalKind, ProposalStatus, ScheduleStatus, StreamStatus, TaskStatus } from '@cc/shared';
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
export const canStop = (l: Lifecycle): boolean => l === 'idle' || l === 'working' || l === 'limited' || l === 'starting' || l === 'sleeping';
export const canResume = (l: Lifecycle): boolean => l === 'stopped' || l === 'interrupted' || l === 'error' || l === 'limited' || l === 'sleeping';

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

export const CODEX_LABELS: Record<ModelAlias, string> = { haiku: 'Codex — düşük', sonnet: 'Codex — dengeli', opus: 'Codex — yüksek', fable: 'Codex — en yüksek' };
export const modelLabels = (provider?: string): Record<ModelAlias, string> => provider === 'codex' ? CODEX_LABELS : MODEL_LABELS;

/** A model's family name alone: “Opus”. */
export const modelName = (m: ModelAlias, provider?: string): string => provider === 'codex' ? CODEX_LABELS[m] : MODEL_LABELS[m].split(' — ')[0] ?? m;

export const KIND_LABELS: Record<EmployeeKind, string> = { coordinator: 'Koordinatör', lead: 'Ekip lideri', member: 'Çalışan' };

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  waiting: 'Bekliyor',
  in_progress: 'Sürüyor',
  review: 'İncelemede',
  blocked: 'Takıldı',
  parked: 'Ertelendi',
  done: 'Bitti',
  cancelled: 'İptal',
};

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = { draft: 'Onay bekliyor', approved: 'Onaylandı', done: 'Bitti', declined: 'Vazgeçildi', stopped: 'Durduruldu' };

export const PROPOSAL_KIND_LABELS: Record<ProposalKind, string> = { need: 'İhtiyaç', purchase: 'Satın alma', idea: 'Fikir', objection: 'İtiraz' };
export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = { open: 'Karar bekliyor', owner: 'Senin onayını bekliyor', accepted: 'Kabul edildi', declined: 'Reddedildi' };

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = { active: 'Aktif', done: 'Ulaşıldı', dropped: 'Bırakıldı' };

export const SCHEDULE_STATUS_LABELS: Record<ScheduleStatus, string> = { active: 'Sürüyor', paused: 'Duraklatıldı', stopped: 'Durduruldu' };

export const AGENDA_KIND_LABELS: Record<AgendaEntry['kind'], string> = {
  now: 'Şimdi',
  queued: 'Sırada',
  review_wait: 'İnceleme bekliyor',
  parked: 'Ertelendi',
  not_before: 'Başlangıç',
  scheduled: 'Rutin',
};

/** A plan stream's status (management cycle §3.4), in the board's words. */
export const STREAM_STATUS_LABELS: Record<StreamStatus, string> = { planned: 'Planlı', active: 'Sürüyor', blocked: 'Takıldı', done: 'Bitti' };

/** What opened a management cycle (management cycle §3.1). */
export const CYCLE_TRIGGER_LABELS: Record<CycleTriggerKind, string> = {
  delivery: 'Teslim',
  review: 'İnceleme kararı',
  idle: 'Boşa çıktı',
  plan: 'Plan',
  goal: 'Hedef',
  constraint: 'Kısıt değişti',
  stuck: 'Takılma',
  heartbeat: 'Kalp atışı',
  start: 'Ofis açıldı',
  rest: 'Dinlenme bitti',
};

/** “Teslim: “Giriş” (Ada)”; the label alone when the note is empty or says the same. */
export function triggerText(t: Pick<CycleTrigger, 'kind' | 'note'>): string {
  const label = CYCLE_TRIGGER_LABELS[t.kind] ?? t.kind;
  const note = t.note.trim();
  return note && note.toLocaleLowerCase('tr') !== label.toLocaleLowerCase('tr') ? `${label}: ${note}` : label;
}
