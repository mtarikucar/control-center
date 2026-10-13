import { useState, type FormEvent } from 'react';
import { CAPABILITY_KIND_LABELS, CAPABILITY_KINDS, CUSTOM_CAPABILITY_STATUS_LABELS, OWNER, type CapabilityKind, type CustomCapability } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';
import { needsConfirm } from './capabilityWaiting.ts';
import { useLiveRead } from './useLiveRead.ts';

/** A capability the coordinator activated shows as new to the owner this long. */
const NEW_FOR_MS = 7 * 24 * 60 * 60_000;
/** What the owner's rejection says when it has no note: the server refuses a rejection with none. */
const OWNER_REJECTED = 'Sahibi reddetti.';
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * The owner may set any kind; the two ends say what they bring, so choosing one is never by accident: read is open in
 * every session and passes the gate, pay and delete always come to the owner.
 */
const kindChoice = (k: CapabilityKind) =>
  k === 'read' ? `${CAPABILITY_KIND_LABELS[k]} (her oturumda açık, kapıda serbest)` : k === 'pay' || k === 'delete' ? `${CAPABILITY_KIND_LABELS[k]} (her zaman sana sorulur)` : CAPABILITY_KIND_LABELS[k];

function KindOptions() {
  return CAPABILITY_KINDS.map((k) => (
    <option key={k} value={k}>
      {kindChoice(k)}
    </option>
  ));
}

/**
 * Runs an owner action once at a time; its error is shown until the next action. With `untilNewData` a success keeps
 * the buttons off: the row they belong to is replaced when the changed list comes back (its key follows the fields an
 * action changes), and until then a click would repeat an action the page already did.
 */
function useRun(untilNewData: boolean): [boolean, string | null, (work: () => Promise<unknown>) => Promise<void>] {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      if (!untilNewData) setBusy(false);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  };
  return [busy, error, run];
}

