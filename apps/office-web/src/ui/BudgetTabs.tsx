import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MODEL_ALIASES, type AgentProvider, type BudgetSummary, type Constitution } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';
import { PLAN_STATUS_LABELS, modelLabels } from './labels.ts';

const money = (n: number) => `$${Math.round(n * 100) / 100}`;
const pct = (p: number | null) => (p === null ? '—' : `%${p}`);

/** Where the money and the quota go (spec §6): live from the store, refreshed every 15 s while open. */
export function BudgetTab() {
  const runtime = useOffice((s) => s.runtime);
  const stored = useOffice((s) => s.budget);
  const plans = useOffice((s) => s.plans);
  const views = useOffice((s) => s.views);
  const usage = useOffice((s) => s.usage);
  const quotas = useOffice((s) => s.quotas);
  const incompleteCost = runtime?.costAvailable === false || Object.values(views).some(v => v.employee.provider === 'codex');
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
  const teams = new Map<string, { usd: number; turns: number; codex: boolean }>();
  for (const v of Object.values(views)) {
    if (v.employee.lifecycle === 'archived') continue;
    const team = v.employee.team || 'Ekipsiz';
    const today = usage[v.employee.id]?.today;
    const sum = teams.get(team) ?? { usd: 0, turns: 0, codex: false };
    teams.set(team, { usd: sum.usd + (today?.costUsd ?? 0), turns: sum.turns + (today?.turns ?? 0), codex: sum.codex || v.employee.provider === 'codex' });
  }
  const cap = b.constitution.monthlyUsdCap;
  return (
    <div className="budget">
      {incompleteCost && <p className="muted">USD tutarları bildirilen Claude kullanımını içerir; Codex para maliyetini bildirmez. Dış harcamalar ayrıca kaydedilir.</p>}
      {b.reserve.active && (
        <p className="reserve-banner" role="status">
          Sahibinin payı korunuyor: kullanım %{Math.max(b.reserve.fiveHourPct ?? 0, b.reserve.sevenDayPct ?? 0)}, sınır %{b.reserve.limitPct}. Ofis yalnız öncelik 1 işleri
          başlatıyor; pencere açılınca kendiliğinden döner.
        </p>
      )}
      <section aria-label="Kota">
        <h3>Kota</h3>
        {quotas && Object.entries(quotas).map(([provider, q]) => <p key={provider}>{provider === 'codex' ? 'Codex' : 'Claude'}: 5 saat {q?.fiveHour ? pct(Math.round(q.fiveHour.utilization * 100)) : '—'} · 7 gün {q?.sevenDay ? pct(Math.round(q.sevenDay.utilization * 100)) : '—'}</p>)}
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
                    <td>{`~${money(used.claudeUsd)}${incompleteCost ? ' + Codex bilinmiyor' : ''}`}</td>
                    <td>{p.quotaPct !== null ? `%${p.quotaPct}` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      <section aria-label="Ekipler">
        <h3>Ekipler (bugün, bildirilen kullanım)</h3>
        <table>
          <tbody>
            {[...teams.entries()].map(([team, sum]) => (
              <tr key={team} aria-label={team}>
                <td>{team}</td>
                <td>{`${money(sum.usd)}${sum.codex ? ' + Codex bilinmiyor' : ''}`}</td>
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
  /** The options of each `selects` select, [value, label]; none: the models. */
  options?: ReadonlyArray<readonly [string, string]>;
  /** A list of text, one entry per line. */
  list?: boolean;
  /** Two whole hours: from, to. */
  span?: boolean;
  toggle?: boolean;
  choice?: readonly [string, string];
}

const FIELDS: Field[] = [
  { key: 'ownerReservePct', label: 'Sahibinin kota payı (%)', hint: 'Kullanım 100 − bu değere gelince ofis yalnız acil işleri başlatır.' },
  { key: 'monthlyUsdCap', label: 'Aylık para sınırı (USD)', hint: 'Boş: sınır yok.', nullable: true },
  { key: 'gateEnabled', label: 'Geri alınamaz iş kapısı açık', hint: 'Açıkken dışa dönük işler Otonomi politikasına göre: sistemce ya da sana (Onaylar sekmesi). Ödeme, silme, tarayıcı işi ve ofisin kendisine dokunan araç çağrıları her zaman senin onayını bekler. Kapıyı kazara ve sıradan yollar için kapatır; aynı kullanıcıdaki kararlı bir atlatmayı durdurmaz.', toggle: true },
  {
    key: 'outwardPolicy', label: 'Otonomi politikası',
    hint: 'Kapı açıkken bağlayıcıdan yapılan dışa dönük çağrıyı kim geçirir: Sahibine sor (Onaylar sekmesi) ya da Sistem halletsin (aşağıdaki kurallarla; geçen her çağrı Giden kutusuna yazılır). Ödeme, silme, tarayıcı, ofisin kendisi, sınıflandırılmamış araçlar ve komut satırından gönderim her zaman sana gelir.',
    selects: [['send', 'Gönderim'], ['publish', 'Yayın'], ['call', 'Arama'], ['calendar', 'Takvim']],
    options: [['owner', 'Sahibine sor'], ['system', 'Sistem halletsin']],
  },
  {
    key: 'specialContacts', label: 'Özel kişiler', list: true,
    hint: 'Satır başına bir girdi: e-posta, telefon numarası, kullanıcı adı, kişinin ya da firmanın adı ya da kişinin aday/konuşma kimliği (adlar bütün bir ifade olarak aranır; büyük-küçük harf ve telefonun yazılışı fark etmez). Kapı açıkken, girdisinde bunlardan biri geçen çağrı — o kişiye giden ya da onu anan —, politika ne olursa olsun sana gelir. Kapı yalnız çağrının girdisine bakar: kimlikle adreslenen bir çağrıda (aday ya da konuşma kimliğiyle e-posta, mesaj, arama) kişiyi ancak kimliği listedeyse görür; adresini, telefonunu ve kimliklerini birlikte yaz.',
  },
  { key: 'autonomy', label: 'Tam serbest', hint: 'Açıkken koordinatör hedef koyar ve planlarını sormadan başlatır; kapalıyken her plan senin onayını bekler.', toggle: true, choice: ['free', 'plans'] },
  { key: 'releasePolicy', label: 'Canlıya alma ve birleştirme ofiste', hint: 'Açıkken birleştirme, canlıya alma, göç ve sunucu işleri sana sorulmadan yapılır (ödeme ve silme yine sana gelir); kapalıyken rol kartlarındaki “sahibinin onayıyla” kuralı geçerli.', toggle: true, choice: ['office', 'owner'] },
];

const shown = (v: Constitution[keyof Constitution]): string =>
  v === null ? '' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? Object.values(v).join(' / ') : String(v);

/** A select's options: the field's own, else the models (by Codex's names under Codex). */
const optionsOf = (f: Field, provider: AgentProvider | undefined): ReadonlyArray<readonly [string, string]> =>
  f.options ?? MODEL_ALIASES.map((m) => [m, provider === 'codex' ? modelLabels(provider)[m] : m] as const);

/** The form's text for a field: one entry, or one per select (`key.sub`). */
function draftOf(f: Field, c: Constitution): Array<[string, string]> {
  if (f.selects) {
    const map = c[f.key] as Record<string, string>;
    return f.selects.map(([k]) => [`${f.key}.${k}`, map[k] ?? '']);
  }
  if (f.list) return [[f.key, (c[f.key] as string[]).join('\n')]];
  // A choice toggle is on when the setting holds its first value (autonomy: 'free').
  return [[f.key, f.choice ? String(c[f.key] === f.choice[0]) : shown(c[f.key])]];
}

/** The owner's fixed limits; the server checks every value and says what is wrong. */
export function ConstitutionTab() {
  const provider = useOffice((s) => s.runtime?.provider);
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
      if (f.list) {
        patch[f.key] = (draft[f.key] ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
        continue;
      }
      if (f.span) {
        const text = draft[f.key] ?? '';
        const hours = text.split(/[\s,;–-]+/).filter(Boolean).map(Number);
        // A dash between the two hours separates them ("8-17", "8 – 17"); right before a number and not right after one
        // ("-9, 19", "9, -19") it is a minus sign, which no hour has.
        if (/(?<!\d)[–-](?=\d)/.test(text) || hours.length !== 2 || hours.some((h) => !Number.isInteger(h))) {
          setError(`${f.label}: iki tam saat girin (ör. 9, 19).`);
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
  const render = (f: Field) =>
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
                  {optionsOf(f, provider).map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <small className="muted">{provider === 'codex' ? f.hint.replaceAll('Claude', 'Codex') : f.hint}</small>
          </fieldset>
        ) : (
          <label key={f.key}>
            <span>{f.label}</span>
            {f.toggle ? (
              <input type="checkbox" aria-label={f.label} checked={draft[f.key] === 'true'} onChange={(e) => {
                  dirty.current = true;
                  setDraft({ ...draft, [f.key]: String(e.target.checked) });
                }} />
            ) : f.list ? (
              <textarea aria-label={f.label} rows={3} value={draft[f.key] ?? ''} onChange={(e) => {
                  dirty.current = true;
                  setDraft({ ...draft, [f.key]: e.target.value });
                }} />
            ) : (
              <input aria-label={f.label} inputMode="decimal" value={draft[f.key] ?? ''} onChange={(e) => {
                  dirty.current = true;
                  setDraft({ ...draft, [f.key]: e.target.value });
                }} />
            )}
            <small className="muted">{provider === 'codex' ? f.key === 'cacheTtlMinutes' ? 'Son turdan sonra daha düşük çalışma düzeyine geçmeden önce bekleme süresi; Codex önbelleğinin süresini değiştirmez.' : f.hint.replaceAll('Claude', 'Codex') : f.hint}</small>
          </label>
        );
  return (
    <form className="constitution" onSubmit={(e) => void save(e)}>
      <p className="muted">Senin kararın olan yedi ayar. Modelleri, sınırları ve zamanlamaları ofis kendisi ayarlar.</p>
      {FIELDS.map(render)}
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
