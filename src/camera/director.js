/**
 * Clinical Documentary Camera Director (/home/antigravity/catheter-3d-med/src/camera/director.js)
 * Smooth cubic-eased studio dolly & macro framing across 6 clinical education beats.
 * Zero comedic whip-pans, zero handheld jitter, zero SFX impact shake.
 */
import { createBaseDirector, clamp01, lerp } from '../engine/baseDirector.js';

function easeInOutCubic(x) {
  const u = clamp01(x);
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

function easeOutCubic(x) {
  const u = clamp01(x);
  return 1 - Math.pow(1 - u, 3);
}

const TRANSITIONS = {
  studio_hero_overview: { duration: 0.55, whipFov: 0.0, whipRoll: 0.0 },
  macro_lumen_cutaway: { duration: 0.55, whipFov: 0.0, whipRoll: 0.0 },
  anatomical_insertion_glide: { duration: 0.55, whipFov: 0.0, whipRoll: 0.0 },
  balloon_inflation_lock: { duration: 0.55, whipFov: 0.0, whipRoll: 0.0 },
  gravity_drainage_flow: { duration: 0.55, whipFov: 0.0, whipRoll: 0.0 },
  deflation_removal_summary: { duration: 0.55, whipFov: 0.0, whipRoll: 0.0 },
};

export function createMedDirector(camera, timeline) {
  function evaluateShot(shotName, t, activeBeat, _state, outPos, outLook, outScalars) {
    const start = activeBeat?.start ?? 0;
    const end = activeBeat?.end ?? start + 5.0;
    const u = clamp01((t - start) / Math.max(0.01, end - start));
    const s = easeInOutCubic(u);

    outScalars.roll = 0.0;
    outScalars.swayAmp = 0.12;

    switch (shotName) {
      case 'studio_hero_overview': {
        // Beat 1 (0..5.0s): Full upright 2-way Foley catheter overview
        outPos.set(
          lerp(-0.20, 0.22, s),
          lerp(-0.15, -0.35, s),
          lerp(4.95, 4.72, s)
        );
        outLook.set(
          lerp(-0.02, 0.02, s),
          lerp(-0.34, -0.42, s),
          0.12
        );
        outScalars.fov = lerp(44.0, 43.0, s);
        break;
      }

      case 'macro_lumen_cutaway': {
        // Beat 2 (5.0..10.2s): Macro cutaway zoom into mid-shaft showing dual parallel channels
        outPos.set(
          lerp(0.42, 0.34, s),
          lerp(-0.40, -0.50, s),
          lerp(2.26, 1.96, s)
        );
        outLook.set(
          0.0,
          lerp(-0.50, -0.56, s),
          0.14
        );
        outScalars.fov = lerp(41.0, 39.5, s);
        break;
      }

      case 'anatomical_insertion_glide': {
        // Beat 3 (10.2..15.2s): Translucent pelvic bladder + urethral insertion glide (dome below header)
        const glide = easeOutCubic(u);
        outPos.set(
          lerp(-0.14, 0.14, s),
          lerp(0.32, 0.38, glide),
          lerp(5.10, 4.92, s)
        );
        outLook.set(
          0.0,
          lerp(0.36, 0.42, glide),
          0.08
        );
        outScalars.fov = lerp(44.0, 43.5, s);
        break;
      }

      case 'balloon_inflation_lock': {
        // Beat 4 (15.2..20.8s): Full bladder dome (y=1.76) -> urethra -> Y-hub & syringe framed between header & captions
        outPos.set(
          lerp(0.28, 0.22, s),
          lerp(0.05, -0.02, s),
          lerp(6.24, 6.06, s)
        );
        outLook.set(
          lerp(0.10, 0.12, s),
          lerp(-0.04, -0.08, s),
          0.10
        );
        outScalars.fov = lerp(45.0, 44.5, s);
        break;
      }

      case 'gravity_drainage_flow': {
        // Beat 5 (20.8..26.2s): Bladder dome cleanly below header AND graduated bag bottom cleanly above captions
        outPos.set(
          lerp(0.20, 0.14, s),
          lerp(-0.78, -0.84, s),
          lerp(8.98, 8.82, s)
        );
        outLook.set(
          -0.08,
          lerp(-0.84, -0.88, s),
          0.10
        );
        outScalars.fov = 46.5;
        break;
      }

      case 'deflation_removal_summary':
      default: {
        // Beat 6 (26.2..30.0s): Safe deflation then smooth withdrawal keeping bladder dome below header & valve above captions
        const withdrawEase = clamp01((t - 27.85) / 1.95);
        const w = withdrawEase * withdrawEase * (3 - 2 * withdrawEase);
        outPos.set(
          lerp(-0.22, -0.14, s),
          lerp(-0.04, -0.46, w),
          lerp(6.28, 8.15, w)
        );
        outLook.set(
          0.0,
          lerp(-0.08, -0.50, w),
          0.10
        );
        outScalars.fov = lerp(45.0, 46.0, w);
        break;
      }
    }
  }

  const base = createBaseDirector(camera, timeline, evaluateShot, {
    transitions: TRANSITIONS,
  });

  function update(t = 0, state = {}) {
    base.update(t, { ...state, sfxShake: 0 });
  }

  return {
    update,
    findBeatAt: base.findBeatAt,
  };
}

export const createDirector = createMedDirector;
