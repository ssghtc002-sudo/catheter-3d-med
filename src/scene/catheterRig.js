/**
 * Parametric 2-Way Silicone Foley Catheter Rig (/home/antigravity/catheter-3d-med/src/scene/catheterRig.js)
 *
 * Interface:
 *   buildCatheterRig(scene, registry, timeline)
 *     -> { catheterGroup, update(t), getAnchors(), getState() }
 *
 * Budget: <= 22 meshes, <= 20,000 tris, <= 10 shared materials via MaterialRegistry.
 */
import * as THREE from 'three';
import { safeMerge, createGlowSprite } from '../engine/medUtils.js';

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
 * Physiological urethral Z-profile in catheter local coordinates (localY = 0 at tip, -2.30 at Y-hub).
 * Upper bladder segment (0 .. -0.70) is vertical along Z = 0.0;
 * Urethral segment (-0.70 .. -1.93) curves smoothly to Z = 0.15;
 * External hub (-1.93 .. -2.35) sits at Z = 0.15.
 */
function shaftZ(localY, urethralZ = 0.15) {
  if (localY >= -0.70) return 0.0;
  if (localY <= -1.93) return urethralZ;
  const u = (-0.70 - localY) / (-0.70 - (-1.93));
  return urethralZ * u * u * (3 - 2 * u);
}

/**
 * Generates procedural 2..10 mL calibration texture for the sterile syringe barrel.
 * Safe in headless Node (returns null when document is undefined).
 */
