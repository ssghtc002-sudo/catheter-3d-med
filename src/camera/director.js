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
          lerp(-0.18, 0.20, s),
          lerp(-0.12, -0.30, s),
          lerp(4.68, 4.46, s)
        );
        outLook.set(
          lerp(-0.02, 0.02, s),
          lerp(-0.28, -0.36, s),
          0.12
        );
        outScalars.fov = lerp(43.5, 42.5, s);
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
        // Beat 3 (10.2..15.2s): Larger clean anatomical insertion glide in unobstructed vertical space
        const glide = easeOutCubic(u);
        outPos.set(
          lerp(-0.14, 0.14, s),
          lerp(0.24, 0.32, glide),
          lerp(4.62, 4.44, s)
        );
        outLook.set(
          0.0,
          lerp(0.28, 0.36, glide),
          0.08
        );
        outScalars.fov = lerp(43.5, 43.0, s);
        break;
      }

      case 'balloon_inflation_lock': {
        // Beat 4 (15.2..20.8s): Centered full anatomy + syringe comfortably inside clean canvas
        outPos.set(
          lerp(0.26, 0.20, s),
          lerp(-0.04, -0.10, s),
          lerp(5.76, 5.56, s)
        );
        outLook.set(
          lerp(0.10, 0.12, s),
          lerp(-0.12, -0.16, s),
          0.10
        );
        outScalars.fov = lerp(44.5, 44.0, s);
        break;
      }

      case 'gravity_drainage_flow': {
        // Beat 5 (20.8..26.2s): Closer full vertical system keeping bag cleanly above lower subtitles
        outPos.set(
          lerp(0.18, 0.14, s),
          lerp(-0.80, -0.84, s),
          lerp(8.42, 8.22, s)
        );
        outLook.set(
          -0.08,
          lerp(-0.84, -0.88, s),
          0.10
        );
        outScalars.fov = 46.0;
        break;
      }

      case 'deflation_removal_summary':
      default: {
        // Beat 6 (26.2..30.0s): Safe deflation then withdrawal framed clearly above lower subtitles
        const withdrawEase = clamp01((t - 27.85) / 1.95);
        const w = withdrawEase * withdrawEase * (3 - 2 * withdrawEase);
        outPos.set(
          lerp(-0.20, -0.14, s),
          lerp(-0.10, -0.46, w),
          lerp(5.84, 7.62, w)
        );
        outLook.set(
          0.0,
          lerp(-0.14, -0.50, w),
          0.10
        );
        outScalars.fov = lerp(44.5, 45.5, w);
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
