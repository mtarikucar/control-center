import { useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { LAYOUT, type Frame } from '../office/layout.ts';

const COLORS = ['#e07a3a', '#2f7c83', '#f3d9a4', '#283a6b', '#d9b07a', '#c0392b', '#5f9a4a'];

/** Abstract art in the reference's palette: blocks, discs and stripes on a warm canvas, different for every seed. */
function artTexture(seed: number, w: number, h: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(160 * w);
  canvas.height = Math.round(160 * h);
  const ctx = canvas.getContext('2d');
  let r = seed * 7919;
  const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  if (ctx) {
    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = '#f6efe2';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 6; i += 1) {
      ctx.fillStyle = COLORS[Math.floor(rand() * COLORS.length)]!;
      const kind = rand();
      if (kind < 0.4) ctx.fillRect(rand() * W * 0.7, rand() * H * 0.7, W * (0.2 + rand() * 0.4), H * (0.15 + rand() * 0.35));
      else if (kind < 0.75) {
        ctx.beginPath();
        ctx.arc(rand() * W, rand() * H, Math.min(W, H) * (0.12 + rand() * 0.22), 0, Math.PI * 2);
        ctx.fill();
      } else {
        const y = rand() * H;
        ctx.fillRect(0, y, W, H * 0.06);
      }
    }
  }
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function ArtFrame({ f }: { f: Frame }) {
  const art = useMemo(() => artTexture(f.seed, f.w, f.h), [f.seed, f.w, f.h]);
  return (
    <group position={[f.x, f.y, f.z]} rotation={[0, f.rotY, 0]}>
      <mesh castShadow>
        <boxGeometry args={[f.w + 0.08, f.h + 0.08, 0.04]} />
        <meshStandardMaterial color="#2b2f36" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0, 0.021]}>
        <planeGeometry args={[f.w, f.h]} />
        <meshStandardMaterial map={art} roughness={0.9} />
      </mesh>
    </group>
  );
}

export function ArtFrames() {
  return (
    <group>
      {LAYOUT.frames.map((f, i) => (
        <ArtFrame key={i} f={f} />
      ))}
    </group>
  );
}
