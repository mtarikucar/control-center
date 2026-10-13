import { Html } from '@react-three/drei';
import { memo, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { useRoomStates, useRoomTags, type RoomState, type SignText } from './rooms.ts';

const SIGN_W = 1.3;
const SIGN_H = 0.4;

/** A sign's text drawn on a canvas here (no font is downloaded: the office runs offline); dim for a dark room. */
function signTexture(text: SignText, lit: boolean): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 520;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = lit ? '#2b2f36' : '#1c1e22';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // The name as large as fits: a department's name runs to 40 characters.
    let size = 64;
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    while (size > 28 && ctx.measureText(text.title).width > canvas.width - 40) {
      size -= 4;
      ctx.font = `600 ${size}px system-ui, sans-serif`;
    }
    ctx.fillStyle = lit ? '#f6efe2' : '#8a8d93';
    ctx.fillText(text.title, canvas.width / 2, text.subtitle ? 62 : 80, canvas.width - 40);
    if (text.subtitle) {
      ctx.font = '400 34px system-ui, sans-serif';
      ctx.fillStyle = lit ? '#d9b07a' : '#6d7076';
      ctx.fillText(text.subtitle, canvas.width / 2, 124, canvas.width - 40);
    }
  }
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Over the door, for the hub and the room alike: two faces back to back, so both read the right way round. */
function DoorSign({ state }: { state: RoomState }) {
  const { title, subtitle } = state.sign;
  const texture = useMemo(() => signTexture({ title, subtitle }, state.lit), [title, subtitle, state.lit]);
  useEffect(() => () => texture.dispose(), [texture]);
  const { x, y, z, rotY } = state.room.sign;
  return (
    <group name={`room-sign-${state.room.index}`} position={[x, y, z]} rotation={[0, rotY, 0]}>
      <mesh castShadow>
        <boxGeometry args={[SIGN_W + 0.06, SIGN_H + 0.06, 0.03]} />
        <meshStandardMaterial color="#2b2f36" roughness={0.6} />
      </mesh>
      {[0, Math.PI].map((turn) => (
        <mesh key={turn} position={[0, 0, turn === 0 ? 0.016 : -0.016]} rotation={[0, turn, 0]}>
          <planeGeometry args={[SIGN_W, SIGN_H]} />
          <meshBasicMaterial map={texture} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/** Below the people's tags (theirs is [20, 0]): a person's tag wins any overlap. */
const ROOM_TAG_Z: [number, number] = [10, 0];
/** drei applies its pointerEvents prop only to a transformed tag; this one is not, so the style says it too. */
const NO_POINTER: CSSProperties = { pointerEvents: 'none' };

/**
 * A screen-sized tag on the floor of each room an open department holds (final review I2): the door sign is about
 * 31 × 10 px at the start zoom, too small to read. Only the room's colour and the department's name: the ★ on a
 * person's own tag says who heads it. It never takes a click or a drag from the view or the characters.
 */
export const RoomTags = memo(function RoomTags() {
  const tags = useRoomTags();
  // drei's <Html> renders nothing if it mounts before the canvas is attached to the page (as Character's tag): one render later.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return null;
  return (
    <>
      {tags.map((t) => (
        <Html key={t.room} name={`room-tag-${t.room}`} position={t.position} center zIndexRange={ROOM_TAG_Z} pointerEvents="none" style={NO_POINTER}>
          <div className="room-tag">
            <span className="room-tag-swatch" style={{ background: t.colour }} />
            <span className="room-tag-name">{t.name}</span>
          </div>
        </Html>
      ))}
    </>
  );
});

/** The six rooms' carpets (the department's colour, dark grey otherwise), door signs (spec office rooms §4.2) and floor tags. */
export function RoomsLayer() {
  const states = useRoomStates();
  return (
    <group>
      <RoomTags />
      {states.map((s) => {
        const c = s.room.carpet;
        return (
          <group key={s.room.index}>
            <mesh name={`room-carpet-${s.room.index}`} position={[(c.x1 + c.x2) / 2, 0.012, (c.z1 + c.z2) / 2]} receiveShadow>
              <boxGeometry args={[c.x2 - c.x1, 0.022, c.z2 - c.z1]} />
              <meshStandardMaterial color={s.carpet} roughness={1} />
            </mesh>
            <DoorSign state={s} />
          </group>
        );
      })}
    </group>
  );
}
