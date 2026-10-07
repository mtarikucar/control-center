import { useMemo, useState, type FormEvent } from 'react';
import type { AgendaEntry, ClockStatus, Schedule } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';
import { AgendaTimeline } from './AgendaTimeline.tsx';
import { formatClock, formatWhenTR } from './format.ts';
import { AGENDA_KIND_LABELS, SCHEDULE_STATUS_LABELS } from './labels.ts';
import { useAgenda } from './useAgenda.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const pad = (n: number) => String(n).padStart(2, '0');

/** A local `YYYY-MM-DDTHH:MM`: what a datetime-local input shows and the park route takes. */
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** The return times offered (spec §6.3), worked out when clicked. */
const PRESETS: Array<[string, (n: Date) => Date]> = [
  ['+1 saat', (n) => new Date(n.getTime() + HOUR)],
  ['+6 saat', (n) => new Date(n.getTime() + 6 * HOUR)],
  ['Yarın 09:00', (n) => new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 9, 0)],
  ['Yarın aynı saat', (n) => new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, n.getHours(), n.getMinutes())],
];

/** "14:55" today, "yarın 09:00", "12 Eki 14:55": a day is named only when it is not today. */
const when = (ms: number, now: number) => formatWhenTR(ms, now).replace(/^bugün /, '');
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

/** One owner button's request: the row's buttons wait for it, a refusal is shown by the row, success reads the agenda again. */
function useOwnerAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    setBusy(true);
    try {
      await work();
      useOffice.setState((s) => ({ agendaRev: s.agendaRev + 1 }));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function ParkForm({ busy, onPark, onCancel }: { busy: boolean; onPark: (until: string, reason: string) => void; onCancel: () => void }) {
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('Sahibi erteledi');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (until) onPark(until, reason.trim());
  };
  return (
    <form className="park-form" onSubmit={submit}>
      <div className="park-presets">
        {PRESETS.map(([label, at]) => (
          <button key={label} type="button" onClick={() => setUntil(localInput(at(new Date())))}>
            {label}
          </button>
        ))}
      </div>
      <input type="datetime-local" aria-label="Tarih ve saat" value={until} min={localInput(new Date())} onChange={(e) => setUntil(e.target.value)} />
      <input aria-label="Gerekçe" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      <div className="park-submit">
        <button type="submit" className="primary" disabled={busy || !until}>
          Park et
        </button>
        <button type="button" onClick={onCancel}>
          Vazgeç
        </button>
      </div>
    </form>
  );
}

function timeText(e: AgendaEntry, now: number) {
  if (e.at === null) return <span className="muted">—</span>;
  // A running task's start is known; a queued one's start and every end are estimates.
  const start = `${e.kind === 'queued' ? '~' : ''}${when(e.at, now)}`;
  if (e.until === null) return start;
  return (
    <>
      {start}
      <span className="agenda-until">→ ~{sameDay(e.at, e.until) ? formatClock(e.until) : when(e.until, now)}</span>
    </>
  );
}

