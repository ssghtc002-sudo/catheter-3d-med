/**
 * Medical Catheter 3D Clinical Animation Main App (/home/antigravity/catheter-3d-med/src/main.js)
 * Integrates clinical 3-light studio, dual-lumen Foley catheter rig, documentary camera director,
 * 3D-projected vector callout HUD, and deterministic WebCodecs frame compositor.
 */
import * as THREE from 'three';
import { MaterialRegistry } from './engine/medUtils.js';
import { buildMedStudio } from './scene/medStudio.js';
import { buildCatheterRig } from './scene/catheterRig.js';
import { createMedDirector } from './camera/director.js';
import { createMedHud, createFrameCompositor } from './hud/medHud.js';

function resolveAnchorInput(raw, outVec) {
  if (!raw) return null;
  if (raw.isVector3 || (typeof raw.x === 'number' && typeof raw.y === 'number' && typeof raw.z === 'number')) {
    outVec.set(raw.x, raw.y, raw.z);
    return { vec: outVec, visible: raw.visible !== false };
  }
  const vecSrc = raw.worldPos || raw.pos || raw.position;
  if (vecSrc && typeof vecSrc.x === 'number') {
    outVec.set(vecSrc.x, vecSrc.y, vecSrc.z);
    return { vec: outVec, visible: raw.visible !== false };
  }
  if (Array.isArray(raw) && raw.length >= 3) {
    outVec.set(raw[0], raw[1], raw[2]);
    return { vec: outVec, visible: true };
  }
  return null;
}

async function init() {
  const [timeline, manifest] = await Promise.all([
    fetch('/config/timeline.json').then((r) => r.json()),
    fetch('/audio/output/voice_manifest.json').then((r) => r.json()).catch(() => null),
  ]);

  const width = timeline.resolution?.width || 1080;
  const height = timeline.resolution?.height || 1920;
  const fps = timeline.fps || 30;
  const duration = timeline.duration || 30.0;
  const totalFrames = timeline.totalFrames || 900;

  const webglCanvas = document.getElementById('webgl-canvas');
  const hudCanvas = document.getElementById('hud-canvas');

  const renderer = new THREE.WebGLRenderer({
    canvas: webglCanvas,
    antialias: true,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x061325);
  scene.fog = new THREE.FogExp2(0x061325, 0.018);

  const camera = new THREE.PerspectiveCamera(44, width / height, 0.1, 80);

  // Strict 3-Light Clinical Studio Cap
  const hemiLight = new THREE.HemisphereLight(0xdceeff, 0x162a44, 0.95);
  scene.add(hemiLight);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.85);
  keyLight.position.set(3.5, 5.0, 6.0);
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.15);
  rimLight.position.set(-4.5, 2.5, -3.5);
  scene.add(rimLight);

  const registry = new MaterialRegistry();
  const studio = buildMedStudio(scene, registry, timeline);
  const catheter = buildCatheterRig(scene, registry, timeline);
  const director = createMedDirector(camera, timeline);
  const hud = createMedHud(timeline, manifest, hudCanvas);
  const compositor = createFrameCompositor(webglCanvas, hudCanvas, width, height);

  const tmpVec = new THREE.Vector3();

  function projectAnchors(rawAnchors) {
    const out = {};
    if (!rawAnchors) return out;
    for (const [key, val] of Object.entries(rawAnchors)) {
      const resolved = resolveAnchorInput(val, tmpVec);
      if (!resolved) continue;
      resolved.vec.project(camera);
      const inFront = resolved.vec.z >= -1 && resolved.vec.z <= 1;
      const x = (resolved.vec.x * 0.5 + 0.5) * width;
      const y = (1 - (resolved.vec.y * 0.5 + 0.5)) * height;
      out[key] = {
        x,
        y,
        ndcX: resolved.vec.x,
        ndcY: resolved.vec.y,
        visible: resolved.visible && inFront && Math.abs(resolved.vec.x) <= 1.05 && Math.abs(resolved.vec.y) <= 1.05,
      };
    }
    return out;
  }

  function renderFrame(frameIdx) {
    const f = Math.max(0, Math.min(totalFrames - 1, Math.round(frameIdx)));
    const t = f / fps;

    catheter.update(t);
    const flowState = catheter.getState ? catheter.getState() : {};
    studio.update(t, flowState);
    director.update(t, flowState);

    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    const rawAnchors = {
      ...(catheter.getAnchors ? catheter.getAnchors() : {}),
      ...(studio.getAnchors ? studio.getAnchors() : {}),
    };
    if (rawAnchors.dualLumen && !rawAnchors.drainageLumen) {
      rawAnchors.drainageLumen = new THREE.Vector3(
        rawAnchors.dualLumen.x - 0.015,
        rawAnchors.dualLumen.y + 0.07,
        rawAnchors.dualLumen.z
      );
      rawAnchors.inflationLumen = new THREE.Vector3(
        rawAnchors.dualLumen.x + 0.034,
        rawAnchors.dualLumen.y - 0.07,
        rawAnchors.dualLumen.z
      );
    }
    const screenAnchors = projectAnchors(rawAnchors);

    renderer.render(scene, camera);
    hud.draw(t, flowState, screenAnchors);

    return {
      frame: f,
      t: +t.toFixed(4),
      calls: renderer.info.render.calls,
      tris: renderer.info.render.triangles,
      materials: registry.count(),
    };
  }

  window.__RENDER_FRAME__ = renderFrame;
  window.__GET_COMPOSITE_CANVAS__ = () => compositor.composite();
  window.__TIMELINE__ = timeline;
  window.__SCENE_READY__ = true;

  renderFrame(0);

  const params = new URLSearchParams(window.location.search);
  if (!params.has('render')) {
    const startMs = performance.now();
    function tick() {
      const elapsed = ((performance.now() - startMs) / 1000) % duration;
      renderFrame(Math.round(elapsed * fps));
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
}

init().catch((err) => {
  console.error('[Main Init Error]', err);
});
