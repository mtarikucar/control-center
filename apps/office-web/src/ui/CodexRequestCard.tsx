import { useEffect, useState } from 'react';
import { api } from '../net/api.ts';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const text = (v: unknown) => typeof v === 'string' ? v : '';

/** Sensitive form fields and answers are fetched live, never persisted as chat events. */
export function CodexRequestCard({ employeeId, requestId }: { employeeId: string; requestId: string }) {
  const [request, setRequest] = useState<{ method: string; params: Obj } | null>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const refresh = () => void api.codexRequests(employeeId).then(items => {
      if (live) setRequest(items.find(r => r.id === requestId) ?? null);
    }).catch(e => { if (live) setError(String(e)); });
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => { live = false; clearInterval(timer); };
  }, [employeeId, requestId]);
  if (request === null) return <div className="note">Codex isteği kapandı.</div>;
  if (!request) return <div className="note">{error || 'Codex isteği yükleniyor…'}</div>;
  const p = request.params;
  const questions = request.method === 'item/tool/requestUserInput';
  const permissions = request.method === 'item/permissions/requestApproval';
  const urlMode = p.mode === 'url';
  const schema = obj(p.requestedSchema);
  const fields: Array<[string, Obj]> = questions
    ? (Array.isArray(p.questions) ? p.questions.map(q => { const value = obj(q); return [text(value.id), value]; }) : [])
    : Object.entries(obj(schema.properties)).map(([k, v]) => [k, obj(v)]);
  const url = text(p.url);
  const safeUrl = /^https?:\/\//i.test(url) ? url : '';
  const answer = async (action: 'accept' | 'decline') => {
    setBusy(true); setError('');
    try {
      const content: Obj = {};
      for (const [key, field] of action === 'accept' ? fields : []) {
        const value = values[key] ?? '';
        const required = questions || (Array.isArray(schema.required) && schema.required.includes(key));
        if (action === 'accept' && required && !value.trim()) throw new Error(`${text(field.title) || text(field.question) || key}: yanıt gerekli.`);
        if (!value && !required) continue;
        content[key] = questions ? { answers: [value] }
          : field.type === 'boolean' ? value === 'true'
          : field.type === 'number' || field.type === 'integer' ? JSON.parse(value)
          : field.type === 'array' || field.type === 'object' ? JSON.parse(value) : value;
      }
      await api.answerCodexRequest(employeeId, requestId, action, content);
      setValues({}); setRequest(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <section className="msg assistant">
    <strong>{questions ? 'Codex bir yanıt bekliyor' : permissions ? 'Codex izin istiyor' : `${text(p.serverName) || 'Bağlantı'} bir yanıt bekliyor`}</strong>
    <p>{text(p.message) || text(p.reason)}</p>
    {permissions && <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(p.permissions, null, 2)}</pre>}
    {urlMode && (safeUrl ? <a href={safeUrl} target="_blank" rel="noreferrer">Bağlantıyı aç</a> : <p>Bağlantı adresi desteklenmiyor.</p>)}
    {fields.map(([key, field]) => {
      const options = Array.isArray(field.options) ? field.options.map(o => text(obj(o).label))
        : Array.isArray(field.enum) ? field.enum.map(String) : field.type === 'boolean' ? ['true', 'false'] : [];
      return <label key={key} style={{ display: 'block', margin: '8px 0' }}>
        {text(field.question) || text(field.title) || key}
        {text(field.description) && <small style={{ display: 'block' }}>{text(field.description)}</small>}
        {options.length > 0 && !questions
          ? <select value={values[key] ?? ''} onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))}><option value="">Seç…</option>{options.map(o => <option key={o} value={o}>{o === 'true' ? 'Evet' : o === 'false' ? 'Hayır' : o}</option>)}</select>
          : <><input style={{ width: '100%' }} type={field.isSecret ? 'password' : 'text'} value={values[key] ?? ''} onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))} />
            {questions && options.map(o => <button key={o} type="button" onClick={() => setValues(v => ({ ...v, [key]: o }))}>{o}</button>)}</>}
      </label>;
    })}
    {error && <p role="alert">{error}</p>}
    <button disabled={busy || (urlMode && !safeUrl)} onClick={() => void answer('accept')}>{questions ? 'Yanıtla' : urlMode ? 'Tamamladım' : 'Onayla'}</button>
    <button disabled={busy} onClick={() => void answer('decline')}>Reddet</button>
  </section>;
}
