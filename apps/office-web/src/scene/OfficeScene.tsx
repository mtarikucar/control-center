import { MapControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { LAYOUT } from '../office/layout.ts';
import { useOffice } from '../store/office.ts';
import { AZIMUTH, CAMERA_POSITION, CAMERA_ZOOM } from './camera.ts';
import { CharactersLayer } from './CharactersLayer.tsx';
import { DeskDressing, ServerLights } from './DeskDressing.tsx';
import { Effects } from './Effects.tsx';
import { FurnitureLayer } from './FurnitureLayer.tsx';
import { Backdrop, Lighting } from './Lighting.tsx';
import { Room } from './Room.tsx';

export function OfficeScene() {
  const select = useOffice((s) => s.select);
  return (
    <Canvas
      className="scene"
      orthographic
      shadows
      dpr={[1, 2]}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      camera={{ position: [...CAMERA_POSITION], zoom: CAMERA_ZOOM, near: -200, far: 400 }}
      onPointerMissed={() => select(null)}
    >
      <Backdrop />
      <Lighting />
      {/* The office's centre sits at the origin so the camera, light and controls all aim at it, nudged towards the
          camera so its far corner clears the top bar. */}
      <group position={[-LAYOUT.width / 2 + 1.1, 0, -LAYOUT.depth / 2 + 1.1]}>
        <Room />
        <FurnitureLayer />
        <DeskDressing />
        <ServerLights />
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
        minZoom={22}
        maxZoom={160}
      />
      <Effects />
    </Canvas>
  );
}