function AgendaRow({ entry, now }: { entry: AgendaEntry; now: number }) {
  const { kind, taskId, scheduleId } = entry;
  // The agenda lists only active routines; one paused (or stopped) since then shows so until the agenda is read again.
  const routineStatus = useOffice((s) => (scheduleId ? s.schedules[scheduleId]?.status : undefined)) ?? 'active';
  // The office refuses to park a hand-over (spec §6.3): no button that can only fail.
  const handover = useOffice((s) => (taskId ? s.tasks[taskId]?.kind === 'handover' : false));
  const { busy, error, run } = useOwnerAction();
  const [parking, setParking] = useState(false);

  const release = taskId && (kind === 'parked' || kind === 'not_before') && (
    <button type="button" disabled={busy} onClick={() => void run(() => api.releaseTask(taskId))}>
      Şimdi başlasın
    </button>
  );
  const park = taskId && kind !== 'review_wait' && kind !== 'scheduled' && !handover && (
    <button type="button" aria-expanded={parking} disabled={busy} onClick={() => setParking(!parking)}>
      Park et…
    </button>
  );
  const prioritize = taskId && kind === 'queued' && (
    <button type="button" disabled={busy} onClick={() => void run(() => api.prioritizeTask(taskId))}>
      Öne al
    </button>
  );
  const routine = kind === 'scheduled' && scheduleId && routineStatus !== 'stopped' && (
    <>
      {routineStatus === 'paused' ? (
        <button type="button" disabled={busy} onClick={() => void run(() => api.scheduleAction(scheduleId, 'resume'))}>
          Sürdür
        </button>
      ) : (
        <button type="button" disabled={busy} onClick={() => void run(() => api.scheduleAction(scheduleId, 'pause'))}>
          Duraklat
        </button>
      )}
      <StopRoutineButton id={scheduleId} title={entry.title} busy={busy} run={run} />
    </>
  );

  return (
    <li className={`agenda-row kind-${kind}${entry.overdue ? ' overdue' : ''}`}>
      <span className={`agenda-time${entry.lowConfidence ? ' low' : ''}`} title={entry.lowConfidence ? 'Düşük güven: beklediği işin tahminine dayanıyor.' : undefined}>
        {timeText(entry, now)}
      </span>
      <div className="agenda-what">
        <strong>{entry.title}</strong>
        <span className="agenda-badges">
          <span className={`badge kind-${kind}`}>{AGENDA_KIND_LABELS[kind]}</span>
          {entry.priority !== null && kind !== 'scheduled' && <span className="badge">P{entry.priority}</span>}
          {entry.overdue ? <span className="badge overdue">son tarih geçti</span> : entry.dueAt !== null && <span className="badge">son tarih {when(entry.dueAt, now)}</span>}
          {entry.basis && <span className="badge estimate">~{entry.basis}</span>}
          {entry.note && <span className="agenda-note">{entry.note}</span>}
        </span>
      </div>
      <div className="agenda-actions">
        {release}
        {park}
        {prioritize}
        {routine}
      </div>
      {parking && taskId && (
        <ParkForm
          busy={busy}
          onCancel={() => setParking(false)}
          onPark={(until, reason) =>
            void run(() => api.parkTask(taskId, until, reason)).then((ok) => {
              if (ok) setParking(false);
            })
          }
        />
      )}
      {error && (
        <p className="error agenda-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

function StopRoutineButton({ id, title, busy, run }: { id: string; title: string; busy: boolean; run: (work: () => Promise<unknown>) => Promise<boolean> }) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        if (window.confirm(`“${title}” rutini durdurulsun mu? Durdurulan rutin yeniden açılamaz.`)) void run(() => api.scheduleAction(id, 'stop'));
      }}
    >
      Durdur
    </button>
  );
}

function AgendaList({ entries, now }: { entries: AgendaEntry[]; now: number }) {
  if (entries.length === 0) return <p className="muted">Planlı işi yok.</p>;
  return (
    <ul className="agenda-list">
      {entries.map((e) => (
        <AgendaRow key={`${e.kind}:${e.taskId ?? e.scheduleId}:${e.kind === 'scheduled' ? e.at : ''}`} entry={e} now={now} />
      ))}
    </ul>
  );
}

