/**
 * Biomedical Studio Environment, Translucent Pelvic Bladder & Urethral Cutaway,
 * Dynamic Urine Drainage System & Closed Graduated Collection Bag.
 * (/home/antigravity/catheter-3d-med/src/scene/medStudio.js)
 */
import * as THREE from 'three';
import { MaterialRegistry, safeMerge, createGlowSprite } from '../engine/medUtils.js';

const PI = Math.PI;
const CUT_PHI_START = PI * 0.36;
const CUT_PHI_LENGTH = PI * 1.28; // Leaves front +Z (-64.8° .. +64.8°) cleanly open
const CUT_PHI_END = CUT_PHI_START + CUT_PHI_LENGTH;

const DROPLET_COUNT = 32;
const BAG_MAX_ML = 300;
const BAG_LIQUID_HEIGHT = 0.72;
const BAG_LIQUID_BOTTOM_Y = -0.36;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(e0, e1, x) {
  const u = clamp01((x - e0) / (e1 - e0));
  return u * u * (3 - 2 * u);
}

/**
 * Procedural radial sterile coordinate grid canvas texture for y = -3.15 floor.
 */
function createGroundGridTexture() {
  if (typeof document === 'undefined') return null;
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const cx = size * 0.5;
  const cy = size * 0.5;

  ctx.clearRect(0, 0, size, size);

  // Subtle dark-sapphire radial wash fading smoothly at edge
  const bg = ctx.createRadialGradient(cx, cy, 8, cx, cy, 248);
  bg.addColorStop(0.0, 'rgba(18, 62, 108, 0.36)');
  bg.addColorStop(0.45, 'rgba(12, 40, 74, 0.22)');
  bg.addColorStop(0.82, 'rgba(6, 20, 40, 0.06)');
  bg.addColorStop(1.0, 'rgba(4, 14, 28, 0.0)');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(cx, cy, 250, 0, PI * 2);
  ctx.fill();

  // Concentric precision clinical measurement rings
  const rings = [
    { r: 44, alpha: 0.34, width: 1.6 },
    { r: 92, alpha: 0.26, width: 1.3 },
    { r: 142, alpha: 0.20, width: 1.2 },
    { r: 192, alpha: 0.14, width: 1.1 },
    { r: 236, alpha: 0.07, width: 1.0 },
  ];
  for (const ring of rings) {
    ctx.strokeStyle = `rgba(56, 189, 248, ${ring.alpha})`;
    ctx.lineWidth = ring.width;
    ctx.beginPath();
    ctx.arc(cx, cy, ring.r, 0, PI * 2);
    ctx.stroke();
  }

  // Orthogonal axes & 30-degree radial calibration ticks
  ctx.lineWidth = 1.0;
  for (let i = 0; i < 12; i++) {
    const a = (i * PI) / 6;
    const isAxis = i % 3 === 0;
    const r0 = isAxis ? 18 : 44;
    const r1 = isAxis ? 236 : 196;
    const grad = ctx.createLinearGradient(
      cx + Math.cos(a) * r0,
      cy + Math.sin(a) * r0,
      cx + Math.cos(a) * r1,
      cy + Math.sin(a) * r1
    );
    grad.addColorStop(0.0, isAxis ? 'rgba(56, 189, 248, 0.28)' : 'rgba(56, 189, 248, 0.16)');
    grad.addColorStop(1.0, 'rgba(56, 189, 248, 0.0)');
    ctx.strokeStyle = grad;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.stroke();
  }

  // Subtle dashed outer calibration ring
  ctx.save();
  ctx.setLineDash([4, 8]);
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.20)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(cx, cy, 166, 0, PI * 2);
  ctx.stroke();
  ctx.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Procedural 512x768 sterile graduated mL measurement face texture for Collection Bag.
 * Mapped cleanly onto PlaneGeometry(0.48, 0.76) centered at y_local = 0:
 *   0 mL   -> y_local = -0.36
 *   300 mL -> y_local = +0.36
 */
