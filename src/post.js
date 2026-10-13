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
  Pass,
} from 'postprocessing';

/*
 * Transparent things the clouds must not paint over, such as the waterfalls. They write no depth, so
 * the cloud pass would treat them as open sky and cover them. This draws them after the clouds,
 * still hidden behind the islands by the scene's depth.
 */
class OverlayPass extends Pass {
  constructor(scene, camera, composer) {
    super('OverlayPass', scene, camera);
    this.needsSwap = false;
    this.composer = composer;
  }

  render(renderer, inputBuffer) {
    const target = this.renderToScreen ? null : inputBuffer;
    renderer.setRenderTarget(target);
    // The buffer the clouds drew into has no scene depth yet: copy it from the composer's copy.
    const src = this.composer.depthRenderTarget;
    if (src && target) {
      const gl = renderer.getContext();
      const props = renderer.properties;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, props.get(src).__webglFramebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, props.get(target).__webglFramebuffer);
      gl.blitFramebuffer(0, 0, src.width, src.height, 0, 0, target.width, target.height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      renderer.setRenderTarget(null);
      renderer.setRenderTarget(target);
    }
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = auto;
  }
}

// Bloom, filmic tone mapping, a light colour grade and anti-aliasing.
export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.camera = camera;
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.composer.addPass(new RenderPass(scene, camera));
    this.overlay = new THREE.Scene();
    this.composer.addPass(new OverlayPass(this.overlay, camera, this.composer));

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
