import { Suspense, lazy, useEffect } from 'react';
import { loadManifest } from './assets/manifest.ts';
import { connectLive } from './net/live.ts';
import { useOffice } from './store/office.ts';
import { Cockpit } from './ui/Cockpit.tsx';
import { CompanyView } from './ui/CompanyView.tsx';
import { HireDialog } from './ui/HireDialog.tsx';
import { Panel } from './ui/Panel.tsx';
import { TopBar } from './ui/TopBar.tsx';

// The 3D office and its libraries (three, fiber, drei) load only when the owner switches to it: the flat page stays light.
const OfficeScene = lazy(() => import('./scene/OfficeScene.tsx').then((m) => ({ default: m.OfficeScene })));

export function App() {
  const selectedId = useOffice((s) => s.selectedId);
  const hireOpen = useOffice((s) => s.hireOpen);
  const companyOpen = useOffice((s) => s.companyOpen);
  const view = useOffice((s) => s.view);

  useEffect(() => {
    const store = useOffice.getState();
    void loadManifest().then(store.setManifest);
    void store.refresh();
    const preselected = new URLSearchParams(location.search).get('employee');
    if (preselected) store.select(preselected);
    return connectLive({
      onMessage: (m) => useOffice.getState().receive(m),
      onStatus: (connected) => useOffice.getState().setConnected(connected),
      getAfter: () => useOffice.getState().lastSeq,
    });
  }, []);

  return (
    <div className={`app ${view === 'scene' ? 'scene-view' : 'flat'}`}>
      {view === 'scene' ? (
        <Suspense fallback={<p className="scene-loading muted">3D ofis yükleniyor…</p>}>
          <OfficeScene />
        </Suspense>
      ) : null}
      <TopBar />
      {view === 'flat' && <Cockpit />}
      {/* Keyed by employee so a draft, the side-question switch or an error never carries over to someone else. In the flat view the cockpit shows the desk in its middle column. */}
      {selectedId && view === 'scene' && <Panel key={selectedId} id={selectedId} />}
      {hireOpen && <HireDialog />}
      {companyOpen && <CompanyView />}
    </div>
  );
}