function createBagScaleTexture() {
  if (typeof document === 'undefined') return null;
  const w = 512;
  const h = 768;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  const mlToPxY = (ml) => {
    const yLocal = BAG_LIQUID_BOTTOM_Y + (ml / BAG_MAX_ML) * BAG_LIQUID_HEIGHT;
    const vNorm = (0.38 - yLocal) / 0.76;
    return vNorm * h;
  };

  // Subtle translucent sterile border frame
  ctx.strokeStyle = 'rgba(186, 230, 253, 0.42)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(14, 10, w - 28, h - 20, 28);
  ctx.stroke();

  // Header clinical micro-badge
  ctx.fillStyle = 'rgba(8, 28, 52, 0.58)';
  ctx.beginPath();
  ctx.roundRect(220, 20, 250, 44, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#BAE6FD';
  ctx.font = 'bold 21px "DejaVu Sans", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CLOSED DRAINAGE', 345, 43);

  // Fine graduation lines every 25 mL, major labels at 50, 100, 150, 200, 250, 300 mL
  const majorLabels = new Set([50, 100, 200, 300]);
  for (let ml = 25; ml <= 300; ml += 25) {
    const py = mlToPxY(ml);
    const isMajor = majorLabels.has(ml);
    const isMid = ml === 150 || ml === 250;

    // Dark backing stroke for legibility over glowing amber fluid
    ctx.strokeStyle = 'rgba(4, 14, 28, 0.72)';
    ctx.lineWidth = isMajor ? 6 : isMid ? 4.5 : 3;
    ctx.beginPath();
    ctx.moveTo(42, py);
    ctx.lineTo(isMajor ? 168 : isMid ? 128 : 96, py);
    ctx.stroke();

    // Crisp sterile cyan-white tick mark
    ctx.strokeStyle = isMajor ? 'rgba(240, 249, 255, 0.96)' : isMid ? 'rgba(186, 230, 253, 0.80)' : 'rgba(125, 211, 252, 0.52)';
    ctx.lineWidth = isMajor ? 3.5 : isMid ? 2.5 : 1.6;
    ctx.beginPath();
    ctx.moveTo(42, py);
    ctx.lineTo(isMajor ? 168 : isMid ? 128 : 96, py);
    ctx.stroke();

    // Subtle full-width dashed reference line on major graduations
    if (isMajor) {
      ctx.save();
      ctx.setLineDash([7, 9]);
      ctx.strokeStyle = 'rgba(224, 242, 254, 0.28)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(176, py);
      ctx.lineTo(w - 40, py);
      ctx.stroke();
      ctx.restore();

      const labelText = `${ml} mL`;
      ctx.font = 'bold 31px "DejaVu Sans", Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(4, 14, 28, 0.85)';
      ctx.strokeText(labelText, 184, py + 1);
      ctx.fillStyle = '#F0F9FF';
      ctx.fillText(labelText, 184, py + 1);
    }
  }

  // Zero baseline marker
  const y0 = mlToPxY(0);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(42, y0);
  ctx.lineTo(w - 42, y0);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Helper to assign uniform vertex color across a non-indexed BufferGeometry.
 */
function colorizeGeometry(geo, hexColor) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const count = g.attributes.position.count;
  const col = new THREE.Color(hexColor);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/**
 * Builds the continuous curved Pelvic Bladder + Urethral Canal open-front (+Z) cutaway rings
 * strictly aligned to worldContract.
 */
function buildAnatomyProfileRings(wc) {
  const neckY = wc.bladderNeckY ?? 0.18;
  const entryY = wc.urethraEntryY ?? -1.05;
  const entryZ = wc.urethraEntryZ ?? 0.15;
  const bladderCtr = wc.bladderCenter || [0.0, 0.95, 0.0];
  const equY = bladderCtr[1];
  const centerX = bladderCtr[0];
  const centerZ = bladderCtr[2];

  // Smooth C1-ish spline control points from urethra meatus up to bladder equator
  const lowerCtrl = [
    new THREE.Vector3(0.155, entryY, 0.080),
    new THREE.Vector3(0.126, lerp(entryY, neckY, 0.12), 0.082),
    new THREE.Vector3(0.122, lerp(entryY, neckY, 0.50), 0.085),
    new THREE.Vector3(0.128, lerp(entryY, neckY, 0.87), 0.092),
    new THREE.Vector3(0.148, neckY, 0.100), // Bladder neck constriction
    new THREE.Vector3(0.305, lerp(neckY, equY, 0.16), 0.102), // Trigone cradle
    new THREE.Vector3(0.475, lerp(neckY, equY, 0.40), 0.104), // Balloon zone
    new THREE.Vector3(0.585, lerp(neckY, equY, 0.72), 0.105), // Murphy eyes level
    new THREE.Vector3(0.615, equY, 0.105), // Equator (dr/dy ~ 0)
  ];

  const lowerCurve = new THREE.CatmullRomCurve3(lowerCtrl, false, 'catmullrom', 0.45);
  const lowerSamples = 34;
  const rings = [];

  for (let i = 0; i <= lowerSamples; i++) {
    const u = i / lowerSamples;
    const p = lowerCurve.getPoint(u);
    const rIn = Math.max(0.08, p.x);
    const y = p.y;
    const thick = p.z;
    // Smooth urethral curve: entryZ at entryY -> centerZ at neckY
    const zBlend = smoothstep(neckY, entryY, y);
    const zC = lerp(centerZ, entryZ, zBlend);
    rings.push({
      yIn: y,
      rIn,
      yOut: y,
      rOut: rIn + thick,
      xC: centerX,
      zC,
    });
  }

  // Elliptical dome rings from equator (a = 0) to roof apex (a = PI/2)
  const domeSamples = 20;
  const eqRIn = 0.615;
  const eqROut = 0.720;
  const domeHIn = 0.71;  // Inner apex y = 0.95 + 0.71 = 1.66
  const domeHOut = 0.805; // Outer apex y = 0.95 + 0.805 = 1.755
  for (let k = 1; k <= domeSamples; k++) {
    const a = (k / domeSamples) * (PI * 0.5);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    rings.push({
      yIn: equY + domeHIn * sa,
      rIn: k === domeSamples ? 0.0 : eqRIn * ca,
      yOut: equY + domeHOut * sa,
      rOut: k === domeSamples ? 0.0 : eqROut * ca,
      xC: centerX,
      zC: centerZ,
    });
  }

  return rings;
}

/**
 * Evaluates inner bladder radius & z-center at height y from the rings array.
 */
function createInnerEvaluator(rings) {
  return function evalInnerAtY(y) {
    if (y <= rings[0].yIn) {
      return { r: rings[0].rIn, xC: rings[0].xC, zC: rings[0].zC };
    }
    for (let i = 0; i < rings.length - 1; i++) {
      const a = rings[i];
      const b = rings[i + 1];
      if (y >= a.yIn && y <= b.yIn) {
        const span = Math.max(1e-5, b.yIn - a.yIn);
        const u = clamp01((y - a.yIn) / span);
        return {
          r: lerp(a.rIn, b.rIn, u),
          xC: lerp(a.xC, b.xC, u),
          zC: lerp(a.zC, b.zC, u),
        };
      }
    }
    const last = rings[rings.length - 1];
    return { r: last.rIn, xC: last.xC, zC: last.zC };
  };
}

/**
 * Builds outer detrusor shell + beveled cut-section rim geometry (merged, vertex-colored)
 * and inner mucosa lining geometry with organic micro-rugae.
 */
function buildBladderGeometries(rings, radialSegs = 44) {
  const numRings = rings.length;
  const cols = radialSegs + 1;

  // 1. Outer detrusor shell (outward normals)
  const outerPos = [];
  const outerUv = [];
  const outerIdx = [];

  // 2. Inner mucosa shell (inward normals, organic folds inside bladder cavity)
  const innerPos = [];
  const innerUv = [];
  const innerIdx = [];

  for (let i = 0; i < numRings; i++) {
    const ring = rings[i];
    const vCoord = i / (numRings - 1);

    for (let j = 0; j < cols; j++) {
      const uPhi = j / radialSegs;
      const phi = CUT_PHI_START + uPhi * CUT_PHI_LENGTH;
      const sPhi = Math.sin(phi);
      const cPhi = Math.cos(phi);

      // Outer vertex
      outerPos.push(
        ring.xC + ring.rOut * sPhi,
        ring.yOut,
        ring.zC + ring.rOut * cPhi
      );
      outerUv.push(uPhi, vCoord);

      // Subtle organic mucosal rugae inside bladder body (zeroed smoothly at neck & cut edges)
      const edgeFade = Math.sin(uPhi * PI);
      const neckFade = smoothstep(0.24, 0.50, ring.yIn);
      const apexFade = smoothstep(0.0, 0.25, ring.rIn);
      const rugae =
        edgeFade *
        neckFade *
        apexFade *
        0.011 *
        (Math.sin(phi * 9.0 + ring.yIn * 4.5) * 0.65 + Math.cos(phi * 15.0 - ring.yIn * 6.5) * 0.35);

      const rMucosa = Math.max(0.0, ring.rIn - rugae);
      innerPos.push(
        ring.xC + rMucosa * sPhi,
        ring.yIn,
        ring.zC + rMucosa * cPhi
      );
      innerUv.push(uPhi, vCoord);
    }
  }

  for (let i = 0; i < numRings - 1; i++) {
    for (let j = 0; j < radialSegs; j++) {
      const v00 = i * cols + j;
      const v01 = i * cols + (j + 1);
      const v10 = (i + 1) * cols + j;
      const v11 = (i + 1) * cols + (j + 1);

      // Outward normals: (dP/dphi) x (dP/di)
      outerIdx.push(v00, v01, v11, v00, v11, v10);

      // Inward normals: (dP/di) x (dP/dphi)
      innerIdx.push(v00, v11, v01, v00, v10, v11);
    }
  }

  const outerGeo = new THREE.BufferGeometry();
  outerGeo.setAttribute('position', new THREE.Float32BufferAttribute(outerPos, 3));
  outerGeo.setAttribute('uv', new THREE.Float32BufferAttribute(outerUv, 2));
  outerGeo.setIndex(outerIdx);
  outerGeo.computeVertexNormals();

  const innerGeo = new THREE.BufferGeometry();
  innerGeo.setAttribute('position', new THREE.Float32BufferAttribute(innerPos, 3));
  innerGeo.setAttribute('uv', new THREE.Float32BufferAttribute(innerUv, 2));
  innerGeo.setIndex(innerIdx);
  innerGeo.computeVertexNormals();

  // 3. Beveled Cut-Section Wall Thickness Caps (Right wall phiStart, Left wall phiEnd, Bottom meatus rim)
  const cutPos = [];
  const cutUv = [];
  const cutIdx = [];

  const pushQuad = (a, b, c, d) => {
    const base = cutPos.length / 3;
    cutPos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2]);
    cutUv.push(0, 0, 1, 0, 1, 1, 0, 1);
    cutIdx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  // Right cut wall (phi = CUT_PHI_START, +X side, cut normal points forward-left toward +Z)
  // Left cut wall (phi = CUT_PHI_END, -X side, cut normal points forward-right toward +Z)
  const sR = Math.sin(CUT_PHI_START);
  const cR = Math.cos(CUT_PHI_START);
  const sL = Math.sin(CUT_PHI_END);
  const cL = Math.cos(CUT_PHI_END);

  for (let i = 0; i < numRings - 1; i++) {
    const r0 = rings[i];
    const r1 = rings[i + 1];

    // Right wall: mid-bevel pushed slightly forward (+0.010 along normal) for specular highlight
    const inR0 = [r0.xC + r0.rIn * sR, r0.yIn, r0.zC + r0.rIn * cR];
    const outR0 = [r0.xC + r0.rOut * sR, r0.yOut, r0.zC + r0.rOut * cR];
    const inR1 = [r1.xC + r1.rIn * sR, r1.yIn, r1.zC + r1.rIn * cR];
    const outR1 = [r1.xC + r1.rOut * sR, r1.yOut, r1.zC + r1.rOut * cR];

    const midR0 = [
      (inR0[0] + outR0[0]) * 0.5 - cR * 0.009,
      (inR0[1] + outR0[1]) * 0.5,
      (inR0[2] + outR0[2]) * 0.5 + sR * 0.009,
    ];
    const midR1 = [
      (inR1[0] + outR1[0]) * 0.5 - cR * 0.009,
      (inR1[1] + outR1[1]) * 0.5,
      (inR1[2] + outR1[2]) * 0.5 + sR * 0.009,
    ];
    // Outward normal (-cos, 0, +sin): dP/dr x dP/di -> order (in0, out0, out1, in1)
    pushQuad(inR0, midR0, midR1, inR1);
    pushQuad(midR0, outR0, outR1, midR1);

    // Left wall: mid-bevel pushed slightly forward along normal (+cos(phiEnd), 0, -sin(phiEnd))
    const inL0 = [r0.xC + r0.rIn * sL, r0.yIn, r0.zC + r0.rIn * cL];
    const outL0 = [r0.xC + r0.rOut * sL, r0.yOut, r0.zC + r0.rOut * cL];
    const inL1 = [r1.xC + r1.rIn * sL, r1.yIn, r1.zC + r1.rIn * cL];
    const outL1 = [r1.xC + r1.rOut * sL, r1.yOut, r1.zC + r1.rOut * cL];

    const midL0 = [
      (inL0[0] + outL0[0]) * 0.5 + cL * 0.009,
      (inL0[1] + outL0[1]) * 0.5,
      (inL0[2] + outL0[2]) * 0.5 - sL * 0.009,
    ];
    const midL1 = [
      (inL1[0] + outL1[0]) * 0.5 + cL * 0.009,
      (inL1[1] + outL1[1]) * 0.5,
      (inL1[2] + outL1[2]) * 0.5 - sL * 0.009,
    ];
    // Outward normal (+cos, 0, -sin): dP/di x dP/dr -> order (in0, in1, out1, out0)
    pushQuad(inL0, inL1, midL1, midL0);
    pushQuad(midL0, midL1, outL1, outL0);
  }

  // Bottom urethral meatus rim cap (y = entryY, facing -Y)
  const bRing = rings[0];
  for (let j = 0; j < radialSegs; j++) {
    const phi0 = CUT_PHI_START + (j / radialSegs) * CUT_PHI_LENGTH;
    const phi1 = CUT_PHI_START + ((j + 1) / radialSegs) * CUT_PHI_LENGTH;
    const s0 = Math.sin(phi0);
    const c0 = Math.cos(phi0);
    const s1 = Math.sin(phi1);
    const c1 = Math.cos(phi1);
    const i0 = [bRing.xC + bRing.rIn * s0, bRing.yIn, bRing.zC + bRing.rIn * c0];
    const i1 = [bRing.xC + bRing.rIn * s1, bRing.yIn, bRing.zC + bRing.rIn * c1];
    const o1 = [bRing.xC + bRing.rOut * s1, bRing.yOut, bRing.zC + bRing.rOut * c1];
    const o0 = [bRing.xC + bRing.rOut * s0, bRing.yOut, bRing.zC + bRing.rOut * c0];
    pushQuad(i0, o0, o1, i1);
  }

  const cutGeo = new THREE.BufferGeometry();
  cutGeo.setAttribute('position', new THREE.Float32BufferAttribute(cutPos, 3));
  cutGeo.setAttribute('uv', new THREE.Float32BufferAttribute(cutUv, 2));
  cutGeo.setIndex(cutIdx);
  cutGeo.computeVertexNormals();

  // Merge outer shell (#C85A6B) + cut-section rim (#E38291) into 1 mesh with vertexColors
  const outerColored = colorizeGeometry(outerGeo, '#C85A6B');
  const cutColored = colorizeGeometry(cutGeo, '#E38291');
  const mergedOuterAndCut = safeMerge([outerColored, cutColored]);

  outerGeo.dispose();
  cutGeo.dispose();
  outerColored.dispose();
  cutColored.dispose();

  return { outerAndCutGeo: mergedOuterAndCut, innerGeo };
}

