import { useState, type FormEvent } from 'react';
import { MODEL_ALIASES, type ModelAlias } from '@cc/shared';
import { VOXEL_CHARACTER, characterAssets } from '../assets/manifest.ts';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';
import { MODEL_LABELS } from './labels.ts';

export function HireDialog() {
  const manifest = useOffice((s) => s.manifest);
  const setHireOpen = useOffice((s) => s.setHireOpen);
  const select = useOffice((s) => s.select);
  const admit = useOffice((s) => s.admit);
  const characters = characterAssets(manifest);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [model, setModel] = useState<ModelAlias>('sonnet');
  const [character, setCharacter] = useState(characters[0]?.id ?? VOXEL_CHARACTER);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const hired = await api.hire({ name, role, model, characterId: character });
      setHireOpen(false);
      admit(hired);
      select(hired.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onClick={() => setHireOpen(false)}>
      <form className="dialog" role="dialog" aria-label="Çalışan al" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <h2>Çalışan al</h2>
        <div className="field">
          <label htmlFor="hire-name">Ad</label>
          <input id="hire-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="hire-role">Rol tanımı</label>
          <textarea id="hire-role" value={role} onChange={(e) => setRole(e.target.value)} rows={5} required placeholder="Ne iş yapacak, nasıl çalışacak?" />
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="hire-model">Model</label>
            <select id="hire-model" value={model} onChange={(e) => setModel(e.target.value as ModelAlias)}>
              {MODEL_ALIASES.map((m) => (
                <option key={m} value={m}>
                  {MODEL_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="hire-character">Karakter</label>
            <select id="hire-character" value={character} onChange={(e) => setCharacter(e.target.value)}>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value={VOXEL_CHARACTER}>Voksel figür</option>
            </select>
          </div>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row end">
          <button type="button" onClick={() => setHireOpen(false)}>
            Vazgeç
          </button>
          <button type="submit" className="primary" disabled={busy}>
            İşe al
          </button>
        </div>
      </form>
    </div>
  );
}
