import { useFBO } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import {
  Color,
  Matrix4,
  MeshStandardMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  UnsignedByteType,
  Vector3,
  type Camera,
  type Mesh,
} from 'three';

interface Props {
  width: number;
  depth: number;
  color: string;
  /** 0 = matt, 1 = a mirror. */
  strength: number;
  /** Softness of the reflection, in pixels of the reflection image. */
  blur: number;
}

const UP = new Vector3(0, 1, 0);
const BIAS = new Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

/**
 * Polished concrete. drei's MeshReflectorMaterial clips with an oblique near plane, which only works for perspective
 * cameras; the office is drawn with an orthographic one. Here the room is drawn from a camera mirrored under the
 * floor, cut at the floor by a clipping plane (camera-agnostic), and the floor blends in a softly blurred sample of
 * that image.
 */
export function ReflectiveFloor({ width, depth, color, strength, blur }: Props) {
  const floor = useRef<Mesh>(null);
  const size = useThree((s) => s.size);
  const target = useFBO(Math.min(1024, size.width), Math.min(1024, size.height), { samples: 0, type: UnsignedByteType });
  const state = useMemo(
    () => ({
      textureMatrix: new Matrix4(),
      clip: [new Plane(UP.clone(), 0)],
      virtual: null as Camera | null,
      planePos: new Vector3(),
      camPos: new Vector3(),
      lookAt: new Vector3(),
      view: new Vector3(),
      background: new Color(color),
    }),
    [color],
  );
  const material = useMemo(() => {
    const m = new MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.02 });
    const uniforms = {
      tReflect: { value: target.texture },
      textureMatrix: { value: state.textureMatrix },
      uStrength: { value: strength },
      uTexel: { value: blur / 1024 },
    };
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = `uniform mat4 textureMatrix;\nvarying vec4 vReflectCoord;\n${shader.vertexShader}`.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvReflectCoord = textureMatrix * vec4(position, 1.0);',
      );
      shader.fragmentShader = `uniform sampler2D tReflect;\nuniform float uStrength;\nuniform float uTexel;\nvarying vec4 vReflectCoord;\n${shader.fragmentShader}`.replace(
        '#include <opaque_fragment>',
        `vec2 ruv = vReflectCoord.xy / vReflectCoord.w;
        vec3 reflection = vec3(0.0);
        float wsum = 0.0;
        for (int i = -2; i <= 2; i++) {
          for (int j = -2; j <= 2; j++) {
            float w = 1.0 / (1.0 + float(i * i + j * j));
            reflection += texture2D(tReflect, ruv + vec2(float(i), float(j)) * uTexel).rgb * w;
            wsum += w;
          }
        }
        reflection /= wsum;
        outgoingLight = mix(outgoingLight, reflection, uStrength);
        #include <opaque_fragment>`,
      );
    };
    return m;
  }, [blur, color, state, strength, target.texture]);

  // Runs before the composer draws the frame.
  useFrame(({ gl, scene, camera }) => {
    const mesh = floor.current;
    if (!mesh) return;
    if (!state.virtual || state.virtual.type !== camera.type) {
      state.virtual = camera instanceof OrthographicCamera ? new OrthographicCamera() : new PerspectiveCamera();
    }
    const virtual = state.virtual as OrthographicCamera | PerspectiveCamera;
    mesh.updateMatrixWorld();
    state.planePos.setFromMatrixPosition(mesh.matrixWorld);
    state.camPos.setFromMatrixPosition(camera.matrixWorld);
    // Mirror the camera's position, its view direction and its up vector across the floor plane.
    state.view.subVectors(state.planePos, state.camPos).reflect(UP).negate().add(state.planePos);
    virtual.position.copy(state.view);
    state.lookAt.set(0, 0, -1).applyMatrix4(new Matrix4().extractRotation(camera.matrixWorld)).add(state.camPos);
    state.view.subVectors(state.planePos, state.lookAt).reflect(UP).negate().add(state.planePos);
    virtual.up.set(0, 1, 0).applyMatrix4(new Matrix4().extractRotation(camera.matrixWorld)).reflect(UP);
    virtual.lookAt(state.view);
    if (camera instanceof OrthographicCamera && virtual instanceof OrthographicCamera) {
      virtual.left = camera.left;
      virtual.right = camera.right;
      virtual.top = camera.top;
      virtual.bottom = camera.bottom;
      virtual.zoom = camera.zoom;
    }
    virtual.near = (camera as OrthographicCamera).near;
    virtual.far = (camera as OrthographicCamera).far;
    virtual.updateMatrixWorld();
    virtual.projectionMatrix.copy(camera.projectionMatrix);
    state.textureMatrix.copy(BIAS).multiply(virtual.projectionMatrix).multiply(virtual.matrixWorldInverse).multiply(mesh.matrixWorld);
    state.clip[0]!.constant = -state.planePos.y;

    const background = scene.background;
    const clipping = gl.clippingPlanes;
    mesh.visible = false;
    scene.background = state.background;
    gl.clippingPlanes = state.clip;
    gl.setRenderTarget(target);
    gl.clear();
    gl.render(scene, virtual);
    gl.setRenderTarget(null);
    gl.clippingPlanes = clipping;
    scene.background = background;
    mesh.visible = true;
  });

  return (
    <mesh ref={floor} position={[width / 2, 0.001, depth / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={material}>
      <planeGeometry args={[width, depth]} />
    </mesh>
  );
}
