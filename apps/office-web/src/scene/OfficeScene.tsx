import { MapControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { LAYOUT } from '../office/layout.ts';
import { useOffice } from '../store/office.ts';
import { AZIMUTH, CAMERA_POSITION } from './camera.ts';
import { CharactersLayer } from './CharactersLayer.tsx';
import { FurnitureLayer } from './FurnitureLayer.tsx';
import { Room } from './Room.tsx';

export function OfficeScene() {
  const select = useOffice((s) => s.select);
  return (
    <Canvas
      className="scene"
      orthographic
      shadows
      dpr={[1, 2]}
      camera={{ position: [...CAMERA_POSITION], zoom: 34, near: -200, far: 400 }}
      onPointerMissed={() => select(null)}
    >
      <color attach="background" args={['#e6e9ef']} />
      <hemisphereLight args={['#ffffff', '#9aa0aa', 1.25]} />
      <directionalLight
        position={[12, 28, 10]}
        intensity={1.8}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
      />
      {/* The office's centre sits at the origin so the camera, light and controls all aim at it. */}
      <group position={[-LAYOUT.width / 2, 0, -LAYOUT.depth / 2]}>
        <Room />
        <FurnitureLayer />
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
        minZoom={16}
        maxZoom={140}
      />
    </Canvas>
  );
}
