import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';

/**
 * The reference's warmth comes as much from the image as from the models: soft contact shadows where things meet
 * (ambient occlusion), lamps and screens that glow (bloom), filmic tone mapping and a light vignette.
 */
export function Effects() {
  return (
    <EffectComposer multisampling={0}>
      <N8AO aoRadius={1.1} distanceFalloff={0.7} intensity={3.6} color="#2a1e14" halfRes />
      <Bloom mipmapBlur luminanceThreshold={0.92} luminanceSmoothing={0.15} intensity={0.85} radius={0.65} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.28} darkness={0.38} />
      <SMAA />
    </EffectComposer>
  );
}
