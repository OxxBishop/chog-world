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
    this.camera = camera;
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.85, luminanceSmoothing: 0.25, intensity: 0.6, radius: 0.65, resolutionScale: 0.5 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    const sat = new HueSaturationEffect({ saturation: 0.32 });
    const contrast = new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.14 });
    const vignette = new VignetteEffect({ offset: 0.5, darkness: 0.22 });
    this.composer.addPass(new EffectPass(camera, this.bloom, tone, sat, contrast, vignette));
    this.smaaPass = new EffectPass(camera, new SMAAEffect());
    this.composer.addPass(this.smaaPass);
  }

  // Glow is for lamps, windows and the aurora: keep it faint under a bright day sky so the scene stays crisp.
  setNight(n) {
    this.bloom.intensity = 0.15 + n * 0.5;
    this.bloom.luminanceMaterial.threshold = 0.95 - n * 0.12;
  }

  // Clouds read the scene's depth, so they go straight after the scene is drawn.
  addClouds(effects) {
    this.cloudPass = new EffectPass(this.camera, ...effects);
    this.composer.addPass(this.cloudPass, 1);
  }

  // At a pixel ratio of 2 and up the anti-aliasing pass is not needed. At 1.5 it still is: edges
  // visibly stair-step without it.
  setPixelRatio(ratio) {
    const want = ratio < 2;
    const has = this.composer.passes.includes(this.smaaPass);
    if (want && !has) this.composer.addPass(this.smaaPass);
    if (!want && has) this.composer.removePass(this.smaaPass);
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
  }

  render(dt) {
    this.composer.render(dt);
  }
}