/** One company capability: what it is, who proposed and decided it, and what the owner may do with it now. */
function CustomRow({ c, nameOf, coordinatorId }: { c: CustomCapability; nameOf: (id: string) => string; coordinatorId: string | null }) {
  const [busy, error, run] = useRun(true);
  const [kind, setKind] = useState<CapabilityKind>(c.kind);
  const fresh = c.status === 'active' && c.decidedBy !== OWNER && c.decidedAt !== null && Date.now() - c.decidedAt < NEW_FOR_MS;
  return (
    <li aria-label={c.id} className={`capability ${c.status}`}>
      <div className="row">
        <span>
          <code>{c.id}</code> <strong>{c.title}</strong>
        </span>
        <span className="badges">
          <span className="badge">{CUSTOM_CAPABILITY_STATUS_LABELS[c.status]}</span>
          <span className="badge">{CAPABILITY_KIND_LABELS[c.kind]}</span>
          {fresh && <span className="badge new">yeni · koordinatör onayladı</span>}
        </span>
      </div>
      <p className="muted">{c.summary}</p>
      <p className="muted">
        araçlar: {c.tools.join(', ')} · öneren {nameOf(c.proposedBy)}
        {c.decidedBy ? ` · karar ${nameOf(c.decidedBy)}` : ''}
        {c.note ? ` · not: ${c.note}` : ''}
      </p>
      {c.status === 'proposed' && c.kind === 'read' && <p className="muted">okuma olarak yalnız sen kabul edersin — okuma her oturumda açıktır, kapıda serbesttir</p>}
      {c.status === 'proposed' && coordinatorId !== null && c.proposedBy === coordinatorId && <p className="muted">koordinatörün kendi önerisi — karar senin</p>}
      {needsConfirm(c) && <p className="muted">kapıda sana sorulur — sisteme açmak senin kararın</p>}
      {(c.status === 'proposed' || c.status === 'active') && (
        <div className="row end">
          <select aria-label={`${c.id} türü`} value={kind} onChange={(e) => setKind(e.target.value as CapabilityKind)}>
            <KindOptions />
          </select>
          {c.status === 'proposed' ? (
            <>
              <button type="button" disabled={busy} onClick={() => void run(() => api.decideCapability(c.id, false, { note: OWNER_REJECTED }))}>
                Reddet
              </button>
              <button type="button" className="primary" disabled={busy} onClick={() => void run(() => api.decideCapability(c.id, true, { kind }))}>
                Onayla
              </button>
            </>
          ) : (
            <>
              {needsConfirm(c) && (
                <button type="button" className="primary" disabled={busy} onClick={() => void run(() => api.confirmCapability(c.id))}>
                  Sisteme aç
                </button>
              )}
              <button type="button" disabled={busy || kind === c.kind} onClick={() => void run(() => api.setCapabilityKind(c.id, kind))}>
                Türü değiştir
              </button>
              <button type="button" disabled={busy} onClick={() => void run(() => api.retireCapability(c.id))}>
                Geri al
              </button>
            </>
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/** No kind to start with: the first one on the list would be read, the most permissive, and an owner in a hurry would take it. */
const EMPTY = { id: '', title: '', summary: '', kind: '' as CapabilityKind | '', tools: '' };

/** The owner's addition: active at once (the server checks the id, the kind and every tool, and says what is wrong). */
function AddForm() {
  const [draft, setDraft] = useState(EMPTY);
  const [busy, error, run] = useRun(false);
  const set = (patch: Partial<typeof EMPTY>) => setDraft({ ...draft, ...patch });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const { kind } = draft;
    if (kind === '') return;
    void run(async () => {
      await api.addCapability({ id: draft.id.trim(), title: draft.title.trim(), summary: draft.summary.trim(), kind, tools: draft.tools.split(/[\s,]+/).filter(Boolean) });
      setDraft(EMPTY);
    });
  };
  return (
    <form aria-label="Yetenek ekle" className="capability-add" onSubmit={submit}>
      <h3>Yetenek ekle</h3>
      <label>
        <span>Kimlik</span>
        <input aria-label="Kimlik" placeholder="sms.send" value={draft.id} onChange={(e) => set({ id: e.target.value })} />
      </label>
      <label>
        <span>Başlık</span>
        <input aria-label="Başlık" value={draft.title} onChange={(e) => set({ title: e.target.value })} />
      </label>
      <label>
        <span>Açıklama</span>
        <input aria-label="Açıklama" value={draft.summary} onChange={(e) => set({ summary: e.target.value })} />
      </label>
      <label>
        <span>Tür</span>
        <select aria-label="Tür" value={draft.kind} onChange={(e) => set({ kind: e.target.value as CapabilityKind | '' })}>
          <option value="">Tür seç…</option>
          <KindOptions />
        </select>
      </label>
      <label>
        <span>Araçlar</span>
        <textarea aria-label="Araçlar" rows={3} placeholder="mcp__sunucu__araç (satır başına bir)" value={draft.tools} onChange={(e) => set({ tools: e.target.value })} />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row end">
        <button type="submit" className="primary" disabled={busy || draft.kind === ''}>
          Ekle
        </button>
      </div>
    </form>
  );
}

/** Spec capabilities §9: the product's capabilities (read-only) and the company's own — waiting, active, past. */
export function CapabilitiesTab() {
  const rev = useOffice((s) => s.capabilitiesRev);
  const views = useOffice((s) => s.views);
  const nameOf = (id: string) => (id === OWNER ? 'sahibi' : (views[id]?.employee.name ?? id));
  const coordinatorId = Object.values(views).find((v) => v.employee.kind === 'coordinator' && v.employee.lifecycle !== 'archived')?.employee.id ?? null;
  const vocabulary = useLiveRead(rev, () => api.capabilities());
  const custom = useLiveRead(rev, () => api.customCapabilities());
  const product = (vocabulary.data?.capabilities ?? []).filter((c) => !c.company);
  const own = custom.data ?? [];
  const waiting = own.filter((c) => c.status === 'proposed');
  const active = own.filter((c) => c.status === 'active');
  const past = own
    .filter((c) => c.status === 'rejected' || c.status === 'retired')
    .sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0) || b.createdAt - a.createdAt)
    .slice(0, 10);
  const failed = vocabulary.error ?? custom.error;
  // An empty list is told only once the list has come: before that, or when it could not be read, it is not known to be empty.
  const known = custom.data !== null && !failed;
  const list = (items: CustomCapability[], empty: string) =>
    items.length ? (
      <ul>
        {items.map((c) => (
          <CustomRow key={`${c.id}:${c.status}:${c.kind}:${c.decidedBy}`} c={c} nameOf={nameOf} coordinatorId={coordinatorId} />
        ))}
      </ul>
    ) : (
      known && <p className="muted">{empty}</p>
    );
  return (
    <div className="capabilities">
      <p className="muted">
        Sözlükte olmayan bir bağlayıcı aracı dışa dönük sayılır, oturumlarda kapanır ve kapıda tutulur. Çalışan yetenek önerir, koordinatör karar verir; koordinatörün kendi önerisi sana gelir. Ödeme ve silme türündeki çağrılar her zaman sana sorulur; böyle bir yeteneği başka bir türe yalnız sen çekersin.
      </p>
      {failed && (
        <p className="error" role="alert">
          {failed}
        </p>
      )}
      <section aria-label="Karar bekleyenler">
        <h3>Karar bekleyenler</h3>
        {list(waiting, 'Bekleyen öneri yok.')}
      </section>
      <section aria-label="Şirketin yetenekleri">
        <h3>Şirketin yetenekleri</h3>
        {list(active, 'Şirketin eklediği etkin yetenek yok.')}
      </section>
      <AddForm />
      <section aria-label="Ürünle gelenler">
        <h3>Ürünle gelenler (sözlük sürümü {vocabulary.data?.version ?? '—'}, salt okunur)</h3>
        <table>
          <thead>
            <tr>
              <th>Kimlik</th>
              <th>Başlık</th>
              <th>Tür</th>
              <th>Açıklama</th>
            </tr>
          </thead>
          <tbody>
            {product.map((c) => (
              <tr key={c.id} aria-label={c.id}>
                <td>
                  <code>{c.id}</code>
                </td>
                <td>{c.title}</td>
                <td>{CAPABILITY_KIND_LABELS[c.kind]}</td>
                <td className="muted">{c.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {past.length > 0 && (
        <section aria-label="Geçmiş">
          <h3>Reddedilen ve geri alınanlar (son 10)</h3>
          {list(past, '')}
        </section>
      )}
    </div>
  );
}
