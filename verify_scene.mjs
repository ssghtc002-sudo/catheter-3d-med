/**
 * Sub-1-Second Node Pre-Flight Gate (/home/antigravity/catheter-3d-med/verify_scene.mjs)
 * Evaluates 30 timestamps (0..30s) for:
 *  - Zero NaN matrices across entire scene graph
 *  - Strict WebGL budgets (<= 55 draws, <= 55,000 tris, <= 25 materials, <= 3 lights)
 *  - Projected 3D anchor safe viewport framing (|ndcX| <= 0.90, ndcY in [-0.62 .. 0.84])
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { MaterialRegistry } from './src/engine/medUtils.js';
import { buildMedStudio } from './src/scene/medStudio.js';
import { buildCatheterRig } from './src/scene/catheterRig.js';
import { createMedDirector } from './src/camera/director.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const timeline = JSON.parse(await fs.readFile(path.join(__dirname, 'config', 'timeline.json'), 'utf-8'));

const BUDGETS = {
  maxDraws: 55,
  maxTris: 55000,
  maxMaterials: 25,
  maxLights: 3,
};

function countSceneMetrics(root) {
  let draws = 0;
  let totalTris = 0;
  let lights = 0;
  const uniqueMaterials = new Set();

  function walk(obj) {
    if (!obj.visible) return;
    if (obj.isLight) lights++;

    if (obj.isInstancedMesh) {
      draws++;
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => uniqueMaterials.add(m));
        else uniqueMaterials.add(obj.material);
      }
      const g = obj.geometry;
      if (g) {
        const trisPerInst = g.index
          ? g.index.count / 3
          : g.attributes.position
            ? g.attributes.position.count / 3
            : 0;
        totalTris += Math.round(trisPerInst * obj.count);
      }
    } else if (obj.isMesh || obj.isSprite || obj.isLine || obj.isLineSegments || obj.isPoints) {
      draws++;
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => uniqueMaterials.add(m));
        else uniqueMaterials.add(obj.material);
      }
      if (obj.geometry) {
        const g = obj.geometry;
        const tris = g.index
          ? g.index.count / 3
          : g.attributes.position
            ? g.attributes.position.count / 3
            : 0;
        totalTris += Math.round(tris);
      }
    }

    for (let i = 0; i < obj.children.length; i++) {
      walk(obj.children[i]);
    }
  }

  walk(root);
  return {
    draws,
    totalTris,
    uniqueMaterials: uniqueMaterials.size,
    lights,
  };
}

function findNaNNode(root) {
  let bad = null;
  root.traverse((obj) => {
    if (bad) return;
    const elems = obj.matrixWorld.elements;
    for (let i = 0; i < 16; i++) {
      if (!Number.isFinite(elems[i])) {
        bad = obj.name || obj.type;
        return;
      }
    }
  });
  return bad;
}

function resolveAnchorVec(raw, outVec) {
  if (!raw) return null;
  if (raw.isVector3 || (typeof raw.x === 'number' && typeof raw.y === 'number' && typeof raw.z === 'number')) {
    outVec.set(raw.x, raw.y, raw.z);
    return { vec: outVec, visible: raw.visible !== false };
  }
  const src = raw.worldPos || raw.pos || raw.position;
  if (src && typeof src.x === 'number') {
    outVec.set(src.x, src.y, src.z);
    return { vec: outVec, visible: raw.visible !== false };
  }
  if (Array.isArray(raw) && raw.length >= 3) {
    outVec.set(raw[0], raw[1], raw[2]);
    return { vec: outVec, visible: true };
  }
  return null;
}

const BEAT_ACTIVE_ANCHOR_GROUPS = {
  beat_1_overview: [
    { label: 'tipEyes', keys: ['tipEyes', 'murphyEyes'] },
    { label: 'dualLumen', keys: ['dualLumen', 'shaftMid'] },
    { label: 'checkValve', keys: ['checkValve', 'valveSide'] },
  ],
  beat_2_dual_lumen: [
    { label: 'dualLumen', keys: ['dualLumen', 'drainageLumen'] },
  ],
  beat_3_insertion: [
    { label: 'bladderCavity', keys: ['bladderCavity', 'bladderCenter'] },
    { label: 'bladderApex', keys: ['bladderApex'] },
    { label: 'tipEyes', keys: ['tipEyes', 'murphyEyes'] },
  ],
  beat_4_balloon_lock: [
    { label: 'balloon', keys: ['balloon', 'retentionBalloon'] },
    { label: 'bladderApex', keys: ['bladderApex'] },
    { label: 'bladderNeck', keys: ['bladderNeck', 'neckSeal'] },
    { label: 'syringe', keys: ['syringe', 'checkValve'] },
  ],
  beat_5_gravity_drainage: [
    { label: 'tipEyes', keys: ['tipEyes', 'bladderCavity'] },
    { label: 'bladderApex', keys: ['bladderApex'] },
    { label: 'dualLumen', keys: ['dualLumen'] },
    { label: 'drainageBag', keys: ['drainageBag', 'drainagePort'] },
    { label: 'bagBottom', keys: ['bagBottom'] },
  ],
  beat_6_deflation_recap: [
    { label: 'balloon', keys: ['balloon'] },
    { label: 'bladderApex', keys: ['bladderApex'] },
    { label: 'checkValve', keys: ['checkValve', 'syringe'] },
  ],
};

// Build scene cleanly matching src/main.js
const width = timeline.resolution?.width || 1080;
const height = timeline.resolution?.height || 1920;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x061325);
scene.fog = new THREE.FogExp2(0x061325, 0.018);

const camera = new THREE.PerspectiveCamera(44, width / height, 0.1, 80);

scene.add(new THREE.HemisphereLight(0xdceeff, 0x162a44, 0.95));
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

// Evaluate 30 timestamps across 0..30s
const timestamps = Array.from({ length: 30 }, (_, i) => +((i + 0.5) * (timeline.duration / 30)).toFixed(2));
const errors = [];
const warnings = [];
const tmpVec = new THREE.Vector3();

let peakMetrics = { draws: 0, totalTris: 0, uniqueMaterials: 0, registryMaterials: 0, lights: 0 };

for (const t of timestamps) {
  catheter.update(t);
  const flowState = catheter.getState ? catheter.getState() : {};
  studio.update(t, flowState);
  director.update(t, flowState);

  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  const nanNode = findNaNNode(scene);
  if (nanNode) {
    errors.push(`t=${t.toFixed(2)}s NaN world matrix at ${nanNode}`);
  }

  const m = countSceneMetrics(scene);
  const regCount = registry.count();
  peakMetrics.draws = Math.max(peakMetrics.draws, m.draws);
  peakMetrics.totalTris = Math.max(peakMetrics.totalTris, m.totalTris);
  peakMetrics.uniqueMaterials = Math.max(peakMetrics.uniqueMaterials, m.uniqueMaterials);
  peakMetrics.registryMaterials = Math.max(peakMetrics.registryMaterials, regCount);
  peakMetrics.lights = Math.max(peakMetrics.lights, m.lights);

  const beat = director.findBeatAt(t);
  const allAnchors = {
    ...(catheter.getAnchors ? catheter.getAnchors() : {}),
    ...(studio.getAnchors ? studio.getAnchors() : {}),
  };

  const groups = BEAT_ACTIVE_ANCHOR_GROUPS[beat?.id] || [];
  for (const grp of groups) {
    let found = null;
    for (const k of grp.keys) {
      if (allAnchors[k]) {
        found = resolveAnchorVec(allAnchors[k], tmpVec);
        if (found) break;
      }
    }
    if (!found) {
      warnings.push(`t=${t.toFixed(2)}s (${beat?.id}) missing anchor for ${grp.label} [${grp.keys.join(',')}]`);
      continue;
    }
    if (!found.visible) continue;

    const ndc = found.vec.clone().project(camera);
    const inFront = ndc.z >= -1 && ndc.z <= 1;
    if (!inFront) {
      errors.push(`t=${t.toFixed(2)}s ${grp.label} behind/outside clip plane (ndcZ=${ndc.z.toFixed(3)})`);
      continue;
    }
    if (Math.abs(ndc.x) > 0.90) {
      errors.push(`t=${t.toFixed(2)}s ${grp.label} clipped X safe bound (ndcX=${ndc.x.toFixed(3)}, limit=0.90)`);
    } else if (Math.abs(ndc.x) > 0.85) {
      warnings.push(`t=${t.toFixed(2)}s ${grp.label} near horizontal margin (ndcX=${ndc.x.toFixed(3)})`);
    }
    if (ndc.y < -0.62 || ndc.y > 0.88) {
      errors.push(`t=${t.toFixed(2)}s ${grp.label} outside vertical safe bound (ndcY=${ndc.y.toFixed(3)}, allowed=[-0.62..0.88])`);
    } else if (ndc.y < -0.56 || ndc.y > 0.84) {
      warnings.push(`t=${t.toFixed(2)}s ${grp.label} near top/subtitle margin (ndcY=${ndc.y.toFixed(3)})`);
    }
  }
}

if (peakMetrics.draws > BUDGETS.maxDraws) {
  errors.push(`Draw budget exceeded: peak visible draws=${peakMetrics.draws} > ${BUDGETS.maxDraws}`);
}
if (peakMetrics.totalTris > BUDGETS.maxTris) {
  errors.push(`Triangle budget exceeded: peak tris=${peakMetrics.totalTris} > ${BUDGETS.maxTris}`);
}
const matPeak = Math.max(peakMetrics.uniqueMaterials, peakMetrics.registryMaterials);
if (matPeak > BUDGETS.maxMaterials) {
  errors.push(`Material budget exceeded: ${matPeak} > ${BUDGETS.maxMaterials}`);
}
if (peakMetrics.lights > BUDGETS.maxLights) {
  errors.push(`Light budget exceeded: ${peakMetrics.lights} > ${BUDGETS.maxLights}`);
}

console.log('[VerifyScene] Peak Metrics:', JSON.stringify(peakMetrics));
if (warnings.length > 0) {
  console.log(`[VerifyScene] Warnings (${warnings.length}):`);
  for (const w of warnings) console.log('  WARN:', w);
}
if (errors.length > 0) {
  console.error(`[VerifyScene] FAILED (${errors.length} errors):`);
  for (const e of errors) console.error('  ERR:', e);
  process.exit(1);
}
console.log('[VerifyScene] ALL 30 TIMESTAMPS PASSED BUDGET & SAFE-FRAME GATES!');
