import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';
import { MetricChips } from './MetricChips.tsx';
import { QuotaHud } from './QuotaHud.tsx';
import { useMetrics } from './useMetrics.ts';

export function TopBar() {
  const runtime = useOffice((s) => s.runtime);
  const connected = useOffice((s) => s.connected);
  const quota = useOffice((s) => s.quota);
  const codexQuota = useOffice((s) => s.quotas?.codex);
  const count = useOffice((s) => Object.keys(s.views).length);
  const setHireOpen = useOffice((s) => s.setHireOpen);
  const setCompanyOpen = useOffice((s) => s.setCompanyOpen);
  const reserve = useOffice((s) => s.budget?.reserve.active ?? false);
  const paused = useOffice((s) => s.paused);
  const company = useOffice((s) => s.budget !== null);
  const metrics = useMetrics();
  const waiting = useOffice(
    (s) =>
      Object.values(s.plans).filter((p) => p.status === 'draft').length +
      Object.values(s.proposals).filter((p) => p.status === 'owner').length +
      Object.values(s.approvals).filter((a) => a.status === 'pending').length,
  );
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-name">control-center</span>
        {runtime && <span className="badge model">Claude + Codex</span>}
        <span className={`conn ${connected ? 'on' : 'off'}`}>{connected ? 'canlı' : 'bağlantı yok'}</span>
        <span className="muted">{count} çalışan</span>
      </div>
      <QuotaHud quota={quota} now={Date.now()} label={runtime?.mode === 'mixed' ? 'Claude' : undefined} />
      {codexQuota && <QuotaHud quota={codexQuota} now={Date.now()} label="Codex" />}
      {company && metrics && <MetricChips metrics={metrics} onOpen={() => setCompanyOpen(true, 'agenda')} />}
      {reserve && (
        <span className="badge reserve" title="Kota kullanımı sahibinin payına dayandı: ofis yalnız acil işleri başlatıyor.">
          Sahibinin payı korunuyor
        </span>
      )}
      {company && paused && <span className="badge paused">Şirket duraklatıldı</span>}
      {company && (
        <button type="button" onClick={() => void (paused ? api.resumeCompany() : api.pauseCompany()).catch(() => undefined)}>
          {paused ? 'Sürdür' : 'Şirketi duraklat'}
        </button>
      )}
      <button type="button" onClick={() => setCompanyOpen(true)}>
        Şirket
        {waiting > 0 && (
          <span className="count" aria-label={`${waiting} karar bekliyor`}>
            {waiting}
          </span>
        )}
      </button>
      <button type="button" className="primary" onClick={() => setHireOpen(true)}>
        + Çalışan al
      </button>
    </header>
  );
}
