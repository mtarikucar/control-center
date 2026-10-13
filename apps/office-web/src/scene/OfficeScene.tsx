import { MapControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { LAYOUT } from '../office/layout.ts';
import { useOffice } from '../store/office.ts';
import { ArtFrames } from './ArtFrames.tsx';
import { Beam } from './Beam.tsx';
import { AZIMUTH, CAMERA_POSITION, MAX_ZOOM, keepInView, minZoom, panLimits, sceneOrigin, startZoom, type Pannable } from './camera.ts';
import { CharactersLayer } from './CharactersLayer.tsx';
import { DeskDressing, ServerLights } from './DeskDressing.tsx';
import { Effects } from './Effects.tsx';
import { FurnitureLayer } from './FurnitureLayer.tsx';
import { Backdrop, Lighting } from './Lighting.tsx';
import { Room } from './Room.tsx';
import { RoomsLayer } from './RoomsLayer.tsx';

// The view sized from the floor (spec office rooms §6): start zoom, zoom-out limit, where the floor sits, how far it drags.
const ORIGIN = sceneOrigin(LAYOUT.width, LAYOUT.depth);
const PAN = panLimits(LAYOUT.width, LAYOUT.depth);
// At module scope: drei connects the controls again whenever this handler changes.
const holdOverFloor = (e?: { target: unknown }) => {
  if (e?.target) keepInView(e.target as Pannable, PAN);
};

export function OfficeScene() {
  const select = useOffice((s) => s.select);
  return (
    <Canvas
      className="scene"
      orthographic
      shadows="percentage"
      dpr={[1, 2]}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      camera={{ position: [...CAMERA_POSITION], zoom: startZoom(LAYOUT.width, LAYOUT.depth), near: -200, far: 400 }}
      onPointerMissed={() => select(null)}
    >
      <Backdrop />
      <Lighting />
      <group position={ORIGIN}>
        <Room />
        <RoomsLayer />
        <FurnitureLayer />
        <ArtFrames />
        <DeskDressing />
        <ServerLights />
        <Beam />
        <CharactersLayer />
      </group>
      <MapControls
        makeDefault
        target={[0, 0, 0]}
        enableDamping
        maxPolarAngle={Math.PI / 2.6}
        minPolarAngle={Math.PI / 6}
        minAzimuthAngle={AZIMUTH.min}
        maxAzimuthAngle={AZIMUTH.max}
        minZoom={minZoom(LAYOUT.width, LAYOUT.depth)}
        maxZoom={MAX_ZOOM}
        onChange={holdOverFloor}
      />
      <Effects />
    </Canvas>
  );
}
