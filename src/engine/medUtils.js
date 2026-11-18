/**
 * Lightweight Medical Visualization Helpers (/home/antigravity/catheter-3d-med/src/engine/medUtils.js)
 * Provides shared MaterialRegistry, BufferGeometry merging, and additive volumetric glow sprites.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function safeMerge(geos) {
  const validRaw = geos.filter(Boolean);
  const keepColors =
    validRaw.length > 0 && validRaw.every((g) => Boolean(g.attributes && g.attributes.color));
  const valid = validRaw.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g.clone();
    if (!ng.attributes.normal) ng.computeVertexNormals();
    if (!ng.attributes.uv) {
      const count = ng.attributes.position.count;
      ng.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    for (const k of Object.keys(ng.attributes)) {
      if (k !== 'position' && k !== 'normal' && k !== 'uv' && !(keepColors && k === 'color')) {
        ng.deleteAttribute(k);
      }
    }
    return ng;
  });
  return mergeGeometries(valid, false);
}

let cachedGlowTex = null;
export function getRadialGlowTexture() {
  if (cachedGlowTex) return cachedGlowTex;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  g.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  g.addColorStop(0.28, 'rgba(255, 255, 255, 0.58)');
  g.addColorStop(0.65, 'rgba(255, 255, 255, 0.14)');
  g.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  cachedGlowTex = new THREE.CanvasTexture(c);
  cachedGlowTex.colorSpace = THREE.SRGBColorSpace;
  return cachedGlowTex;
}

export function createGlowSprite(color = '#38BDF8', scale = 1.0, opacity = 0.65) {
  const mat = new THREE.SpriteMaterial({
    map: getRadialGlowTexture(),
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(scale, scale, 1);
  return spr;
}

export class MaterialRegistry {
  constructor() {
    this.map = new Map();
  }

  getStandard(key, props) {
    if (this.map.has(key)) return this.map.get(key);
    const mat = new THREE.MeshStandardMaterial(props);
    this.map.set(key, mat);
    return mat;
  }

  getBasic(key, props) {
    if (this.map.has(key)) return this.map.get(key);
    const mat = new THREE.MeshBasicMaterial(props);
    this.map.set(key, mat);
    return mat;
  }

  count() {
    return this.map.size;
  }
}