/**
 * Builds the dynamic conforming Bladder Urine Pool geometry + updater.
 * Always hugs evalInnerAtY(y) - 0.012 across y ∈ [yBase, yTop] with a flat cutaway front chord
 * and shimmering top meniscus so urine NEVER pokes through bladder walls as it drains.
 */
function buildDynamicUrinePool(evalInnerAtY) {
  const V_SEGS = 7; // 8 vertical rings
  const ARC_SEGS = 20; // 21 points along curved back wall
  const CHORD_SEGS = 6; // 7 points along flat front cutaway chord

  const arcCols = ARC_SEGS + 1;
  const chordCols = CHORD_SEGS + 1;
  const ringVertCount = arcCols + chordCols + 2; // arc + chord + 2 meniscus/bottom centers

  // Allocate static vertex buffer layout:
  // Section 0: Curved back perimeter (V_SEGS+1) * arcCols
  // Section 1: Flat front cutaway chord (V_SEGS+1) * chordCols
  // Section 2: Top meniscus cap: 1 center + arcCols + 2 chord-end connectors = arcCols + 1
  // Section 3: Bottom cap: arcCols + 1
  const arcTotal = (V_SEGS + 1) * arcCols;
  const chordTotal = (V_SEGS + 1) * chordCols;
  const capVerts = arcCols + 1;
  const totalVerts = arcTotal + chordTotal + capVerts * 2;

  const positions = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const indices = [];

  // Perimeter wall indices (outward normals)
  for (let i = 0; i < V_SEGS; i++) {
    for (let j = 0; j < ARC_SEGS; j++) {
      const v00 = i * arcCols + j;
      const v01 = i * arcCols + (j + 1);
      const v10 = (i + 1) * arcCols + j;
      const v11 = (i + 1) * arcCols + (j + 1);
      indices.push(v00, v01, v11, v00, v11, v10);
    }
  }

  // Front cutaway chord indices (facing +Z toward camera)
  const chordOff = arcTotal;
  for (let i = 0; i < V_SEGS; i++) {
    for (let j = 0; j < CHORD_SEGS; j++) {
      const v00 = chordOff + i * chordCols + j;
      const v01 = chordOff + i * chordCols + (j + 1);
      const v10 = chordOff + (i + 1) * chordCols + j;
      const v11 = chordOff + (i + 1) * chordCols + (j + 1);
      // Chord j runs left (-X) -> right (+X), i runs bottom -> top: dP/dj (+X) x dP/di (+Y) = +Z
      indices.push(v00, v01, v11, v00, v11, v10);
    }
  }

  // Top meniscus cap (facing +Y)
  const topOff = arcTotal + chordTotal;
  const topCenter = topOff;
  for (let j = 0; j < ARC_SEGS; j++) {
    // (topCenter -> j -> j+1) yields (-Z) x (-X) = +Y upward normal
    indices.push(topCenter, topOff + 1 + j, topOff + 1 + (j + 1));
  }

  // Bottom cap (facing -Y)
  const botOff = topOff + capVerts;
  const botCenter = botOff;
  for (let j = 0; j < ARC_SEGS; j++) {
    indices.push(botCenter, botOff + 1 + (j + 1), botOff + 1 + j);
  }

  // Initialize UV coordinates once
  for (let i = 0; i <= V_SEGS; i++) {
    const v = i / V_SEGS;
    for (let j = 0; j < arcCols; j++) {
      const idx = i * arcCols + j;
      uvs[idx * 2] = j / ARC_SEGS;
      uvs[idx * 2 + 1] = v;
    }
    for (let j = 0; j < chordCols; j++) {
      const idx = chordOff + i * chordCols + j;
      uvs[idx * 2] = j / CHORD_SEGS;
      uvs[idx * 2 + 1] = v;
    }
  }
  uvs[topCenter * 2] = 0.5;
  uvs[topCenter * 2 + 1] = 0.5;
  uvs[botCenter * 2] = 0.5;
  uvs[botCenter * 2 + 1] = 0.5;
  for (let j = 0; j < arcCols; j++) {
    const u = j / ARC_SEGS;
    uvs[(topOff + 1 + j) * 2] = u;
    uvs[(topOff + 1 + j) * 2 + 1] = 1.0;
    uvs[(botOff + 1 + j) * 2] = u;
    uvs[(botOff + 1 + j) * 2 + 1] = 0.0;
  }

  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);

  const sStart = Math.sin(CUT_PHI_START);
  const cStart = Math.cos(CUT_PHI_START);
  const sEnd = Math.sin(CUT_PHI_END);
  const cEnd = Math.cos(CUT_PHI_END);

  let lastFill = -1;
  let lastRippleBucket = -1;

  function updateGeometry(fillFrac, t, isFlowing) {
    const f = clamp01(fillFrac);
    const rippleBucket = isFlowing ? Math.round(t * 20) : 0;
    if (Math.abs(f - lastFill) < 0.0015 && rippleBucket === lastRippleBucket) {
      return;
    }
    lastFill = f;
    lastRippleBucket = rippleBucket;

    const yBase = 0.21;
    const yTop = lerp(0.27, 1.14, f);
    const rippleAmp = isFlowing ? 0.0055 : 0.0015;

    for (let i = 0; i <= V_SEGS; i++) {
      const v = i / V_SEGS;
      const y = lerp(yBase, yTop, v);
      const ev = evalInnerAtY(y);
      const r = Math.max(0.035, ev.r - 0.013);
      const isTop = i === V_SEGS;

      // Curved arc points
      for (let j = 0; j < arcCols; j++) {
        const phi = CUT_PHI_START + (j / ARC_SEGS) * CUT_PHI_LENGTH;
        const px = ev.xC + r * Math.sin(phi);
        const pz = ev.zC + r * Math.cos(phi);
        const ripple = isTop ? Math.sin(px * 8.5 + t * 5.2) * Math.cos(pz * 7.0 - t * 4.1) * rippleAmp : 0;
        const idx = (i * arcCols + j) * 3;
        positions[idx] = px;
        positions[idx + 1] = y + ripple;
        positions[idx + 2] = pz;
      }

      // Flat front cutaway chord from left cut edge (phiEnd) to right cut edge (phiStart)
      const lx = ev.xC + r * sEnd;
      const lz = ev.zC + r * cEnd;
      const rx = ev.xC + r * sStart;
      const rz = ev.zC + r * cStart;
      for (let j = 0; j < chordCols; j++) {
        const u = j / CHORD_SEGS;
        const px = lerp(lx, rx, u);
        const pz = lerp(lz, rz, u);
        const ripple = isTop ? Math.sin(px * 8.5 + t * 5.2) * Math.cos(pz * 7.0 - t * 4.1) * rippleAmp : 0;
        const idx = (chordOff + i * chordCols + j) * 3;
        positions[idx] = px;
        positions[idx + 1] = y + ripple;
        positions[idx + 2] = pz;
      }
    }

    // Top meniscus cap (chord midpoint + arc points)
    const evTop = evalInnerAtY(yTop);
    const rTop = Math.max(0.035, evTop.r - 0.013);
    const midZTop = evTop.zC + rTop * cStart;
    positions[topCenter * 3] = evTop.xC;
    positions[topCenter * 3 + 1] = yTop + Math.sin(t * 4.8) * rippleAmp * 0.6;
    positions[topCenter * 3 + 2] = midZTop;

    for (let j = 0; j < arcCols; j++) {
      const phi = CUT_PHI_START + (j / ARC_SEGS) * CUT_PHI_LENGTH;
      const px = evTop.xC + rTop * Math.sin(phi);
      const pz = evTop.zC + rTop * Math.cos(phi);
      const ripple = Math.sin(px * 8.5 + t * 5.2) * Math.cos(pz * 7.0 - t * 4.1) * rippleAmp;
      const idx = (topOff + 1 + j) * 3;
      positions[idx] = px;
      positions[idx + 1] = yTop + ripple;
      positions[idx + 2] = pz;
    }

    // Bottom cap
    const evBot = evalInnerAtY(yBase);
    const rBot = Math.max(0.035, evBot.r - 0.013);
    positions[botCenter * 3] = evBot.xC;
    positions[botCenter * 3 + 1] = yBase;
    positions[botCenter * 3 + 2] = evBot.zC + rBot * cStart;
    for (let j = 0; j < arcCols; j++) {
      const phi = CUT_PHI_START + (j / ARC_SEGS) * CUT_PHI_LENGTH;
      const idx = (botOff + 1 + j) * 3;
      positions[idx] = evBot.xC + rBot * Math.sin(phi);
      positions[idx + 1] = yBase;
      positions[idx + 2] = evBot.zC + rBot * Math.cos(phi);
    }

    posAttr.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  }

  // Initialize full pool cleanly at build time
  updateGeometry(1.0, 0.0, false);

  return { geo, updateGeometry };
}

