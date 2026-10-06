import { Environment, Lightformer } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { PALETTE } from './palette.ts';

/** A soft vertical gradient behind the office, like the reference's slate-blue backdrop. */
export function Backdrop() {
  const scene = useThree((s) => s.scene);
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, PALETTE.backdropTop);
      g.addColorStop(1, PALETTE.backdropBottom);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 4, 256);
    }
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => {
    const previous = scene.background;
    scene.background = texture;
    return () => {
      scene.background = previous;
      texture.dispose();
    };
  }, [scene, texture]);
  return null;
}

/**
 * Late-afternoon sun through the west windows, a warm sky fill, and a few warm panels for the glossy surfaces to
 * reflect. The lamps add their own light where they stand (FurnitureLayer).
 */
export function Lighting() {
  return (
    <>
      <hemisphereLight args={[PALETTE.sky, PALETTE.ground, 0.5]} />
      <directionalLight
        color={PALETTE.sun}
        position={[-13, 13, 5]}
        intensity={3.4}
        castShadow
        shadow-mapSize-width={4096}
        shadow-mapSize-height={4096}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-camera-near={1}
        shadow-camera-far={60}
        shadow-radius={3}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />
      <directionalLight color="#ffe2c2" position={[10, 8, 12]} intensity={0.45} />
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={2.2} color="#ffd6a8" position={[-8, 4, 0]} rotation-y={Math.PI / 2} scale={[12, 4, 1]} />
        <Lightformer form="rect" intensity={1.2} color="#fff1e0" position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[16, 12, 1]} />
        <Lightformer form="rect" intensity={0.6} color="#c9d4ea" position={[8, 3, 8]} rotation-y={-Math.PI / 4} scale={[10, 3, 1]} />
      </Environment>
    </>
  );
}