function RoutineRow({ schedule, assignee, now }: { schedule: Schedule; assignee: string; now: number }) {
  const { busy, error, run } = useOwnerAction();
  const { id, status } = schedule;
  return (
    <li className={`routine-row ${status}`}>
      <div className="agenda-what">
        <strong>{schedule.title}</strong>
        <span className="agenda-badges">
          <span className="muted">{assignee}</span>
          <span className={`badge schedule-${status}`}>{SCHEDULE_STATUS_LABELS[status]}</span>
          {status === 'active' && schedule.nextRunAt !== null && <span className="agenda-note">sıradaki {formatWhenTR(schedule.nextRunAt, now)}</span>}
          <code className="cron">{schedule.cron}</code>
        </span>
      </div>
      {status !== 'stopped' && (
        <div className="agenda-actions">
          {status === 'active' ? (
            <button type="button" disabled={busy} onClick={() => void run(() => api.scheduleAction(id, 'pause'))}>
              Duraklat
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => void run(() => api.scheduleAction(id, 'resume'))}>
              Sürdür
            </button>
          )}
          <StopRoutineButton id={id} title={schedule.title} busy={busy} run={run} />
        </div>
      )}
      {error && (
        <p className="error agenda-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

const ROUTINE_ORDER: Record<Schedule['status'], number> = { active: 0, paused: 1, stopped: 2 };

/** Every routine the office keeps, a paused one too: the agenda shows only active ones, so this is where it is resumed. */
function RoutineList({ now }: { now: number }) {
  const schedules = useOffice((s) => s.schedules);
  const views = useOffice((s) => s.views);
  const list = useMemo(
    () => Object.values(schedules).sort((a, b) => ROUTINE_ORDER[a.status] - ROUTINE_ORDER[b.status] || (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity) || a.createdAt - b.createdAt),
    [schedules],
  );
  return (
    <section className="agenda-routines" aria-label="Rutinler">
      <h3>Rutinler</h3>
      {list.length === 0 ? (
        <p className="muted">Rutin yok. Koordinatör tekrarlayan işleri rutin olarak açar.</p>
      ) : (
        <ul className="agenda-list">
          {list.map((s) => (
            <RoutineRow key={s.id} schedule={s} assignee={views[s.assignee]?.employee.name ?? '—'} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The office clock (spec §5): what it does next and when; a jump in the last day is mentioned. */
function ClockLine({ clock, now }: { clock: ClockStatus | null; now: number }) {
  const next = clock?.nextDueAt ?? null;
  const jump = clock?.lastJumpAt ?? null;
  return (
    <p className="agenda-clock">
      {next !== null ? (
        <>
          Sıradaki saatli iş: {clock?.nextDueLabel && <strong>{clock.nextDueLabel}</strong>} — {formatWhenTR(next, now)}
        </>
      ) : (
        <span className="muted">Saatte bekleyen iş yok.</span>
      )}
      {jump !== null && now - jump < DAY && <span className="muted"> · saat {formatWhenTR(jump, now)} atladı</span>}
    </p>
  );
}

/** Who does what when (spec §6.2): one row per employee, as a list with the owner's buttons or as a timeline. */
export function AgendaTab() {
  const { report, error } = useAgenda();
  const storedClock = useOffice((s) => s.clock);
  const paused = useOffice((s) => s.paused);
  const reserve = useOffice((s) => s.budget?.reserve.active ?? false);
  const [view, setView] = useState<'list' | 'timeline'>('list');
  const [span, setSpan] = useState<'day' | 'week'>('day');
  // The moment the agenda describes: its times and estimates were worked out then.
  const now = report?.generatedAt ?? Date.now();
  return (
    <div className="agenda">
      <header className="agenda-head">
        <ClockLine clock={report?.clock ?? storedClock} now={now} />
        <div className="agenda-toggles">
          <div className="segmented" role="group" aria-label="Görünüm">
            <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>
              Liste
            </button>
            <button type="button" aria-pressed={view === 'timeline'} onClick={() => setView('timeline')}>
              Zaman çizelgesi
            </button>
          </div>
          {view === 'timeline' && (
            <div className="segmented" role="group" aria-label="Aralık">
              <button type="button" aria-pressed={span === 'day'} onClick={() => setSpan('day')}>
                24 saat
              </button>
              <button type="button" aria-pressed={span === 'week'} onClick={() => setSpan('week')}>
                7 gün
              </button>
            </div>
          )}
        </div>
      </header>
      {paused && <p className="agenda-warn">Şirket duraklatıldı: yeni iş başlamıyor. Saatler, şirket sürdürülünce geçerli.</p>}
      {reserve && <p className="agenda-warn">Sahibinin kota payı devrede: yalnız öncelik 1 işler başlıyor, diğerlerinin saatleri kayabilir.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!report ? (
        !error && <p className="muted">Yükleniyor…</p>
      ) : report.employees.length === 0 ? (
        <p className="muted">Ofiste çalışan yok.</p>
      ) : (
        report.employees.map((e) => (
          <section key={e.id} className="agenda-person" aria-label={e.name}>
            <header className="agenda-person-head">
              <h3>{e.name}</h3>
              {e.state && <span className="agenda-state">{e.state}</span>}
            </header>
            {view === 'list' ? <AgendaList entries={e.entries} now={now} /> : <AgendaTimeline agenda={e} now={now} spanMs={span === 'day' ? DAY : 7 * DAY} />}
          </section>
        ))
      )}
      <RoutineList now={now} />
    </div>
  );
}

/** The same agenda in an employee's panel, for that employee only. */
export function AgendaSection({ id }: { id: string }) {
  const { report, error } = useAgenda();
  const agenda = report?.employees.find((e) => e.id === id);
  return (
    <section className="agenda-section" aria-label="Ajanda">
      <h3>
        Ajanda
        {agenda?.state && <span className="agenda-state"> {agenda.state}</span>}
      </h3>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {report ? <AgendaList entries={agenda?.entries ?? []} now={report.generatedAt} /> : !error && <p className="muted">Yükleniyor…</p>}
    </section>
  );
}