/**
 * Helper to create a rounded-rectangle THREE.Shape centered around (0, 0) or bottom-aligned.
 */
function createRoundedRectShape(w, h, r, bottomOrigin = false) {
  const s = new THREE.Shape();
  const x0 = -w * 0.5;
  const x1 = w * 0.5;
  const y0 = bottomOrigin ? 0 : -h * 0.5;
  const y1 = bottomOrigin ? h : h * 0.5;
  const rad = Math.min(r, w * 0.48, h * 0.48);

  s.moveTo(x0 + rad, y0);
  s.lineTo(x1 - rad, y0);
  s.quadraticCurveTo(x1, y0, x1, y0 + rad);
  s.lineTo(x1, y1 - rad);
  s.quadraticCurveTo(x1, y1, x1 - rad, y1);
  s.lineTo(x0 + rad, y1);
  s.quadraticCurveTo(x0, y1, x0, y1 - rad);
  s.lineTo(x0, y0 + rad);
  s.quadraticCurveTo(x0, y0, x0 + rad, y0);
  return s;
}

/**
 * Builds the Closed Sterile Collection Bag geometries (merged shell, scale plane, liquid column, hardware).
 */
function buildCollectionBagGeometries(bagPos, yJunctionPos) {
  // Vector from bag origin to catheter drainage funnel adapter
  const adapterLocal = new THREE.Vector3(
    yJunctionPos[0] - 0.02 - bagPos[0],
    yJunctionPos[1] - 0.20 - bagPos[1],
    yJunctionPos[2] - bagPos[2]
  );

  // 1. Bag outer pillow prism (0.54 x 0.80 x ~0.136)
  const bagShape = createRoundedRectShape(0.52, 0.78, 0.072, false);
  const bagPrism = new THREE.ExtrudeGeometry(bagShape, {
    depth: 0.072,
    bevelEnabled: true,
    bevelThickness: 0.032,
    bevelSize: 0.024,
    bevelSegments: 3,
    curveSegments: 6,
  });
  bagPrism.translate(0, 0, -0.036);

  // 2. Top Anti-Reflux Drip Chamber cylinder (y_local = +0.41 .. +0.59)
  const dripChamber = new THREE.CylinderGeometry(0.058, 0.064, 0.19, 18, 1);
  dripChamber.translate(0, 0.505, 0);

  // 3. Translucent flexible sterile connector tubing from adapterLocal -> drip chamber top
  const tubeCurve = new THREE.CatmullRomCurve3([
    adapterLocal.clone(),
    new THREE.Vector3(adapterLocal.x * 0.72, adapterLocal.y - 0.08, adapterLocal.z * 0.75),
    new THREE.Vector3(adapterLocal.x * 0.24, 0.67, adapterLocal.z * 0.3),
    new THREE.Vector3(0.0, 0.595, 0.0),
  ]);
  const connTube = new THREE.TubeGeometry(tubeCurve, 18, 0.025, 10, false);

  const bagShellGeo = safeMerge([bagPrism, dripChamber, connTube]);
  bagPrism.dispose();
  dripChamber.dispose();
  connTube.dispose();

  // 4. Front graduated measurement panel
  const bagScaleGeo = new THREE.PlaneGeometry(0.48, 0.76, 1, 1);
  bagScaleGeo.translate(0, 0, 0.073);

  // 5. Rising amber liquid column (bottom locked at y = 0, height = BAG_LIQUID_HEIGHT = 0.72)
  const liqShape = createRoundedRectShape(0.46, BAG_LIQUID_HEIGHT, 0.042, true);
  const bagLiquidGeo = new THREE.ExtrudeGeometry(liqShape, {
    depth: 0.064,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.010,
    bevelSegments: 2,
    curveSegments: 5,
  });
  bagLiquidGeo.translate(0, 0, -0.032);

  // 6. Clinical Hardware (stepped adapter, drip collars, anti-reflux valve cone, hanger bar, bottom drain tap + clamp)
  const hwParts = [];

  // Stepped catheter adapter cone at top of tubing
  const adapter = new THREE.CylinderGeometry(0.030, 0.040, 0.095, 14);
  adapter.translate(adapterLocal.x, adapterLocal.y + 0.025, adapterLocal.z);
  hwParts.push(colorizeGeometry(adapter, '#E2F1FC'));
  adapter.dispose();

  // Drip chamber top & bottom sterile cyan collars
  const topCollar = new THREE.CylinderGeometry(0.066, 0.066, 0.030, 16);
  topCollar.translate(0, 0.598, 0);
  hwParts.push(colorizeGeometry(topCollar, '#38BDF8'));
  topCollar.dispose();

  const botCollar = new THREE.CylinderGeometry(0.068, 0.074, 0.034, 16);
  botCollar.translate(0, 0.412, 0);
  hwParts.push(colorizeGeometry(botCollar, '#38BDF8'));
  botCollar.dispose();

  // Inner anti-reflux conical check valve (pointing downward inside drip chamber)
  const checkValve = new THREE.ConeGeometry(0.033, 0.072, 14);
  checkValve.rotateX(PI);
  checkValve.translate(0, 0.535, 0);
  hwParts.push(colorizeGeometry(checkValve, '#7DD3FC'));
  checkValve.dispose();

  // Reinforced top bag hanger header bar
  const hangerBar = new THREE.BoxGeometry(0.38, 0.032, 0.052);
  hangerBar.translate(0, 0.415, 0);
  hwParts.push(colorizeGeometry(hangerBar, '#CBDFF2'));
  hangerBar.dispose();

  // Bottom drainage outlet spout & blue shutoff slide clamp
  const spout = new THREE.CylinderGeometry(0.028, 0.022, 0.115, 12);
  spout.translate(0, -0.465, 0);
  hwParts.push(colorizeGeometry(spout, '#E2F1FC'));
  spout.dispose();

  const clampBody = new THREE.BoxGeometry(0.11, 0.034, 0.056);
  clampBody.translate(0, -0.470, 0);
  hwParts.push(colorizeGeometry(clampBody, '#0284C7'));
  clampBody.dispose();

  const bagHardwareGeo = safeMerge(hwParts);
  for (const p of hwParts) p.dispose();

  return { bagShellGeo, bagScaleGeo, bagLiquidGeo, bagHardwareGeo, adapterLocal };
}

