import * as THREE from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  ToneMappingEffect,
  ToneMappingMode,
  HueSaturationEffect,
  BrightnessContrastEffect,
  VignetteEffect,
  SMAAEffect,
} from 'postprocessing';

// Bloom, filmic tone mapping, a light colour grade and anti-aliasing.
export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.85, luminanceSmoothing: 0.25, intensity: 0.6, radius: 0.65, resolutionScale: 0.5 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    const sat = new HueSaturationEffect({ saturation: 0.32 });
    const contrast = new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.14 });
    const vignette = new VignetteEffect({ offset: 0.5, darkness: 0.22 });
    this.composer.addPass(new EffectPass(camera, this.bloom, tone, sat, contrast, vignette));
    this.composer.addPass(new EffectPass(camera, new SMAAEffect()));
  }

  // Glow is for lamps, windows and the aurora: keep it faint under a bright day sky so the scene stays crisp.
  setNight(n) {
    this.bloom.intensity = 0.15 + n * 0.5;
    this.bloom.luminanceMaterial.threshold = 0.95 - n * 0.12;
  }

  // The cloud sea needs the scene's depth, so it runs straight after the scene is drawn.
  addClouds(pass) {
    this.composer.addPass(pass, 1);
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
  }

  render(dt) {
    this.composer.render(dt);
  }
}
