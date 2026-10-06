import { useEffect, useState } from 'react';
import { characterAsset, characterAssets } from '../assets/manifest.ts';
import { behaviorOf } from '../office/behavior.ts';
import { LAYOUT, spotFor, tagLift } from '../office/layout.ts';
import { useOffice } from '../store/office.ts';
import { openToolSince } from '../store/reducers.ts';
import { Character } from './Character.tsx';

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
  const now = useNow(1000);
  const fallbackAsset = characterAssets(manifest)[0] ?? null;

  return (
    <group>
      {Object.values(views)
        .filter((v) => v.employee.lifecycle !== 'archived')
        .map((v) => {
          const e = v.employee;
          const behavior = behaviorOf({
            lifecycle: e.lifecycle,
            openToolSince: openToolSince(v),
            idleSince: v.lastTurnFinishedAt ?? e.createdAt,
            ownerTypingAt: typingAt[e.id] ?? null,
            now,
            wanderSeed: e.deskIndex,
          });
          return (
            <Character
              key={e.id}
              employee={e}
              behavior={behavior}
              spot={spotFor(LAYOUT, behavior.zone, e.deskIndex)}
              tagHeight={2.15 + tagLift(LAYOUT, behavior.zone, e.deskIndex)}
              asset={characterAsset(manifest, e.characterId) ?? fallbackAsset}
              usage={usage[e.id]}
              selected={selectedId === e.id}
            />
          );
        })}
    </group>
  );
}