/**
 * Builds the 2 mirrored spline trajectories (even instances from +X Murphy eye, odd from -X Murphy eye)
 * merging smoothly into the central drainage lumen -> extension tubing -> drip chamber -> bag.
 */
function buildDropletCurves(wc) {
  const tipY = wc.catheterTipRestingY ?? 0.88;
  const eyesY = tipY + (wc.murphyEyesOffsetY ?? -0.14); // ~0.74
  const neckY = wc.bladderNeckY ?? 0.18;
  const entryY = wc.urethraEntryY ?? -1.05;
  const entryZ = wc.urethraEntryZ ?? 0.15;
  const yJunc = wc.yJunctionPos || [0.0, -1.42, 0.15];
  const bagPos = wc.drainageBagPos || [-0.36, -2.42, 0.12];

  const sharedTail = [
    new THREE.Vector3(0.0, 0.56, 0.0),
    new THREE.Vector3(0.0, 0.42, 0.0),
    new THREE.Vector3(0.0, neckY, 0.0),
    new THREE.Vector3(0.0, lerp(neckY, entryY, 0.5), entryZ * 0.5),
    new THREE.Vector3(0.0, entryY, entryZ),
    new THREE.Vector3(yJunc[0], yJunc[1], yJunc[2]),
    new THREE.Vector3(yJunc[0] - 0.02, yJunc[1] - 0.20, yJunc[2]),
    new THREE.Vector3(lerp(yJunc[0] - 0.02, bagPos[0], 0.55), lerp(yJunc[1] - 0.20, bagPos[1] + 0.67, 0.55), lerp(yJunc[2], bagPos[2], 0.5)),
    new THREE.Vector3(bagPos[0], bagPos[1] + 0.59, bagPos[2]),
    new THREE.Vector3(bagPos[0], bagPos[1] + 0.44, bagPos[2]), // Falling through drip chamber
    new THREE.Vector3(bagPos[0], bagPos[1] + 0.08, bagPos[2]), // Entering bag chamber
  ];

  const curveRight = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.115, eyesY + 0.045, 0.020),
    new THREE.Vector3(0.056, eyesY + 0.005, 0.008),
    ...sharedTail,
  ]);

  const curveLeft = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.115, eyesY - 0.015, 0.020),
    new THREE.Vector3(-0.056, eyesY - 0.045, 0.008),
    ...sharedTail,
  ]);

  return [curveRight, curveLeft];
}

