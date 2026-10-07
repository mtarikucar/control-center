import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { AgendaEntry, EmployeeAgenda } from '@cc/shared';
import { formatClock, formatWhenTR } from './format.ts';
import { AGENDA_KIND_LABELS } from './labels.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const AXIS = 18;
const LANE = 22;
const GAP = 4;
const MARK = 20;
const DAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
/** Fewest pixels between two axis labels. */
const LABEL_PX = 44;
/** Shown before now (a 24th of the span): what is running shows how long it has run. */
const LEAD = 1 / 24;

/**
 * The svg's width in its own units: the drawn width once it can be measured, so 1 unit is 1 px and the text keeps its
 * size; until then (and where nothing measures, as in tests) 720 units scaled to fit.
 */
function useDrawnWidth(ref: RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(720);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const w = Math.round(el.clientWidth);
      if (w > 0) setWidth(Math.max(240, w));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

interface Bar {
  entry: AgendaEntry;
  x1: number;
  x2: number;
  lane: number;
}

const tooltip = (e: AgendaEntry, now: number) =>
  [`${AGENDA_KIND_LABELS[e.kind]}: ${e.title}`, e.at !== null ? formatWhenTR(e.at, now) + (e.until !== null ? ` → ~${formatWhenTR(e.until, now)}` : '') : null, e.note, e.overdue ? 'son tarih geçti' : null]
    .filter(Boolean)
    .join(' · ');

/** Grid lines and labels: hours over a day (a label every few hours, as the width allows), midnights over a week. */
function ticks(start: number, end: number, x: (ms: number) => number, perHourPx: number, week: boolean): Array<{ x: number; label: string | null; major: boolean }> {
  const out: Array<{ x: number; label: string | null; major: boolean }> = [];
  const t = new Date(start);
  if (!week) {
    const every = [1, 2, 3, 4, 6, 12].find((h) => h * perHourPx >= LABEL_PX) ?? 12;
    t.setMinutes(0, 0, 0);
    for (t.setHours(t.getHours() + 1); t.getTime() < end; t.setHours(t.getHours() + 1)) {
      out.push({ x: x(t.getTime()), label: t.getHours() % every === 0 ? formatClock(t.getTime()) : null, major: t.getHours() === 0 });
    }
  } else {
    t.setHours(0, 0, 0, 0);
    for (t.setDate(t.getDate() + 1); t.getTime() < end; t.setDate(t.getDate() + 1)) {
      out.push({ x: x(t.getTime()), label: perHourPx * 24 >= LABEL_PX ? `${DAYS[t.getDay()]} ${t.getDate()}` : null, major: true });
    }
  }
  return out;
}

/** One employee's agenda as horizontal blocks from now (spec §6.2): tasks as bars, parks, start times and routines as marks. */
export function AgendaTimeline({ agenda, now, spanMs }: { agenda: EmployeeAgenda; now: number; spanMs: number }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useDrawnWidth(box);
  const start = now - spanMs * LEAD;
  const end = now + spanMs;
  const x = (ms: number) => ((ms - start) / (end - start)) * width;
  const nowX = x(now);

  const bars: Bar[] = [];
  const laneEnds: number[] = [];
  const spans = agenda.entries.filter((e) => e.at !== null && e.until !== null).sort((a, b) => a.at! - b.at!);
  for (const entry of spans) {
    const x1 = Math.max(0, x(entry.at!));
    const x2 = Math.min(width, Math.max(x(entry.until!), x1 + 2));
    if (x2 <= 0 || x1 >= width) continue;
    let lane = laneEnds.findIndex((end) => end <= x1 + 0.5);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = x2;
    bars.push({ entry, x1, x2, lane });
  }
  const marks = agenda.entries
    .filter((e) => e.at !== null && e.until === null && e.at < end)
    // A parked task past its return is due now: it shows at now.
    .map((entry) => ({ entry, x: Math.min(width - 7, Math.max(7, x(Math.max(entry.at!, now)))) }))
    .sort((a, b) => a.x - b.x);
  const timeless = agenda.entries.filter((e) => e.at === null);

  const lanes = Math.max(1, laneEnds.length);
  const markY = AXIS + lanes * (LANE + GAP);
  const height = markY + (marks.length > 0 ? MARK + GAP : 0);
  const empty = bars.length === 0 && marks.length === 0;

  return (
    <div className="agenda-timeline" ref={box}>
      <svg role="img" aria-label={`${agenda.name} zaman çizelgesi`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMinYMin meet">
        <rect className="tl-bg" x={0} y={AXIS} width={width} height={height - AXIS} rx={6} />
        <g className="tl-axis">
          {ticks(start, end, x, (width * HOUR) / (end - start), spanMs > DAY).map((t) => (
            <g key={t.x}>
              <line className={t.major ? 'tl-grid major' : 'tl-grid'} x1={t.x} x2={t.x} y1={AXIS - 4} y2={height} />
              {t.label && t.x > 16 && t.x < width - 16 && (
                <text x={t.x} y={AXIS - 7} textAnchor="middle">
                  {t.label}
                </text>
              )}
            </g>
          ))}
          <line className="tl-now" x1={nowX} x2={nowX} y1={AXIS - 4} y2={height}>
            <title>Şimdi</title>
          </line>
        </g>
        {empty && (
          <text className="tl-empty" x={width / 2} y={AXIS + LANE / 2 + GAP / 2} textAnchor="middle" dominantBaseline="central">
            Bu aralıkta planlı iş yok
          </text>
        )}
        {bars.map(({ entry, x1, x2, lane }, i) => {
          const y = AXIS + GAP / 2 + lane * (LANE + GAP);
          const w = x2 - x1;
          // A title that does not fit in its bar goes after it when the lane is free there.
          const nextInLane = bars.slice(i + 1).find((b) => b.lane === lane)?.x1 ?? width;
          const after = w > 60 ? 0 : nextInLane - x2 - 6;
          return (
            <g key={`${entry.kind}:${entry.taskId}`} className={`tl-bar ${entry.kind}${entry.overdue ? ' overdue' : ''}${entry.lowConfidence ? ' low' : ''}`}>
              <title>{tooltip(entry, now)}</title>
              <rect x={x1} y={y} width={w} height={LANE} rx={4} />
              {after > 40 ? (
                <svg x={x2 + 4} y={y} width={after} height={LANE}>
                  <text className="tl-outside" x={0} y={LANE / 2} dominantBaseline="central">
                    {entry.title}
                  </text>
                </svg>
              ) : (
                w > 24 && (
                  <svg x={x1} y={y} width={w} height={LANE}>
                    <text x={5} y={LANE / 2} dominantBaseline="central">
                      {entry.title}
                    </text>
                  </svg>
                )
              )}
            </g>
          );
        })}
        {marks.map(({ entry, x: mx }, i) => {
          const cy = markY + MARK / 2;
          const room = (marks[i + 1]?.x ?? width) - mx - 16;
          return (
            <g key={`${entry.kind}:${entry.taskId ?? entry.scheduleId}:${entry.at}`} className={`tl-mark ${entry.kind}${entry.overdue ? ' overdue' : ''}`}>
              <title>{tooltip(entry, now)}</title>
              <path d={`M${mx},${cy - 6} L${mx + 6},${cy} L${mx},${cy + 6} L${mx - 6},${cy} Z`} />
              {room > 28 && (
                <svg x={mx + 9} y={markY} width={room} height={MARK}>
                  <text x={0} y={MARK / 2} dominantBaseline="central">
                    {entry.title}
                  </text>
                </svg>
              )}
            </g>
          );
        })}
      </svg>
      {timeless.length > 0 && <p className="muted agenda-timeless">{timeless.map((e) => `${AGENDA_KIND_LABELS[e.kind]}: ${e.title}${e.note ? ` (${e.note})` : ''}`).join(' · ')}</p>}
    </div>
  );
}