function createSyringeScaleTexture() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, 256, 512);
  ctx.fillStyle = 'rgba(224, 244, 255, 0.24)';
  ctx.fillRect(0, 0, 256, 512);

  // Subtle vertical specular highlight bands
  const sheen = ctx.createLinearGradient(0, 0, 256, 0);
  sheen.addColorStop(0.0, 'rgba(255,255,255,0.06)');
  sheen.addColorStop(0.35, 'rgba(255,255,255,0.22)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0.04)');
  sheen.addColorStop(0.65, 'rgba(255,255,255,0.20)');
  sheen.addColorStop(1.0, 'rgba(255,255,255,0.06)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, 256, 512);

  // Scale centered at u = 0.5 (x = 128); barrel geometry rotated PI around Y so u=0.5 faces +Z
  ctx.strokeStyle = 'rgba(14, 165, 233, 0.95)';
  ctx.fillStyle = 'rgba(224, 248, 255, 0.96)';
  ctx.font = 'bold 20px "DejaVu Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  const yBottom = 458; // 0 mL near Luer tip
  const yTop = 64;     // 10 mL near top flange
  for (let ml = 1; ml <= 10; ml++) {
    const u = ml / 10;
    const py = lerp(yBottom, yTop, u);
    const isMajor = ml % 2 === 0;
    ctx.lineWidth = isMajor ? 4 : 2;
    const tickW = isMajor ? 34 : 18;
    ctx.beginPath();
    ctx.moveTo(106, py);
    ctx.lineTo(106 + tickW, py);
    ctx.stroke();
    if (isMajor) {
      ctx.fillText(`${ml}`, 144, py);
    }
  }
  ctx.font = 'bold 16px "DejaVu Sans", sans-serif';
  ctx.fillStyle = 'rgba(56, 189, 248, 0.95)';
  ctx.fillText('mL', 144, 34);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Builds a swept tube or thick-walled C-channel arc along centerline (xOffsetFn(y), y, zOffsetFn(y)).
 * Angles follow x = r * cos(theta), z = r * sin(theta), so +Z is PI/2.
 */
function buildSweptChannel({
  yStart,
  yEnd,
  ySegs = 24,
  rOuter = 0.062,
  rInner = 0.0,
  thetaStart = 0,
  thetaLength = Math.PI * 2,
  radialSegs = 24,
  xFn = () => 0,
  zFn = () => 0,
  capEnds = false,
}) {
  const isClosedRing = Math.abs(thetaLength - Math.PI * 2) < 1e-4;
  const isThickShell = rInner > 1e-4;

  const positions = [];
  const uvs = [];
  const indices = [];

  function pushVertex(vx, vy, vz, u, v) {
    positions.push(vx, vy, vz);
    uvs.push(u, v);
    return positions.length / 3 - 1;
  }

  function addQuad(a, b, c, d) {
    indices.push(a, b, c, a, c, d);
  }

  // Tangent approximation for clean cross-sectional tilting
  function sampleFrame(y) {
    const eps = 0.002;
    const dx = (xFn(y + eps) - xFn(y - eps)) / (2 * eps);
    const dz = (zFn(y + eps) - zFn(y - eps)) / (2 * eps);
    const tangent = new THREE.Vector3(dx, 1, dz).normalize();
    const refX = new THREE.Vector3(1, 0, 0);
    const binormal = new THREE.Vector3().crossVectors(refX, tangent).normalize();
    const normal = new THREE.Vector3().crossVectors(tangent, binormal).normalize();
    return { cx: xFn(y), cy: y, cz: zFn(y), normal, binormal };
  }

  const frames = [];
  for (let iy = 0; iy <= ySegs; iy++) {
    const v = iy / ySegs;
    const y = lerp(yStart, yEnd, v);
    frames.push({ ...sampleFrame(y), v });
  }

  const ringCols = radialSegs + 1;

  // 1. Outer cylindrical surface (outward normals)
  const outerGrid = [];
  for (let iy = 0; iy <= ySegs; iy++) {
    const f = frames[iy];
    const row = [];
    for (let ix = 0; ix <= radialSegs; ix++) {
      const u = ix / radialSegs;
      const th = thetaStart + u * thetaLength;
      const lx = rOuter * Math.cos(th);
      const lz = rOuter * Math.sin(th);
      const vx = f.cx + f.normal.x * lx + f.binormal.x * lz;
      const vy = f.cy + f.normal.y * lx + f.binormal.y * lz;
      const vz = f.cz + f.normal.z * lx + f.binormal.z * lz;
      row.push(pushVertex(vx, vy, vz, u, f.v));
    }
    outerGrid.push(row);
  }

  const ascendingY = yEnd > yStart;
  for (let iy = 0; iy < ySegs; iy++) {
    for (let ix = 0; ix < radialSegs; ix++) {
      const a = outerGrid[iy][ix];
      const b = outerGrid[iy][ix + 1];
      const c = outerGrid[iy + 1][ix + 1];
      const d = outerGrid[iy + 1][ix];
      if (ascendingY) {
        addQuad(a, d, c, b);
      } else {
        addQuad(a, b, c, d);
      }
    }
  }

  // 2. Inner cylindrical surface (inward normals toward centerline) if thick-walled
  if (isThickShell) {
    const innerGrid = [];
    for (let iy = 0; iy <= ySegs; iy++) {
      const f = frames[iy];
      const row = [];
      for (let ix = 0; ix <= radialSegs; ix++) {
        const u = ix / radialSegs;
        const th = thetaStart + u * thetaLength;
        const lx = rInner * Math.cos(th);
        const lz = rInner * Math.sin(th);
        const vx = f.cx + f.normal.x * lx + f.binormal.x * lz;
        const vy = f.cy + f.normal.y * lx + f.binormal.y * lz;
        const vz = f.cz + f.normal.z * lx + f.binormal.z * lz;
        row.push(pushVertex(vx, vy, vz, u, f.v));
      }
      innerGrid.push(row);
    }

    for (let iy = 0; iy < ySegs; iy++) {
      for (let ix = 0; ix < radialSegs; ix++) {
        const a = innerGrid[iy][ix];
        const b = innerGrid[iy][ix + 1];
        const c = innerGrid[iy + 1][ix + 1];
        const d = innerGrid[iy + 1][ix];
        if (ascendingY) {
          addQuad(a, b, c, d);
        } else {
          addQuad(a, d, c, b);
        }
      }
    }

    // 3. Longitudinal cutaway wall faces when arc < 360 deg
    if (!isClosedRing) {
      const sideStartOuter = [];
      const sideStartInner = [];
      const sideEndOuter = [];
      const sideEndInner = [];
      for (let iy = 0; iy <= ySegs; iy++) {
        const f = frames[iy];
        const th0 = thetaStart;
        const th1 = thetaStart + thetaLength;
        const s0ox = f.cx + f.normal.x * rOuter * Math.cos(th0) + f.binormal.x * rOuter * Math.sin(th0);
        const s0oy = f.cy + f.normal.y * rOuter * Math.cos(th0) + f.binormal.y * rOuter * Math.sin(th0);
        const s0oz = f.cz + f.normal.z * rOuter * Math.cos(th0) + f.binormal.z * rOuter * Math.sin(th0);
        const s0ix = f.cx + f.normal.x * rInner * Math.cos(th0) + f.binormal.x * rInner * Math.sin(th0);
        const s0iy = f.cy + f.normal.y * rInner * Math.cos(th0) + f.binormal.y * rInner * Math.sin(th0);
        const s0iz = f.cz + f.normal.z * rInner * Math.cos(th0) + f.binormal.z * rInner * Math.sin(th0);
        sideStartOuter.push(pushVertex(s0ox, s0oy, s0oz, 1, f.v));
        sideStartInner.push(pushVertex(s0ix, s0iy, s0iz, 0, f.v));

        const s1ox = f.cx + f.normal.x * rOuter * Math.cos(th1) + f.binormal.x * rOuter * Math.sin(th1);
        const s1oy = f.cy + f.normal.y * rOuter * Math.cos(th1) + f.binormal.y * rOuter * Math.sin(th1);
        const s1oz = f.cz + f.normal.z * rOuter * Math.cos(th1) + f.binormal.z * rOuter * Math.sin(th1);
        const s1ix = f.cx + f.normal.x * rInner * Math.cos(th1) + f.binormal.x * rInner * Math.sin(th1);
        const s1iy = f.cy + f.normal.y * rInner * Math.cos(th1) + f.binormal.y * rInner * Math.sin(th1);
        const s1iz = f.cz + f.normal.z * rInner * Math.cos(th1) + f.binormal.z * rInner * Math.sin(th1);
        sideEndOuter.push(pushVertex(s1ox, s1oy, s1oz, 1, f.v));
        sideEndInner.push(pushVertex(s1ix, s1iy, s1iz, 0, f.v));
      }

      for (let iy = 0; iy < ySegs; iy++) {
        if (ascendingY) {
          addQuad(sideStartOuter[iy], sideStartInner[iy], sideStartInner[iy + 1], sideStartOuter[iy + 1]);
          addQuad(sideEndInner[iy], sideEndOuter[iy], sideEndOuter[iy + 1], sideEndInner[iy + 1]);
        } else {
          addQuad(sideStartInner[iy], sideStartOuter[iy], sideStartOuter[iy + 1], sideStartInner[iy + 1]);
          addQuad(sideEndOuter[iy], sideEndInner[iy], sideEndInner[iy + 1], sideEndOuter[iy + 1]);
        }
      }
    }

    // 4. End annular caps
    if (capEnds) {
      const capRing = (iy, facePositiveY) => {
        const f = frames[iy];
        const rowO = [];
        const rowI = [];
        for (let ix = 0; ix < ringCols; ix++) {
          const u = ix / radialSegs;
          const th = thetaStart + u * thetaLength;
          const co = Math.cos(th);
          const si = Math.sin(th);
          rowO.push(
            pushVertex(
              f.cx + f.normal.x * rOuter * co + f.binormal.x * rOuter * si,
              f.cy + f.normal.y * rOuter * co + f.binormal.y * rOuter * si,
              f.cz + f.normal.z * rOuter * co + f.binormal.z * rOuter * si,
              u,
              1
            )
          );
          rowI.push(
            pushVertex(
              f.cx + f.normal.x * rInner * co + f.binormal.x * rInner * si,
              f.cy + f.normal.y * rInner * co + f.binormal.y * rInner * si,
              f.cz + f.normal.z * rInner * co + f.binormal.z * rInner * si,
              u,
              0
            )
          );
        }
        for (let ix = 0; ix < radialSegs; ix++) {
          if (facePositiveY) {
            addQuad(rowO[ix], rowO[ix + 1], rowI[ix + 1], rowI[ix]);
          } else {
            addQuad(rowI[ix], rowI[ix + 1], rowO[ix + 1], rowO[ix]);
          }
        }
      };
      capRing(0, !ascendingY);
      capRing(ySegs, ascendingY);
    }
  } else if (capEnds) {
    // Solid tube end caps
    const capDisk = (iy, facePositiveY) => {
      const f = frames[iy];
      const centerIdx = pushVertex(f.cx, f.cy, f.cz, 0.5, 0.5);
      const rim = [];
      for (let ix = 0; ix < ringCols; ix++) {
        const u = ix / radialSegs;
        const th = thetaStart + u * thetaLength;
        const co = Math.cos(th);
        const si = Math.sin(th);
        rim.push(
          pushVertex(
            f.cx + f.normal.x * rOuter * co + f.binormal.x * rOuter * si,
            f.cy + f.normal.y * rOuter * co + f.binormal.y * rOuter * si,
            f.cz + f.normal.z * rOuter * co + f.binormal.z * rOuter * si,
            u,
            0
          )
        );
      }
      for (let ix = 0; ix < radialSegs; ix++) {
        if (facePositiveY) {
          indices.push(centerIdx, rim[ix], rim[ix + 1]);
        } else {
          indices.push(centerIdx, rim[ix + 1], rim[ix]);
        }
      }
    };
    capDisk(0, !ascendingY);
    capDisk(ySegs, ascendingY);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds the dynamic Retention Balloon LatheGeometry + two morph position arrays
 * (collapsed flush collar r=0.068 vs taut 10 mL sphere r=0.295) keeping cuffs locked on shaft.
 */
function buildBalloonMorphGeometry(rMin, rMax, radialSegs = 28, heightSegs = 18) {
  const halfCollapsed = 0.21; // total length 0.42m around local y = -0.44
  const halfInflated = 0.252; // rests cleanly above bladderNeckY=0.18 and clear below Murphy eyes=0.74

  const collapsedPts = [];
  const inflatedPts = [];

  for (let i = 0; i <= heightSegs; i++) {
    const u = i / heightSegs; // 0 (bottom) .. 1 (top)
    const s = u * 2 - 1;      // -1 .. +1

    // Collapsed: flush silicone sleeve hugging shaft (cuffs 0.062 -> sleeve 0.068)
    const taper = Math.pow(Math.sin(u * Math.PI), 0.35);
    const rC = lerp(0.0615, rMin, taper);
    const yC = s * halfCollapsed;
    collapsedPts.push(new THREE.Vector2(rC, yC));

    // Inflated: smooth oblate Foley retention balloon with tight cuff fillets
    const cuffMask = smoothstep(0.0, 0.14, u) * (1.0 - smoothstep(0.86, 1.0, u));
    const sphereTerm = Math.sqrt(Math.max(0, 1 - s * s * 0.94));
    const rI = lerp(0.0615, rMax, cuffMask * Math.pow(sphereTerm, 0.85));
    const yI = s * halfInflated;
    inflatedPts.push(new THREE.Vector2(rI, yI));
  }

  const baseGeo = new THREE.LatheGeometry(collapsedPts, radialSegs);
  const targetGeo = new THREE.LatheGeometry(inflatedPts, radialSegs);

  const collapsedPos = new Float32Array(baseGeo.attributes.position.array);
  const inflatedPos = new Float32Array(targetGeo.attributes.position.array);
  targetGeo.dispose();

  return { geo: baseGeo, collapsedPos, inflatedPos };
}

/**
 * Updates vertex positions of a lightweight fixed-topology tube along a CatmullRomCurve3
 * without allocating geometry buffers per frame.
 */
function createDynamicTube(radius = 0.042, tubularSegs = 18, radialSegs = 10) {
  const vertCount = (tubularSegs + 1) * (radialSegs + 1);
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices = [];

  for (let i = 0; i <= tubularSegs; i++) {
    for (let j = 0; j <= radialSegs; j++) {
      const idx = i * (radialSegs + 1) + j;
      uvs[idx * 2] = j / radialSegs;
      uvs[idx * 2 + 1] = i / tubularSegs;
    }
  }

  for (let i = 0; i < tubularSegs; i++) {
    for (let j = 0; j < radialSegs; j++) {
      const a = i * (radialSegs + 1) + j;
      const b = i * (radialSegs + 1) + (j + 1);
      const c = (i + 1) * (radialSegs + 1) + (j + 1);
      const d = (i + 1) * (radialSegs + 1) + j;
      indices.push(a, d, c, a, c, b);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);

  const tmpPt = new THREE.Vector3();
  const tmpTan = new THREE.Vector3();
  const tmpUp = new THREE.Vector3(0, 0, 1);
  const tmpN = new THREE.Vector3();
  const tmpB = new THREE.Vector3();

  function updateFromCurve(curve) {
    for (let i = 0; i <= tubularSegs; i++) {
      const u = i / tubularSegs;
      curve.getPoint(u, tmpPt);
      curve.getTangent(u, tmpTan);
      if (Math.abs(tmpTan.z) > 0.92) {
        tmpUp.set(1, 0, 0);
      } else {
        tmpUp.set(0, 0, 1);
      }
      tmpN.crossVectors(tmpUp, tmpTan).normalize();
      tmpB.crossVectors(tmpTan, tmpN).normalize();

      for (let j = 0; j <= radialSegs; j++) {
        const th = (j / radialSegs) * Math.PI * 2;
        const co = Math.cos(th);
        const si = Math.sin(th);
        const nx = tmpN.x * co + tmpB.x * si;
        const ny = tmpN.y * co + tmpB.y * si;
        const nz = tmpN.z * co + tmpB.z * si;
        const idx = (i * (radialSegs + 1) + j) * 3;
        positions[idx] = tmpPt.x + radius * nx;
        positions[idx + 1] = tmpPt.y + radius * ny;
        positions[idx + 2] = tmpPt.z + radius * nz;
        normals[idx] = nx;
        normals[idx + 1] = ny;
        normals[idx + 2] = nz;
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    geo.computeBoundingSphere();
  }

  return { geo, updateFromCurve };
}

export function buildCatheterRig(scene, registry, timeline) {
  const wc = timeline?.worldContract || {};
  const tipRestingY = wc.catheterTipRestingY ?? 0.88;
  const murphyEyesOffsetY = wc.murphyEyesOffsetY ?? -0.14;
  const balloonCenterOffsetY = wc.balloonCenterOffsetY ?? -0.44;
  const shaftRadius = wc.shaftRadius ?? 0.062;
  const balloonMinR = wc.balloonMinRadius ?? 0.068;
  const balloonMaxR = wc.balloonMaxRadius ?? 0.295;
  const urethraZ = wc.urethraEntryZ ?? 0.15;
  const yJunctionWorld = wc.yJunctionPos || [0.0, -1.42, 0.15];
  const valveSideWorld = wc.valveSidePos || [0.42, -1.30, 0.15];
  const drainageBagWorld = wc.drainageBagPos || [-0.36, -2.42, 0.12];

  // Local Y coordinates relative to catheter tip (local y = 0)
  const yHubLocalY = yJunctionWorld[1] - tipRestingY; // -1.42 - 0.88 = -2.30
  const valveLocalPos = new THREE.Vector3(
    valveSideWorld[0],
    valveSideWorld[1] - tipRestingY, // -1.30 - 0.88 = -2.18
    valveSideWorld[2]
  );

  const catheterGroup = new THREE.Group();
  catheterGroup.name = 'catheterGroup';
  if (scene) scene.add(catheterGroup);

  const catheterBody = new THREE.Group();
  catheterBody.name = 'catheterBody';
  catheterBody.position.set(0, tipRestingY, 0);
  catheterGroup.add(catheterBody);

  // =========================================================================
  // 1. Shared Material Registry (Strictly <= 10 Materials)
  // =========================================================================
  const matSiliconeOuter = registry.getStandard('cath_silicone_outer', {
    color: '#DDF0FF',
    roughness: 0.14,
    metalness: 0.08,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });

  const matCutawayCover = registry.getStandard('cath_cutaway_cover', {
    color: '#DDF0FF',
    roughness: 0.14,
    metalness: 0.08,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });

  const matSiliconeSolid = registry.getStandard('cath_silicone_solid', {
    color: '#D4EAFF',
    roughness: 0.20,
    metalness: 0.06,
  });

  const matCavityDark = registry.getStandard('cath_cavity_dark', {
    color: '#071422',
    roughness: 0.52,
    metalness: 0.10,
  });

  const matSilverMetal = registry.getStandard('cath_silver_metal', {
    color: '#DCE8F5',
    roughness: 0.22,
    metalness: 0.82,
  });

  const matAmberLumen = registry.getStandard('cath_amber_lumen', {
    color: '#F59E0B',
    emissive: '#B45309',
    emissiveIntensity: 0.34,
    roughness: 0.18,
    metalness: 0.06,
    transparent: true,
    opacity: 0.68,
    depthWrite: false,
  });

  const matCyanLumen = registry.getStandard('cath_cyan_lumen', {
    color: '#38BDF8',
    emissive: '#0284C7',
    emissiveIntensity: 0.68,
    roughness: 0.15,
    metalness: 0.08,
    transparent: true,
    opacity: 0.88,
  });

  const matBalloon = registry.getStandard('cath_balloon', {
    color: '#22D3EE',
    emissive: '#06B6D4',
    emissiveIntensity: 0.48,
    roughness: 0.12,
    metalness: 0.08,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });

  const matValveBlue = registry.getStandard('cath_valve_blue', {
    color: '#0EA5E9',
    emissive: '#0369A1',
    emissiveIntensity: 0.20,
    roughness: 0.24,
    metalness: 0.12,
  });

  const syringeTex = createSyringeScaleTexture();
  const matSyringeBarrel = registry.getStandard('cath_syringe_barrel', {
    color: '#ECFEFF',
    map: syringeTex || null,
    roughness: 0.12,
    metalness: 0.06,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
  });

  // =========================================================================
  // 2. Solid Silicone Details (Tip Dome, Balloon Cuff Bands, Y-Hub Collars)
  // =========================================================================
  const solidParts = [];

  // Smooth rounded atraumatic tip dome (local y = 0 down to y = -0.24)
  const tipPts = [];
  const tipSegs = 12;
  for (let i = 0; i <= tipSegs; i++) {
    const u = i / tipSegs;
    if (u <= 0.35) {
      // Bottom straight cylinder up to -0.09
      const y = lerp(-0.24, -0.09, u / 0.35);
      tipPts.push(new THREE.Vector2(shaftRadius, y));
    } else {
      // Smooth elliptical dome from -0.09 up to 0.0
      const k = (u - 0.35) / 0.65; // 0 .. 1
      const ang = k * (Math.PI * 0.5);
      const r = shaftRadius * Math.cos(ang);
      const y = -0.09 + 0.09 * Math.sin(ang);
      tipPts.push(new THREE.Vector2(Math.max(0.0001, r), y));
    }
  }
  const tipGeo = new THREE.LatheGeometry(tipPts, 24);
  solidParts.push(tipGeo);

  // Subtle balloon cuff rings (locking balloon edges cleanly onto shaft)
  const cuffTop = new THREE.CylinderGeometry(shaftRadius + 0.003, shaftRadius + 0.003, 0.018, 20);
  cuffTop.translate(0, balloonCenterOffsetY + 0.21, 0);
  solidParts.push(cuffTop);

  const cuffBot = new THREE.CylinderGeometry(shaftRadius + 0.003, shaftRadius + 0.003, 0.018, 20);
  cuffBot.translate(0, balloonCenterOffsetY - 0.21, 0);
  solidParts.push(cuffBot);

  // Y-junction top collar & bottom strain-relief cuff
  const yTopCollar = new THREE.CylinderGeometry(0.072, 0.066, 0.055, 20);
  yTopCollar.translate(0, yHubLocalY + 0.11, urethraZ);
  solidParts.push(yTopCollar);

  const yDrainCollar = new THREE.CylinderGeometry(0.056, 0.048, 0.07, 18);
  yDrainCollar.rotateZ(-0.14);
  yDrainCollar.translate(-0.022, yHubLocalY - 0.14, urethraZ);
  solidParts.push(yDrainCollar);

  const solidSiliconeMesh = new THREE.Mesh(safeMerge(solidParts), matSiliconeSolid);
  solidSiliconeMesh.name = 'solidSiliconeMesh';
  solidSiliconeMesh.castShadow = true;
  solidSiliconeMesh.receiveShadow = true;
  catheterBody.add(solidSiliconeMesh);

  // =========================================================================
  // 3. Twin Oval Murphy Drainage Eyes & Port Cavities (Dark + Silver-Cyan Rim)
  // =========================================================================
  const darkParts = [];
  const silverParts = [];

  const eyeAngles = [-Math.PI * 0.34, Math.PI * 0.34]; // ±61° from +Z -> ±X sides angled forward toward +Z
  for (const ang of eyeAngles) {
    const nx = Math.sin(ang);
    const nz = Math.cos(ang);
    const rimRadius = 0.022;
    const eyeCenterR = shaftRadius - 0.001;
    const ex = nx * eyeCenterR;
    const ez = nz * eyeCenterR;

    // Bright silver-cyan oval bevel rim hugging tip flank
    const rimGeo = new THREE.TorusGeometry(rimRadius, 0.0052, 8, 22);
    rimGeo.scale(0.76, 1.48, 0.55);
    rimGeo.rotateY(ang);
    rimGeo.translate(ex, murphyEyesOffsetY, ez);
    silverParts.push(rimGeo);

    // Deep dark recessed oval lumen bore cavity inside the rim
    const cavGeo = new THREE.CylinderGeometry(rimRadius * 0.72, rimRadius * 0.56, 0.026, 18);
    cavGeo.scale(0.74, 1.0, 1.42);
    cavGeo.rotateX(Math.PI * 0.5);
    cavGeo.rotateY(ang);
    cavGeo.translate(nx * (shaftRadius - 0.012), murphyEyesOffsetY, nz * (shaftRadius - 0.012));
    darkParts.push(cavGeo);
  }

  // Valve direction vector (angled smoothly upward-right in XY plane so syringe stays cleanly framed)
  const valveDir = new THREE.Vector3(0.46, 0.888, 0.0).normalize();
  const valveQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), valveDir);

  // Valve metallic spring collar + Luer lock collar
  const springCollar = new THREE.CylinderGeometry(0.056, 0.056, 0.042, 20);
  springCollar.applyQuaternion(valveQuat);
  springCollar.translate(
    valveLocalPos.x - valveDir.x * 0.065,
    valveLocalPos.y - valveDir.y * 0.065,
    valveLocalPos.z
  );
  silverParts.push(springCollar);

  const luerMetalRing = new THREE.CylinderGeometry(0.044, 0.048, 0.024, 20);
  luerMetalRing.applyQuaternion(valveQuat);
  luerMetalRing.translate(
    valveLocalPos.x + valveDir.x * 0.055,
    valveLocalPos.y + valveDir.y * 0.055,
    valveLocalPos.z
  );
  silverParts.push(luerMetalRing);

  // Dark valve bore interior
  const valveHole = new THREE.CylinderGeometry(0.024, 0.024, 0.030, 14);
  valveHole.applyQuaternion(valveQuat);
  valveHole.translate(
    valveLocalPos.x + valveDir.x * 0.058,
    valveLocalPos.y + valveDir.y * 0.058,
    valveLocalPos.z
  );
  darkParts.push(valveHole);

  const darkDetailsMesh = new THREE.Mesh(safeMerge(darkParts), matCavityDark);
  darkDetailsMesh.name = 'darkDetailsMesh';
  catheterBody.add(darkDetailsMesh);

  const silverDetailsMesh = new THREE.Mesh(safeMerge(silverParts), matSilverMetal);
  silverDetailsMesh.name = 'silverDetailsMesh';
  catheterBody.add(silverDetailsMesh);

  // =========================================================================
  // 4. Outer Silicone Shaft (Upper, Thick Cutaway C-Trough, Lower, Y-Hub Sleeve)
  // =========================================================================
  const cutawayTopY = -0.75;
  const cutawayBotY = -2.05;
  const windowStart = 0.14 * Math.PI;
  const windowLen = 0.72 * Math.PI; // 130° front window centered at +Z (PI/2)
  const troughStart = windowStart + windowLen; // 0.86 * PI
  const troughLen = Math.PI * 2 - windowLen;   // 230° back/side trough

  const outerShaftParts = [];

  // Upper intact shaft (-0.22 down to -0.75)
  outerShaftParts.push(
    buildSweptChannel({
      yStart: -0.22,
      yEnd: cutawayTopY,
      ySegs: 12,
      rOuter: shaftRadius,
      rInner: 0.049,
      thetaStart: 0,
      thetaLength: Math.PI * 2,
      radialSegs: 24,
      zFn: (y) => shaftZ(y, urethraZ),
      capEnds: true,
    })
  );

  // Mid cutaway thick-walled C-channel trough (-0.75 down to -2.05)
  outerShaftParts.push(
    buildSweptChannel({
      yStart: cutawayTopY,
      yEnd: cutawayBotY,
      ySegs: 20,
      rOuter: shaftRadius,
      rInner: 0.049,
      thetaStart: troughStart,
      thetaLength: troughLen,
      radialSegs: 18,
      zFn: (y) => shaftZ(y, urethraZ),
      capEnds: true,
    })
  );

  // Lower intact shaft (-2.05 down to -2.22)
  outerShaftParts.push(
    buildSweptChannel({
      yStart: cutawayBotY,
      yEnd: yHubLocalY + 0.08,
      ySegs: 6,
      rOuter: shaftRadius,
      rInner: 0.049,
      thetaStart: 0,
      thetaLength: Math.PI * 2,
      radialSegs: 24,
      zFn: (y) => shaftZ(y, urethraZ),
      capEnds: true,
    })
  );

  // Translucent molded Y-junction outer body
  const yHubCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, yHubLocalY + 0.10, urethraZ),
    new THREE.Vector3(0, yHubLocalY, urethraZ),
    new THREE.Vector3(-0.022, yHubLocalY - 0.14, urethraZ),
  ]);
  outerShaftParts.push(new THREE.TubeGeometry(yHubCurve, 10, 0.072, 16, false));

  // Side-arm translucent silicone branch to check valve
  const sideBranchCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.02, yHubLocalY - 0.02, urethraZ),
    new THREE.Vector3(0.18, yHubLocalY + 0.03, urethraZ),
    new THREE.Vector3(valveLocalPos.x - valveDir.x * 0.06, valveLocalPos.y - valveDir.y * 0.06, valveLocalPos.z),
  ]);
  outerShaftParts.push(new THREE.TubeGeometry(sideBranchCurve, 10, 0.042, 14, false));

  const outerShaftMesh = new THREE.Mesh(safeMerge(outerShaftParts), matSiliconeOuter);
  outerShaftMesh.name = 'outerShaftMesh';
  outerShaftMesh.renderOrder = 3;
  catheterBody.add(outerShaftMesh);

  // Retractable Front Cutaway Cover Strip (Beat 2 peel-open)
  const cutawayCoverGeo = buildSweptChannel({
    yStart: cutawayTopY,
    yEnd: cutawayBotY,
    ySegs: 20,
    rOuter: shaftRadius + 0.0005,
    rInner: 0.0505,
    thetaStart: windowStart + 0.003,
    thetaLength: windowLen - 0.006,
    radialSegs: 14,
    zFn: (y) => shaftZ(y, urethraZ),
    capEnds: true,
  });
  const cutawayCoverMesh = new THREE.Mesh(cutawayCoverGeo, matCutawayCover);
  cutawayCoverMesh.name = 'cutawayCoverMesh';
  cutawayCoverMesh.renderOrder = 4;
  catheterBody.add(cutawayCoverMesh);

  // =========================================================================
  // 5. Dual Parallel Internal Lumens (Main Amber Drainage + Right Cyan Inflation)
  // =========================================================================
  // a) Main Amber Drainage Channel (r = 0.029, shifted left to x = -0.015 inside cutaway)
  function amberX(y) {
    if (y >= -0.60) return 0.0;
    if (y <= -2.18) {
      const k = smoothstep(-2.18, -2.44, y);
      return lerp(-0.015, -0.025, k);
    }
    const u = smoothstep(-0.60, -0.78, y);
    return lerp(0.0, -0.015, u);
  }

  const amberGeo = buildSweptChannel({
    yStart: murphyEyesOffsetY + 0.01,
    yEnd: yHubLocalY - 0.16,
    ySegs: 34,
    rOuter: 0.029,
    rInner: 0.0,
    radialSegs: 16,
    xFn: amberX,
    zFn: (y) => shaftZ(y, urethraZ),
    capEnds: true,
  });
  const amberLumenMesh = new THREE.Mesh(amberGeo, matAmberLumen);
  amberLumenMesh.name = 'amberLumenMesh';
  amberLumenMesh.renderOrder = 1;
  catheterBody.add(amberLumenMesh);

  // b) Peripheral Cyan Inflation Micro-Lumen (r = 0.015, offset right at x = +0.034)
  const inflationCurvePts = [
    new THREE.Vector3(valveLocalPos.x - valveDir.x * 0.02, valveLocalPos.y - valveDir.y * 0.02, valveLocalPos.z),
    new THREE.Vector3(0.22, yHubLocalY + 0.04, urethraZ),
    new THREE.Vector3(0.06, yHubLocalY + 0.01, urethraZ),
    new THREE.Vector3(0.034, cutawayBotY, shaftZ(cutawayBotY, urethraZ)),
    new THREE.Vector3(0.034, -1.40, shaftZ(-1.40, urethraZ)),
    new THREE.Vector3(0.034, cutawayTopY, shaftZ(cutawayTopY, urethraZ)),
    new THREE.Vector3(0.034, balloonCenterOffsetY, 0.0),
  ];
  const inflationCurve = new THREE.CatmullRomCurve3(inflationCurvePts, false, 'centripetal', 0.45);
  const cyanTubeGeo = new THREE.TubeGeometry(inflationCurve, 44, 0.0145, 10, false);
  const cyanPortDot = new THREE.SphereGeometry(0.022, 12, 10);
  cyanPortDot.translate(0.034, balloonCenterOffsetY, 0.0);

  const cyanLumenMesh = new THREE.Mesh(safeMerge([cyanTubeGeo, cyanPortDot]), matCyanLumen);
  cyanLumenMesh.name = 'cyanLumenMesh';
  cyanLumenMesh.renderOrder = 2;
  catheterBody.add(cyanLumenMesh);

  // 10 InstancedMesh glowing cyan sterile fluid beads inside Inflation Micro-Lumen
  const BEAD_COUNT = 10;
  const beadGeo = new THREE.SphereGeometry(0.0165, 10, 8);
  const inflationBeadsMesh = new THREE.InstancedMesh(beadGeo, matCyanLumen, BEAD_COUNT);
  inflationBeadsMesh.name = 'inflationBeadsMesh';
  inflationBeadsMesh.frustumCulled = false;
  inflationBeadsMesh.visible = false;
  catheterBody.add(inflationBeadsMesh);

  // =========================================================================
  // 6. Dynamic Retention Balloon (0 -> 10 mL) + Inner Glow Sprite
  // =========================================================================
  const balloonMorph = buildBalloonMorphGeometry(balloonMinR, balloonMaxR, 28, 18);
  const balloonMesh = new THREE.Mesh(balloonMorph.geo, matBalloon);
  balloonMesh.name = 'balloonMesh';
  balloonMesh.position.set(0, balloonCenterOffsetY, 0);
  balloonMesh.renderOrder = 5;
  catheterBody.add(balloonMesh);

  const balloonGlowSprite = createGlowSprite('#22D3EE', 0.56, 0.0);
  balloonGlowSprite.name = 'balloonGlowSprite';
  balloonGlowSprite.position.set(0, balloonCenterOffsetY, 0);
  catheterBody.add(balloonGlowSprite);

  // =========================================================================
  // 7. Blue One-Way Check Valve Side Arm + Calibrated 10 mL Sterile Syringe
  // =========================================================================
  const valveParts = [];
  const valveMain = new THREE.CylinderGeometry(0.052, 0.048, 0.12, 20);
  valveMain.applyQuaternion(valveQuat);
  valveMain.translate(valveLocalPos.x, valveLocalPos.y, valveLocalPos.z);
  valveParts.push(valveMain);

  // Ribbed grip collar on valve housing
  for (let r = -1; r <= 1; r++) {
    const rib = new THREE.CylinderGeometry(0.058, 0.058, 0.014, 20);
    rib.applyQuaternion(valveQuat);
    rib.translate(
      valveLocalPos.x + valveDir.x * r * 0.026,
      valveLocalPos.y + valveDir.y * r * 0.026,
      valveLocalPos.z
    );
    valveParts.push(rib);
  }

  const valveBlueMesh = new THREE.Mesh(safeMerge(valveParts), matValveBlue);
  valveBlueMesh.name = 'valveBlueMesh';
  valveBlueMesh.castShadow = true;
  catheterBody.add(valveBlueMesh);

  // Calibrated 10 mL Syringe Group attached cleanly to Check Valve
  const syringeGroup = new THREE.Group();
  syringeGroup.name = 'syringeGroup';
  syringeGroup.position.set(
    valveLocalPos.x + valveDir.x * 0.068,
    valveLocalPos.y + valveDir.y * 0.068,
    valveLocalPos.z
  );
  syringeGroup.quaternion.copy(valveQuat);
  catheterBody.add(syringeGroup);

  const barrelLen = 0.42;
  const barrelRadius = 0.048;
  const maxTravel = 0.35; // 10 mL stroke inside barrel

  const barrelParts = [];
  const barrelCyl = new THREE.CylinderGeometry(barrelRadius, barrelRadius, barrelLen, 22, 1, true);
  barrelCyl.rotateY(Math.PI); // put texture u=0.5 facing +Z camera
  barrelCyl.translate(0, barrelLen * 0.5 + 0.028, 0);
  barrelParts.push(barrelCyl);

  // Luer slip nozzle at bottom of barrel
  const nozzle = new THREE.CylinderGeometry(0.020, 0.014, 0.040, 14);
  nozzle.translate(0, 0.014, 0);
  barrelParts.push(nozzle);

  // Top finger grip flange
  const fingerFlange = new THREE.BoxGeometry(0.145, 0.014, 0.088);
  fingerFlange.translate(0, barrelLen + 0.028, 0);
  barrelParts.push(fingerFlange);

  const syringeBarrelMesh = new THREE.Mesh(safeMerge(barrelParts), matSyringeBarrel);
  syringeBarrelMesh.name = 'syringeBarrelMesh';
  syringeBarrelMesh.renderOrder = 6;
  syringeGroup.add(syringeBarrelMesh);

  // Dynamic sterile cyan water column inside syringe barrel (base at y = 0.032)
  const waterGeo = new THREE.CylinderGeometry(0.041, 0.041, maxTravel, 18);
  waterGeo.translate(0, maxTravel * 0.5, 0);
  const syringeWaterMesh = new THREE.Mesh(waterGeo, matCyanLumen);
  syringeWaterMesh.name = 'syringeWaterMesh';
  syringeWaterMesh.position.set(0, 0.034, 0);
  syringeGroup.add(syringeWaterMesh);

  // Animated Plunger Assembly (Rubber Gasket + Cross-Ribbed Rod + Thumb Flange)
  const plungerGroup = new THREE.Group();
  plungerGroup.name = 'plungerGroup';
  syringeGroup.add(plungerGroup);

  const gasketParts = [];
  const gasket1 = new THREE.CylinderGeometry(0.043, 0.043, 0.018, 18);
  gasket1.translate(0, 0.009, 0);
  gasketParts.push(gasket1);
  const gasket2 = new THREE.CylinderGeometry(0.043, 0.043, 0.014, 18);
  gasket2.translate(0, 0.030, 0);
  gasketParts.push(gasket2);
  const syringeGasketMesh = new THREE.Mesh(safeMerge(gasketParts), matCavityDark);
  syringeGasketMesh.name = 'syringeGasketMesh';
  plungerGroup.add(syringeGasketMesh);

  const rodLen = 0.41;
  const plungerParts = [];
  const rodV1 = new THREE.BoxGeometry(0.038, rodLen, 0.008);
  rodV1.translate(0, 0.037 + rodLen * 0.5, 0);
  plungerParts.push(rodV1);
  const rodV2 = new THREE.BoxGeometry(0.008, rodLen, 0.038);
  rodV2.translate(0, 0.037 + rodLen * 0.5, 0);
  plungerParts.push(rodV2);
  const thumbFlange = new THREE.CylinderGeometry(0.056, 0.056, 0.015, 20);
  thumbFlange.translate(0, 0.037 + rodLen + 0.008, 0);
  plungerParts.push(thumbFlange);

  const syringePlungerMesh = new THREE.Mesh(safeMerge(plungerParts), matSiliconeSolid);
  syringePlungerMesh.name = 'syringePlungerMesh';
  syringePlungerMesh.castShadow = true;
  plungerGroup.add(syringePlungerMesh);

  // =========================================================================
  // 8. Flexible Drainage Extension Tube -> drainageBagPos [-0.36, -2.42, 0.12]
  // =========================================================================
  const drainExtOuter = createDynamicTube(0.042, 18, 12);
  const drainageExtOuterMesh = new THREE.Mesh(drainExtOuter.geo, matSiliconeOuter);
  drainageExtOuterMesh.name = 'drainageExtOuterMesh';
  drainageExtOuterMesh.renderOrder = 3;
  catheterGroup.add(drainageExtOuterMesh);

  const drainExtAmber = createDynamicTube(0.025, 18, 10);
  const drainageExtAmberMesh = new THREE.Mesh(drainExtAmber.geo, matAmberLumen);
  drainageExtAmberMesh.name = 'drainageExtAmberMesh';
  drainageExtAmberMesh.renderOrder = 1;
  catheterGroup.add(drainageExtAmberMesh);

  const nozzleBagGeo = new THREE.CylinderGeometry(0.048, 0.036, 0.085, 16);
  const drainagePortNozzleMesh = new THREE.Mesh(nozzleBagGeo, matValveBlue);
  drainagePortNozzleMesh.name = 'drainagePortNozzleMesh';
  drainagePortNozzleMesh.position.set(drainageBagWorld[0], drainageBagWorld[1] + 0.035, drainageBagWorld[2]);
  catheterGroup.add(drainagePortNozzleMesh);

  // Pre-allocated curve points & scratch objects for zero per-frame allocations
  const extP0 = new THREE.Vector3();
  const extP1 = new THREE.Vector3();
  const extP2 = new THREE.Vector3();
  const extP3 = new THREE.Vector3(drainageBagWorld[0], drainageBagWorld[1] + 0.05, drainageBagWorld[2]);
  const extCurve = new THREE.CatmullRomCurve3([extP0, extP1, extP2, extP3]);

  const beadDummy = new THREE.Object3D();
  const beadPos = new THREE.Vector3();

  // Local anchor positions on catheterBody
  const localTipEyes = new THREE.Vector3(0.048, murphyEyesOffsetY, 0.032);
  const localDualLumen = new THREE.Vector3(0.0, -1.38, shaftZ(-1.38, urethraZ));
  const localBalloon = new THREE.Vector3(0.0, balloonCenterOffsetY, 0.0);
  const localCheckValve = valveLocalPos.clone();
  const localSyringe = new THREE.Vector3(
    valveLocalPos.x + valveDir.x * 0.28,
    valveLocalPos.y + valveDir.y * 0.28,
    valveLocalPos.z
  );

  // World anchor cache
  const anchors = {
    tipEyes: new THREE.Vector3(),
    dualLumen: new THREE.Vector3(),
    balloon: new THREE.Vector3(),
    checkValve: new THREE.Vector3(),
    syringe: new THREE.Vector3(),
    drainagePort: new THREE.Vector3(drainageBagWorld[0], drainageBagWorld[1], drainageBagWorld[2]),
  };

  const state = {
    balloonMl: 0,
    drainageMl: 0,
    flowActive: false,
    tipY: tipRestingY,
    insertOffsetY: 0,
    valveLocked: false,
  };

  let lastBalloonMorph = -1;
  let lastExtSig = '';

  function updateBalloonMorph(tInflate) {
    if (Math.abs(tInflate - lastBalloonMorph) < 1e-4) return;
    lastBalloonMorph = tInflate;
    const posAttr = balloonMorph.geo.attributes.position;
    const arr = posAttr.array;
    const cArr = balloonMorph.collapsedPos;
    const iArr = balloonMorph.inflatedPos;
    for (let i = 0; i < arr.length; i++) {
      arr[i] = cArr[i] + (iArr[i] - cArr[i]) * tInflate;
    }
    posAttr.needsUpdate = true;
    balloonMorph.geo.computeVertexNormals();
    balloonMorph.geo.computeBoundingSphere();
  }

  function update(t = 0) {
    // 1. Placement Choreography (Beats 1-6)
    let insertOffsetY = 0.0;
    let bodyOffsetZ = 0.0;
    let microRotY = 0.0;

    if (t < 10.2) {
      // Beats 1-2: centered studio height; gentle presentation sway in Beat 1, locked straight in Beat 2
      insertOffsetY = 0.0;
      bodyOffsetZ = 0.0;
      const swayFade = 1.0 - smoothstep(4.5, 5.05, t);
      microRotY = Math.sin(t * 1.15) * 0.08 * swayFade;
    } else if (t < 15.2) {
      // Beat 3: atraumatic insertion glide upward along urethral curve
      const pInsert = smoothstep(10.2, 14.6, t);
      insertOffsetY = lerp(-1.18, 0.0, pInsert);
      bodyOffsetZ = lerp(0.06, 0.0, pInsert);
      microRotY = 0.0;
    } else if (t < 26.2) {
      // Beats 4-5: locked stationary inside bladder
      insertOffsetY = 0.0;
      bodyOffsetZ = 0.0;
      microRotY = 0.0;
    } else {
      // Beat 6: balloon collapses first (26.2..28.05), then catheter slides out smoothly
      const pRemove = smoothstep(28.05, 29.75, t);
      insertOffsetY = lerp(0.0, -1.05, pRemove);
      bodyOffsetZ = lerp(0.0, 0.055, pRemove);
      microRotY = 0.0;
    }

    catheterBody.position.set(0, tipRestingY + insertOffsetY, bodyOffsetZ);
    catheterBody.rotation.set(0, microRotY, 0);

    // 2. Beat 2 Axial Cutaway Peel (t = 5.0..10.2s)
    const openIn = smoothstep(5.05, 6.05, t);
    const closeOut = smoothstep(9.75, 10.18, t);
    const cutawayOpen01 = openIn * (1.0 - closeOut);

    if (cutawayOpen01 > 0.005) {
      cutawayCoverMesh.position.set(-0.11 * cutawayOpen01, 0.01 * cutawayOpen01, 0.095 * cutawayOpen01);
      cutawayCoverMesh.rotation.set(0, -0.36 * cutawayOpen01, 0);
      const coverOpacity = 0.42 * (1.0 - clamp01(cutawayOpen01 * 1.15));
      matCutawayCover.opacity = coverOpacity;
      cutawayCoverMesh.visible = coverOpacity > 0.012;
    } else {
      cutawayCoverMesh.position.set(0, 0, 0);
      cutawayCoverMesh.rotation.set(0, 0, 0);
      // Slightly clearer front cover in Beat 5 so amber drainage cascade shines through cleanly
      const beat5Clarity = smoothstep(20.6, 21.2, t) * (1.0 - smoothstep(26.0, 26.4, t));
      matCutawayCover.opacity = lerp(0.42, 0.18, beat5Clarity);
      cutawayCoverMesh.visible = true;
    }

    // 3. Retention Balloon Inflation / Lock / Deflation (0 <-> 10 mL)
    let inflate01 = 0.0;
    if (t >= 15.6 && t < 19.4) {
      inflate01 = smoothstep(15.6, 19.4, t);
    } else if (t >= 19.4 && t < 26.25) {
      inflate01 = 1.0;
    } else if (t >= 26.25 && t <= 28.25) {
      inflate01 = 1.0 - smoothstep(26.25, 28.15, t);
    }
    updateBalloonMorph(inflate01);

    const pulseBeat = 0.5 + 0.5 * Math.sin(t * 5.2);
    const isInflating = t >= 15.55 && t <= 19.50;
    const isDeflating = t >= 26.20 && t <= 28.25;
    matBalloon.emissiveIntensity = 0.38 + 0.28 * inflate01 + (isInflating ? 0.16 * pulseBeat : 0);
    balloonGlowSprite.material.opacity = inflate01 * (0.42 + (isInflating ? 0.22 * pulseBeat : 0.08 * pulseBeat));
    const glowScale = lerp(0.22, 0.72, inflate01);
    balloonGlowSprite.scale.set(glowScale, glowScale, 1);

    // 4. Inflation Micro-Lumen Fluid Beads (InstancedMesh)
    if (isInflating || isDeflating) {
      inflationBeadsMesh.visible = true;
      for (let i = 0; i < BEAD_COUNT; i++) {
        const raw = isInflating
          ? ((t - 15.55) * 1.45 + i / BEAD_COUNT) % 1.0
          : 1.0 - (((t - 26.20) * 1.65 + i / BEAD_COUNT) % 1.0);
        const u = clamp01(raw);
        inflationCurve.getPoint(u, beadPos);
        const edgeFade = Math.sin(u * Math.PI);
        const s = Math.max(0.001, edgeFade * 1.08);
        beadDummy.position.copy(beadPos);
        beadDummy.scale.set(s, s, s);
        beadDummy.updateMatrix();
        inflationBeadsMesh.setMatrixAt(i, beadDummy.matrix);
      }
      inflationBeadsMesh.instanceMatrix.needsUpdate = true;
    } else {
      inflationBeadsMesh.visible = false;
    }

    // 5. Sterile 10 mL Syringe Visibility, Docking & Plunger Travel
    let syringeScale = 0.0;
    let syringeDockOffset = 0.0;
    let water01 = 1.0;

    if (t < 5.25) {
      // Beat 1 kit overview (retracts cleanly right as Beat 2 cutaway starts)
      const out = smoothstep(4.90, 5.25, t);
      syringeScale = 1.0 - out;
      syringeDockOffset = 0.22 * out;
      water01 = 1.0;
    } else if (t >= 15.20 && t < 20.80) {
      // Beat 4: docks cleanly, depresses 10->0 mL, uncouples at end showing locked valve
      const dockIn = smoothstep(15.20, 15.55, t);
      const uncoupleOut = smoothstep(20.42, 20.78, t);
      syringeScale = dockIn * (1.0 - uncoupleOut);
      syringeDockOffset = 0.22 * (1.0 - dockIn) + 0.22 * uncoupleOut;
      water01 = 1.0 - inflate01;
    } else if (t >= 26.15) {
      // Beat 6: re-couples, withdraws 0->10 mL as balloon collapses
      const dockIn = smoothstep(26.15, 26.48, t);
      syringeScale = dockIn;
      syringeDockOffset = 0.22 * (1.0 - dockIn);
      water01 = 1.0 - inflate01;
    }

    syringeGroup.visible = syringeScale > 0.01;
    if (syringeGroup.visible) {
      syringeGroup.position.set(
        valveLocalPos.x + valveDir.x * (0.068 + syringeDockOffset),
        valveLocalPos.y + valveDir.y * (0.068 + syringeDockOffset),
        valveLocalPos.z
      );
      syringeGroup.scale.setScalar(syringeScale);

      const safeWater = Math.max(0.002, water01);
      syringeWaterMesh.visible = water01 > 0.015;
      syringeWaterMesh.scale.set(1, safeWater, 1);
      plungerGroup.position.set(0, 0.034 + maxTravel * water01, 0);
    }

    // 6. Beat 5 Closed Gravity Drainage State & Amber Lumen Emissive Pulse
    const flowActive = t >= 20.85 && t <= 26.15;
    const drainageMl = flowActive
      ? 250.0 * smoothstep(20.85, 26.15, t)
      : t > 26.15
      ? 250.0
      : 0.0;

    matAmberLumen.emissiveIntensity = flowActive
      ? 0.50 + 0.14 * Math.sin(t * 7.2)
      : 0.34;
    matAmberLumen.opacity = flowActive ? 0.82 : 0.68;

    // 7. Flexible Drainage Extension Tube (connects to bag during Beat 5 [20.15..26.55s], trails softly downward otherwise)
    const bagActive01 = smoothstep(20.15, 20.60, t) * (1.0 - smoothstep(26.22, 26.55, t));
    drainagePortNozzleMesh.visible = bagActive01 > 0.08;
    const extSig = `${insertOffsetY.toFixed(4)}_${bodyOffsetZ.toFixed(4)}_${microRotY.toFixed(4)}_${bagActive01.toFixed(3)}`;
    if (extSig !== lastExtSig) {
      lastExtSig = extSig;
      const cosR = Math.cos(microRotY);
      const sinR = Math.sin(microRotY);
      // Local Y-hub bottom-left drainage outlet (-0.025, yHubLocalY - 0.15, urethraZ)
      const lx = -0.025;
      const lz = urethraZ;
      extP0.set(
        lx * cosR + lz * sinR,
        tipRestingY + insertOffsetY + (yHubLocalY - 0.15),
        bodyOffsetZ - lx * sinR + lz * cosR
      );
      const offscreenX = extP0.x - 0.14;
      const offscreenY = extP0.y - 0.82;
      const offscreenZ = extP0.z;
      extP3.set(
        lerp(offscreenX, drainageBagWorld[0], bagActive01),
        lerp(offscreenY, drainageBagWorld[1] + 0.05, bagActive01),
        lerp(offscreenZ, drainageBagWorld[2], bagActive01)
      );
      const lowSag = Math.min(extP0.y, extP3.y) - (insertOffsetY < -0.25 && bagActive01 > 0.2 ? 0.16 : 0.0);
      extP1.set(
        lerp(extP0.x, extP3.x, 0.28),
        insertOffsetY < -0.25 && bagActive01 > 0.2 ? lowSag : lerp(extP0.y, extP3.y, 0.42),
        lerp(extP0.z, extP3.z, 0.30)
      );
      extP2.set(
        lerp(extP0.x, extP3.x, 0.78),
        insertOffsetY < -0.25 && bagActive01 > 0.2 ? lerp(lowSag, extP3.y, 0.55) : lerp(extP0.y, extP3.y, 0.78),
        lerp(extP0.z, extP3.z, 0.75)
      );
      drainExtOuter.updateFromCurve(extCurve);
      drainExtAmber.updateFromCurve(extCurve);
    }

    // 8. Refresh world matrices & project exact world anchors (critical for Node pre-flight & HUD callouts)
    catheterGroup.updateMatrixWorld(true);

    anchors.tipEyes.copy(localTipEyes).applyMatrix4(catheterBody.matrixWorld);
    anchors.dualLumen.copy(localDualLumen).applyMatrix4(catheterBody.matrixWorld);
    anchors.balloon.copy(localBalloon).applyMatrix4(catheterBody.matrixWorld);
    anchors.checkValve.copy(localCheckValve).applyMatrix4(catheterBody.matrixWorld);
    anchors.syringe.copy(localSyringe).applyMatrix4(catheterBody.matrixWorld);
    anchors.drainagePort.set(drainageBagWorld[0], drainageBagWorld[1], drainageBagWorld[2]);

    state.balloonMl = inflate01 * 10.0;
    state.drainageMl = drainageMl;
    state.flowActive = flowActive;
    state.tipY = tipRestingY + insertOffsetY;
    state.insertOffsetY = insertOffsetY;
    state.valveLocked = inflate01 > 0.02 && t >= 19.35 && t <= 26.25;

    return {
      balloonMl: state.balloonMl,
      drainageMl: state.drainageMl,
      flowActive: state.flowActive,
    };
  }

  // Initialize cleanly at t = 0
  update(0);

  return {
    catheterGroup,
    update,
    getAnchors: () => anchors,
    getState: () => state,
  };
}