/**
 * Main exported builder matching the exact interface contract:
 *   buildMedStudio(scene, registry, timeline)
 *   -> { studioGroup, update(t, flowState), getAnchors() }
 */
export function buildMedStudio(scene, registry, timeline) {
  const reg = registry || new MaterialRegistry();
  const wc = timeline?.worldContract || {};
  const bagPos = wc.drainageBagPos || [-0.36, -2.42, 0.12];
  const yJunctionPos = wc.yJunctionPos || [0.0, -1.42, 0.15];

  const studioGroup = new THREE.Group();
  studioGroup.name = 'MedStudioGroup';

  // ---------------------------------------------------------------------------
  // 1. Deep Clinical Navy-to-Sapphire Studio Backdrop Sphere (ShaderMaterial)
  // ---------------------------------------------------------------------------
  const backdropGeo = new THREE.SphereGeometry(65, 20, 14);
  const backdropMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uColorEdge: { value: new THREE.Color('#040E1C') },
      uColorCenter: { value: new THREE.Color('#0D2544') },
      uColorAccent: { value: new THREE.Color('#163D6B') },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColorEdge;
      uniform vec3 uColorCenter;
      uniform vec3 uColorAccent;
      varying vec3 vDir;
      void main() {
        // Smooth cyclorama studio glow centered on vertical clinical workspace
        float radial = 1.0 - clamp(length(vec2(vDir.x * 1.15, (vDir.y + 0.04) * 0.92)), 0.0, 1.0);
        float core = pow(radial, 1.85);
        float horizonGlow = exp(-pow((vDir.y + 0.14) * 4.2, 2.0)) * 0.35;
        vec3 col = mix(uColorEdge, uColorCenter, core);
        col = mix(col, uColorAccent, horizonGlow * (0.35 + 0.65 * radial));

        // Ultra-subtle precision diagnostic concentric contours
        float ringDist = length(vDir.xy * vec2(1.0, 0.72));
        float ringWave = smoothstep(0.96, 1.0, cos(ringDist * 42.0));
        col += vec3(0.06, 0.18, 0.30) * ringWave * (0.14 * core);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const backdropMesh = new THREE.Mesh(backdropGeo, backdropMat);
  backdropMesh.name = 'StudioBackdropSphere';
  backdropMesh.renderOrder = -10;
  studioGroup.add(backdropMesh);

  // ---------------------------------------------------------------------------
  // 2. Sterile Ground Measurement Ring / Grid Disc at y = -3.15
  // ---------------------------------------------------------------------------
  const groundTex = createGroundGridTexture();
  const groundGeo = new THREE.PlaneGeometry(13.0, 13.0, 1, 1);
  groundGeo.rotateX(-PI * 0.5);
  const groundMat = reg.getBasic('studio_ground_grid', {
    map: groundTex,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    fog: true,
  });
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.name = 'StudioCoordinateGround';
  groundMesh.position.set(0, -3.15, 0);
  groundMesh.renderOrder = -5;
  studioGroup.add(groundMesh);

  // ---------------------------------------------------------------------------
  // 3. Translucent 3D Pelvic Bladder & Curved Urethral Canal Cutaway (+Z Open)
  // ---------------------------------------------------------------------------
  const anatomyGroup = new THREE.Group();
  anatomyGroup.name = 'PelvicAnatomyGroup';
  anatomyGroup.visible = false;
  studioGroup.add(anatomyGroup);

  const rings = buildAnatomyProfileRings(wc);
  const evalInnerAtY = createInnerEvaluator(rings);
  const { outerAndCutGeo, innerGeo } = buildBladderGeometries(rings, 44);

  const detrusorMat = reg.getStandard('anatomy_detrusor_cut', {
    color: '#FFFFFF',
    vertexColors: true,
    roughness: 0.42,
    metalness: 0.02,
    emissive: '#471522',
    emissiveIntensity: 0.28,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
  });

  const mucosaMat = reg.getStandard('anatomy_mucosa_inner', {
    color: '#EB97A3',
    roughness: 0.33,
    metalness: 0.0,
    emissive: '#541E2B',
    emissiveIntensity: 0.22,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
  });

  const bladderOuterMesh = new THREE.Mesh(outerAndCutGeo, detrusorMat);
  bladderOuterMesh.name = 'BladderDetrusorAndCutSection';
  bladderOuterMesh.renderOrder = 1;
  anatomyGroup.add(bladderOuterMesh);

  const bladderInnerMesh = new THREE.Mesh(innerGeo, mucosaMat);
  bladderInnerMesh.name = 'BladderMucosaInnerWall';
  bladderInnerMesh.renderOrder = 2;
  anatomyGroup.add(bladderInnerMesh);

  // Subtle diagnostic glow halo behind bladder cavity
  const bladderGlow = createGlowSprite('#38BDF8', 2.5, 0.22);
  bladderGlow.name = 'BladderDiagnosticGlow';
  bladderGlow.position.set(0.0, 0.72, -0.82);
  bladderGlow.renderOrder = 0;
  anatomyGroup.add(bladderGlow);

  // ---------------------------------------------------------------------------
  // 4. Internal Translucent Amber Urine Pool (Drains smoothly in Beat 5)
  // ---------------------------------------------------------------------------
  const urinePool = buildDynamicUrinePool(evalInnerAtY);
  const bladderUrineMat = reg.getStandard('bladder_urine_pool', {
    color: '#F5B82E',
    emissive: '#D9860D',
    emissiveIntensity: 0.38,
    roughness: 0.14,
    metalness: 0.03,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
  });
  const urinePoolMesh = new THREE.Mesh(urinePool.geo, bladderUrineMat);
  urinePoolMesh.name = 'BladderUrinePool';
  urinePoolMesh.renderOrder = 3;
  anatomyGroup.add(urinePoolMesh);

  // ---------------------------------------------------------------------------
  // 5. Closed Graduated Sterile Collection Bag at [-0.36, -2.42, 0.12]
  // ---------------------------------------------------------------------------
  const bagGroup = new THREE.Group();
  bagGroup.name = 'SterileCollectionBagGroup';
  bagGroup.position.set(bagPos[0], bagPos[1], bagPos[2]);
  studioGroup.add(bagGroup);

  const { bagShellGeo, bagScaleGeo, bagLiquidGeo, bagHardwareGeo } = buildCollectionBagGeometries(
    bagPos,
    yJunctionPos
  );

  const bagHardwareMat = reg.getStandard('bag_clinical_hardware', {
    color: '#FFFFFF',
    vertexColors: true,
    roughness: 0.34,
    metalness: 0.08,
    emissive: '#0B2542',
    emissiveIntensity: 0.18,
    transparent: true,
    opacity: 0.60,
    depthWrite: true,
  });
  const bagHardwareMesh = new THREE.Mesh(bagHardwareGeo, bagHardwareMat);
  bagHardwareMesh.name = 'BagClinicalHardware';
  bagHardwareMesh.renderOrder = 2;
  bagGroup.add(bagHardwareMesh);

  // Shared rich translucent amber liquid material for bag column + 32 droplets
  const urineStreamMat = reg.getStandard('urine_stream_amber', {
    color: '#F8C136',
    emissive: '#E08E0B',
    emissiveIntensity: 0.52,
    roughness: 0.15,
    metalness: 0.03,
    transparent: true,
    opacity: 0.86,
    depthWrite: false,
  });

  const bagLiquidMesh = new THREE.Mesh(bagLiquidGeo, urineStreamMat);
  bagLiquidMesh.name = 'BagRisingUrineColumn';
  bagLiquidMesh.position.set(0, BAG_LIQUID_BOTTOM_Y, 0);
  bagLiquidMesh.scale.set(1, 0.01, 1);
  bagLiquidMesh.visible = false;
  bagLiquidMesh.renderOrder = 2;
  bagGroup.add(bagLiquidMesh);

  const bagShellMat = reg.getStandard('bag_frosted_pvc', {
    color: '#DCEEFB',
    emissive: '#0F365D',
    emissiveIntensity: 0.22,
    roughness: 0.18,
    metalness: 0.04,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
  const bagShellMesh = new THREE.Mesh(bagShellGeo, bagShellMat);
  bagShellMesh.name = 'BagFrostedShellAndTubing';
  bagShellMesh.renderOrder = 4;
  bagGroup.add(bagShellMesh);

  const bagScaleTex = createBagScaleTexture();
  const bagScaleMat = reg.getBasic('bag_scale_graduations', {
    map: bagScaleTex,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
  });
  const bagScaleMesh = new THREE.Mesh(bagScaleGeo, bagScaleMat);
  bagScaleMesh.name = 'BagMlScaleOverlay';
  bagScaleMesh.renderOrder = 5;
  bagGroup.add(bagScaleMesh);

  // ---------------------------------------------------------------------------
  // 6. 32 InstancedMesh Golden Urine Micro-Droplets (Murphy Eyes -> Bag)
  // ---------------------------------------------------------------------------
  const dropletCurves = buildDropletCurves(wc);
  const dropletGeo = new THREE.SphereGeometry(0.018, 6, 5);
  const dropletsInstanced = new THREE.InstancedMesh(dropletGeo, urineStreamMat, DROPLET_COUNT);
  dropletsInstanced.name = 'UrineDrainageDroplets';
  dropletsInstanced.frustumCulled = false;
  dropletsInstanced.visible = false;
  dropletsInstanced.renderOrder = 3;
  studioGroup.add(dropletsInstanced);

  // Pre-allocated scratch objects for zero-allocation update() loop
  const tmpPos = new THREE.Vector3();
  const tmpTan = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3();
  const tmpMat4 = new THREE.Matrix4();
  const UP_AXIS = new THREE.Vector3(0, 1, 0);

  // Initialize instance matrices to identity scale 0 so bounds never contain NaNs
  tmpScale.set(0, 0, 0);
  tmpMat4.compose(tmpPos, tmpQuat, tmpScale);
  for (let i = 0; i < DROPLET_COUNT; i++) {
    dropletsInstanced.setMatrixAt(i, tmpMat4);
  }
  dropletsInstanced.instanceMatrix.needsUpdate = true;

  // Anchors contract
  const anchors = {
    bladderCavity: new THREE.Vector3(0.42, 1.05, 0.1),
    bladderApex: new THREE.Vector3(0.0, 1.755, 0.0),
    bladderNeck: new THREE.Vector3(-0.34, 0.18, 0.08),
    drainageBag: new THREE.Vector3(-0.36, -2.42, 0.25),
    bagBottom: new THREE.Vector3(bagPos[0], bagPos[1] - 0.50, bagPos[2]),
  };

  function getAnchors() {
    return {
      bladderCavity: anchors.bladderCavity.clone(),
      bladderApex: anchors.bladderApex.clone(),
      bladderNeck: anchors.bladderNeck.clone(),
      drainageBag: anchors.drainageBag.clone(),
      bagBottom: anchors.bagBottom.clone(),
    };
  }

  /**
   * Frame-accurate studio update called every frame across 0..30s.
   */
  function update(t = 0, flowState = {}) {
    const fs = flowState || {};
    const safeT = Number.isFinite(t) ? t : 0;

    // Fallback drainage curve if caller omits drainageMl (0 -> 250 mL across 20.8..25.8s)
    const fallbackDrainMl =
      safeT < 20.8 ? 0 : safeT >= 25.8 ? 250 : 250 * smoothstep(20.8, 25.8, safeT);
    const drainageMl = clamp(
      Number.isFinite(fs.drainageMl) ? fs.drainageMl : fallbackDrainMl,
      0,
      BAG_MAX_ML
    );
    const balloonMl = clamp(Number.isFinite(fs.balloonMl) ? fs.balloonMl : 0, 0, 12);

    const isFlowing =
      fs.flowActive !== undefined
        ? Boolean(fs.flowActive)
        : safeT >= 20.8 && safeT <= 26.1;

    // -------------------------------------------------------------------------
    // A. Anatomy Reveal across t = 9.5 .. 10.4s (hidden when t < 9.4s)
    // -------------------------------------------------------------------------
    if (safeT < 9.4) {
      anatomyGroup.visible = false;
      detrusorMat.opacity = 0;
      mucosaMat.opacity = 0;
      bladderUrineMat.opacity = 0;
    } else {
      anatomyGroup.visible = true;
      const reveal = smoothstep(9.5, 10.4, safeT);
      const wallOpacity = 0.88 * reveal;
      detrusorMat.opacity = wallOpacity;
      mucosaMat.opacity = wallOpacity;
      detrusorMat.depthWrite = reveal >= 0.35;
      mucosaMat.depthWrite = reveal >= 0.35;

      // Subtle clinical scale settle during reveal
      const s = 0.965 + 0.035 * reveal;
      anatomyGroup.scale.set(s, s, s);

      // Subtle cyan diagnostic glow halo response (boosts slightly with balloon lock)
      const balloonBoost = clamp01(balloonMl / 10) * 0.08;
      bladderGlow.material.opacity = (0.20 + balloonBoost) * reveal;

      // Dynamic internal urine pool: drains smoothly from 1.0 -> 0.08 across 0 -> 250 mL
      const drainFrac = clamp01(drainageMl / 250);
      const fillFrac = lerp(1.0, 0.08, drainFrac);
      urinePool.updateGeometry(fillFrac, safeT, isFlowing);
      bladderUrineMat.opacity = 0.45 * reveal;
    }

    // -------------------------------------------------------------------------
    // B. Closed Collection Bag Visibility & Rising Liquid Column (Strictly Beat 5)
    // -------------------------------------------------------------------------
    let bagOpacity = 0;
    if (safeT >= 20.15 && safeT <= 26.55) {
      const bagIn = smoothstep(20.15, 20.65, safeT);
      const bagOut = 1.0 - smoothstep(26.20, 26.55, safeT);
      bagOpacity = bagIn * bagOut;
    }

    if (bagOpacity <= 0.005) {
      bagGroup.visible = false;
    } else {
      bagGroup.visible = true;
      bagShellMat.opacity = 0.34 * bagOpacity;
      bagScaleMat.opacity = 0.96 * bagOpacity;
      bagHardwareMat.opacity = 0.95 * bagOpacity;
      bagHardwareMat.depthWrite = bagOpacity >= 0.45;

      const liqFrac = clamp01(drainageMl / BAG_MAX_ML);
      if (liqFrac > 0.006) {
        bagLiquidMesh.visible = true;
        bagLiquidMesh.scale.set(1, liqFrac, 1);
      } else {
        bagLiquidMesh.visible = false;
      }
    }

    // -------------------------------------------------------------------------
    // C. 32 InstancedMesh Golden Urine Micro-Droplets
    // -------------------------------------------------------------------------
    if (isFlowing && safeT >= 20.6 && safeT <= 26.25) {
      dropletsInstanced.visible = true;
      const streamFade =
        smoothstep(20.75, 21.05, safeT) * (1.0 - smoothstep(25.9, 26.15, safeT));
      const liqWorldTopY =
        bagPos[1] + BAG_LIQUID_BOTTOM_Y + BAG_LIQUID_HEIGHT * clamp01(drainageMl / BAG_MAX_ML);

      const speed = 0.42;
      const basePhase = Math.max(0, safeT - 20.75) * speed;

      for (let i = 0; i < DROPLET_COUNT; i++) {
        const curve = dropletCurves[i & 1];
        const rawU = (basePhase + i / DROPLET_COUNT) % 1.0;

        curve.getPointAt(rawU, tmpPos);
        curve.getTangentAt(rawU, tmpTan).normalize();

        // Gently hide droplet once it merges into the rising urine meniscus inside the bag
        const mergeFade = smoothstep(liqWorldTopY - 0.04, liqWorldTopY + 0.06, tmpPos.y);
        const startFade = smoothstep(0.0, 0.03, rawU);
        const dropAmp = streamFade * mergeFade * startFade;

        if (dropAmp <= 0.01) {
          tmpScale.set(0, 0, 0);
        } else {
          // Slight teardrop elongation (more stretched during free-fall in drip chamber)
          const dripBoost = rawU > 0.78 ? 1.75 : 1.38;
          const rScale = (0.82 + 0.16 * Math.sin(i * 1.9)) * dropAmp;
          tmpScale.set(rScale, rScale * dripBoost, rScale);
        }

        tmpQuat.setFromUnitVectors(UP_AXIS, tmpTan);
        tmpMat4.compose(tmpPos, tmpQuat, tmpScale);
        dropletsInstanced.setMatrixAt(i, tmpMat4);
      }
      dropletsInstanced.instanceMatrix.needsUpdate = true;
    } else {
      dropletsInstanced.visible = false;
    }
  }

  // Run initial state t=0 cleanly
  update(0, { balloonMl: 0, drainageMl: 0, flowActive: false, tipY: 0, insertOffsetY: 0 });

  if (scene && typeof scene.add === 'function') {
    scene.add(studioGroup);
  }

  return {
    studioGroup,
    update,
    getAnchors,
  };
}
