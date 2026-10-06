import { useEffect, useState } from 'react';
import { characterAsset } from '../assets/manifest.ts';
import { behaviorOf } from '../office/behavior.ts';
import { LAYOUT, spotFor } from '../office/layout.ts';

const ESPRESSO = LAYOUT.furniture.find((p) => p.assetId === 'espresso_machine');
import { useOffice } from '../store/office.ts';
import { openToolSince } from '../store/reducers.ts';
import { Character } from './Character.tsx';
import { Steam } from './Steam.tsx';
import { TagLayout } from './TagLayout.tsx';


function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function CharactersLayer() {
  const views = useOffice((s) => s.views);
  const usage = useOffice((s) => s.usage);
  const manifest = useOffice((s) => s.manifest);
  const typingAt = useOffice((s) => s.typingAt);
  const selectedId = useOffice((s) => s.selectedId);
  const tasks = useOffice((s) => s.tasks);
  const plans = useOffice((s) => s.plans);
  const pings = useOffice((s) => s.pings);
  const unseenReports = useOffice((s) => s.unseenReports);
  const now = useNow(1000);

  const placed = Object.values(views)
    .filter((v) => v.employee.lifecycle !== 'archived')
    .map((v) => {
      const e = v.employee;
      const behavior = behaviorOf({
        lifecycle: e.lifecycle,
        openToolSince: openToolSince(v),
        idleSince: v.idleSince ?? e.createdAt,
        ownerTypingAt: typingAt[e.id] ?? null,
        now,
        wanderSeed: e.deskIndex,
        planning: e.kind === 'coordinator' && Object.values(plans).some((p) => p.status === 'draft' && p.proposedBy === e.id),
      });
      return { view: v, behavior, spot: spotFor(LAYOUT, behavior.zone, e.deskIndex) };
    });

  return (
    <group>
      {placed.map(({ view, behavior, spot }) => {
        const e = view.employee;
        return (
          <Character
            key={e.id}
            employee={e}
            behavior={behavior}
            spot={spot}
            asset={characterAsset(manifest, e.characterId)}
            usage={usage[e.id]}
            selected={selectedId === e.id}
            task={Object.values(tasks).find((t) => t.assignee === e.id && t.status === 'in_progress')?.title ?? null}
            ping={pings[e.id] && now - pings[e.id]!.at < 8000 ? pings[e.id]!.text : null}
            reports={unseenReports[e.id] ?? 0}
          />
        );
      })}
      {/* The machine steams while someone is having a coffee. */}
      {ESPRESSO && placed.some((p) => p.behavior.zone === 'coffee') ? <Steam position={[ESPRESSO.x, ESPRESSO.y + ESPRESSO.h, ESPRESSO.z]} /> : null}
      <TagLayout />
    </group>
  );
}
