import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MODEL_ALIASES, type BudgetSummary, type Constitution } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';
import { PLAN_STATUS_LABELS } from './labels.ts';

const money = (n: number) => `$${Math.round(n * 100) / 100}`;
const pct = (p: number | null) => (p === null ? '—' : `%${p}`);

/** Where the money and the quota go (spec §6): live from the store, refreshed every 15 s while open. */
export function BudgetTab() {
  const stored = useOffice((s) => s.budget);
  const plans = useOffice((s) => s.plans);
  const views = useOffice((s) => s.views);
  const usage = useOffice((s) => s.usage);
  const [fresh, setFresh] = useState<BudgetSummary | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => void api.budget().then((b) => alive && setFresh(b), () => undefined);
    load();
    const timer = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [stored]);
  const b = fresh ?? stored;
  if (!b) return <p className="muted">Yükleniyor…</p>;
  const shown = Object.values(plans)
    .filter((p) => p.status === 'approved' || p.status === 'done')
    .sort((x, y) => y.updatedAt - x.updatedAt);
  const teams = new Map<string, { usd: number; turns: number }>();
  for (const v of Object.values(views)) {
    if (v.employee.lifecycle === 'archived') continue;
    const team = v.employee.team || 'Ekipsiz';
    const today = usage[v.employee.id]?.today;
    const sum = teams.get(team) ?? { usd: 0, turns: 0 };
    teams.set(team, { usd: sum.usd + (today?.costUsd ?? 0), turns: sum.turns + (today?.turns ?? 0) });
  }
  const cap = b.constitution.monthlyUsdCap;
  return (
    <div className="budget">
      {b.reserve.active && (
        <p className="reserve-banner" role="status">
          Sahibinin payı korunuyor: kullanım %{Math.max(b.reserve.fiveHourPct ?? 0, b.reserve.sevenDayPct ?? 0)}, sınır %{b.reserve.limitPct}. Ofis yalnız öncelik 1 işleri
          başlatıyor; pencere açılınca kendiliğinden döner.
        </p>
      )}
      <section aria-label="Kota">
        <h3>Kota</h3>
        <p>
          5 saat {pct(b.reserve.fiveHourPct)} · 7 gün {pct(b.reserve.sevenDayPct)} · sahibinin payı %{b.constitution.ownerReservePct} (sınır %{b.reserve.limitPct})
        </p>
      </section>
      <section aria-label="Bu ay">
        <h3>Bu ay harcanan</h3>
        <p className={cap !== null && b.month.usd > cap ? 'over' : ''}>
          {money(b.month.usd)}
          {cap !== null ? ` / ${money(cap)}` : ' (sınır yok)'}
        </p>
      </section>
      <section aria-label="Planlar">
        <h3>Planlar</h3>
        {shown.length === 0 ? (
          <p className="muted">Onaylı plan yok.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Plan</th>
                <th>Durum</th>
                <th>Para (harcanan / onaylı)</th>
                <th>Claude kullanımı</th>
                <th>Tahmini kota</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const used = b.plans[p.id] ?? { spentUsd: 0, claudeUsd: 0 };
                const over = p.usd !== null && used.spentUsd > p.usd;
                return (
                  <tr key={p.id} aria-label={p.title} className={over ? 'over' : ''}>
                    <td>{p.title}</td>
                    <td>{PLAN_STATUS_LABELS[p.status]}</td>
                    <td>{`${money(used.spentUsd)}${p.usd !== null ? ` / ${money(p.usd)}` : ''}`}</td>
                    <td>{`~${money(used.claudeUsd)}`}</td>
                    <td>{p.quotaPct !== null ? `%${p.quotaPct}` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      <section aria-label="Ekipler">
        <h3>Ekipler (bugün, Claude kullanımı)</h3>
        <table>
          <tbody>
            {[...teams.entries()].map(([team, sum]) => (
              <tr key={team} aria-label={team}>
                <td>{team}</td>
                <td>{money(sum.usd)}</td>
                <td>{`${sum.turns} tur`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

interface Field {
  key: keyof Constitution;
  label: string;
  hint: string;
  nullable?: boolean;
  hours?: boolean;
  /** A model map typed as “a / b / c” in this key order. */
  models?: readonly string[];
  /** A model map with one select per key: [key, label]. */
  selects?: ReadonlyArray<readonly [string, string]>;
  toggle?: boolean;
  choice?: readonly [string, string];
}

const FIELDS: Field[] = [
  { key: 'maxEmployees', label: 'Çalışan sınırı', hint: 'Koordinatör dahil; masa sayısını aşamaz.' },
  { key: 'ownerReservePct', label: 'Sahibinin kota payı (%)', hint: 'Kullanım 100 − bu değere gelince ofis yalnız acil işleri başlatır.' },
  { key: 'monthlyUsdCap', label: 'Aylık para sınırı (USD)', hint: 'Boş: sınır yok.', nullable: true },
  { key: 'chainDepth', label: 'Paslama zinciri', hint: 'Paslanan işten paslanan iş en çok kaç halka olabilir.' },
  { key: 'tasksPerDay', label: 'Günlük görev sınırı', hint: 'Bir çalışanın günde açabileceği görev (koordinatör hariç).' },
  { key: 'openTasksPerPlan', label: 'Plan başına açık görev', hint: 'Bir planda aynı anda açık en çok görev.' },
  { key: 'idleSleepMinutes', label: 'Boşta uyuma (dk)', hint: 'İşi olmayan çalışan bu kadar sonra uyur; 0 = hiç.' },
  { key: 'digestHours', label: 'Özet saatleri', hint: 'Karar gerektirmeyen notlar bu saatlerde tek turda gelir; sonuncusu günlük raporu getirir (ör. 9, 17).', hours: true },
  {
    key: 'coordinatorModels', label: 'Koordinatör modelleri',
    hint: 'Koordinatörün turu, türüne göre. Başlangıç: süren plan yokken senin mesajın; aktif hedef yokken ya da hiçbir hedefin süren planı yokken gelen yönetim turu. Yönetim turu: diğer yönetim turları (yeniden planlama). Sıradan: geri kalan her tur (notlar, öneriler, kısa cevaplar). Daha güçlü modele hemen, daha zayıfa önbellek süresinden sonra geçer; model politikası kapalıyken de uygulanır.',
    selects: [['kickoff', 'Başlangıç'], ['cycle', 'Yönetim turu'], ['routine', 'Sıradan']],
  },
  { key: 'difficultyModels', label: 'Zorluk modelleri', hint: 'Kolay / orta / zor / kritik görev (ör. haiku / sonnet / opus / fable).', models: ['easy', 'medium', 'hard', 'critical'] },
  { key: 'cacheTtlMinutes', label: 'Önbellek süresi (dk)', hint: 'Bir oturum son turundan bu kadar sonra daha ucuz modele geçebilir; daha önce geçmez.' },
  { key: 'digestEnabled', label: 'Özet açık', hint: 'Kapalıyken bilgi notları da karar notu gibi hemen gelir.', toggle: true },
  { key: 'modelPolicyEnabled', label: 'Model politikası açık', hint: 'Kapalıyken herkes kendi modelinde çalışır; koordinatörün tur modelleri yine uygulanır.', toggle: true },
  { key: 'difficultyModelsEnabled', label: 'Zorluk modelleri açık', hint: 'Kapalıyken görev zorluğu modeli değiştirmez (zorluk saklanır).', toggle: true },
  { key: 'capabilityPrecheckEnabled', label: 'Yetenek ön-kontrolü açık', hint: 'Açıkken istediği yetenek masada açık olmayan görev dağıtılmaz, bloklanır ve sana yetki önerisi gelir. Kapalıyken görev eskisi gibi dağıtılır.', toggle: true },
  { key: 'autonomy', label: 'Tam serbest', hint: 'Açıkken koordinatör hedef koyar ve planlarını sormadan başlatır; kapalıyken her plan senin onayını bekler.', toggle: true, choice: ['free', 'plans'] },
  { key: 'activeGoals', label: 'En fazla aktif hedef', hint: 'Koordinatörün aynı anda yürüttüğü en çok hedef.' },
  { key: 'pulseHours', label: 'Nabız aralığı (saat)', hint: 'Hiç hedef ve iş yokken koordinatöre bu aralıkla yönetim turu açılır (dinlenirken açılmaz, dinlenme bitince bir tur açılır); 0 = hiç.' },
  { key: 'idleCapacityHours', label: 'Boşta kapasite uyarısı (saat)', hint: 'Bu kadar saattir işi olmayan çalışanlar yönetim panosunda “uzun süredir” diye işaretlenir; 0 = hiç.' },
  { key: 'defaultTaskMinutes', label: 'Varsayılan görev süresi (dk)', hint: 'Geçmişi olmayan bir işin ajandadaki tahmini süresi (5–480).' },
  { key: 'minScheduleMinutes', label: 'Rutin aralığı en az (dk)', hint: 'Bir rutin bundan daha sık çalışamaz (1–1440).' },
  { key: 'maxSchedules', label: 'En fazla rutin', hint: 'Aynı anda en çok bu kadar rutin (durdurulanlar sayılmaz); 0 = hiç.' },
];

const shown = (v: Constitution[keyof Constitution]): string =>
  v === null ? '' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? Object.values(v).join(' / ') : String(v);

/** The form's text for a field: one entry, or one per select (`key.sub`). */
function draftOf(f: Field, c: Constitution): Array<[string, string]> {
  if (f.selects) {
    const map = c[f.key] as Record<string, string>;
    return f.selects.map(([k]) => [`${f.key}.${k}`, map[k] ?? '']);
  }
  // A choice toggle is on when the setting holds its first value (autonomy: 'free').
  return [[f.key, f.choice ? String(c[f.key] === f.choice[0]) : shown(c[f.key])]];
}

/** The owner's fixed limits; the server checks every value and says what is wrong. */
export function ConstitutionTab() {
  const current = useOffice((s) => s.budget?.constitution);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // While the owner is typing, a budget update (someone's spending) must not reset the form.
  const dirty = useRef(false);
  useEffect(() => {
    if (current && !dirty.current) setDraft(Object.fromEntries(FIELDS.flatMap((f) => draftOf(f, current))));
  }, [current]);
  if (!current) return <p className="muted">Yükleniyor…</p>;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    setError(null);
    const patch: Record<string, unknown> = {};
    for (const f of FIELDS) {
      if (f.toggle) {
        const on = draft[f.key] === 'true';
        patch[f.key] = f.choice ? (on ? f.choice[0] : f.choice[1]) : on;
        continue;
      }
      if (f.selects) {
        patch[f.key] = Object.fromEntries(f.selects.map(([k]) => [k, draft[`${f.key}.${k}`]]));
        continue;
      }
      if (f.models) {
        const names = (draft[f.key] ?? '').split('/').map((x) => x.trim()).filter(Boolean);
        if (names.length !== f.models.length) {
          setError(`${f.label}: “/” ile ayrılmış ${f.models.length} model girin.`);
          setBusy(false);
          return;
        }
        patch[f.key] = Object.fromEntries(f.models.map((k, i) => [k, names[i]]));
        continue;
      }
      if (f.hours) {
        const hours = (draft[f.key] ?? '').split(/[\s,;]+/).filter(Boolean).map(Number);
        if (hours.length === 0 || hours.some((h) => !Number.isInteger(h))) {
          setError(`${f.label}: virgülle ayrılmış tam saatler girin (ör. 9, 17).`);
          setBusy(false);
          return;
        }
        patch[f.key] = hours;
        continue;
      }
      const raw = (draft[f.key] ?? '').trim().replace(',', '.');
      if (raw === '' && f.nullable) {
        patch[f.key] = null;
        continue;
      }
      // "50 dolar" or an emptied field must not slip through as no cap or 0 %: say so and send nothing.
      const value = raw === '' ? Number.NaN : Number(raw);
      if (!Number.isFinite(value)) {
        setError(`${f.label}: bir sayı girin.`);
        setBusy(false);
        return;
      }
      patch[f.key] = value;
    }
    try {
      await api.setConstitution(patch);
      dirty.current = false;
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="constitution" onSubmit={(e) => void save(e)}>
      {FIELDS.map((f) =>
        f.selects ? (
          <fieldset key={f.key} className="models">
            <legend>{f.label}</legend>
            {f.selects.map(([k, label]) => (
              <label key={k}>
                <span>{label}</span>
                <select aria-label={label} value={draft[`${f.key}.${k}`] ?? ''} onChange={(e) => {
                    dirty.current = true;
                    setDraft({ ...draft, [`${f.key}.${k}`]: e.target.value });
                  }}>
                  {MODEL_ALIASES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <small className="muted">{f.hint}</small>
          </fieldset>
        ) : (
          <label key={f.key}>
            <span>{f.label}</span>
            {f.toggle ? (
              <input type="checkbox" aria-label={f.label} checked={draft[f.key] === 'true'} onChange={(e) => {
                  dirty.current = true;
                  setDraft({ ...draft, [f.key]: String(e.target.checked) });
                }} />
            ) : (
              <input aria-label={f.label} inputMode="decimal" value={draft[f.key] ?? ''} onChange={(e) => {
                  dirty.current = true;
                  setDraft({ ...draft, [f.key]: e.target.value });
                }} />
            )}
            <small className="muted">{f.hint}</small>
          </label>
        ),
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {saved && <p className="muted">Kaydedildi.</p>}
      <div className="row end">
        <button type="submit" className="primary" disabled={busy}>
          Kaydet
        </button>
      </div>
    </form>
  );
}
