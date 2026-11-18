/**
 * Clinical Broadcast HUD & Vector Callout Compositor (/home/antigravity/catheter-3d-med/src/hud/medHud.js)
 * Authoritative medical documentary UI (1080x1920):
 *  - Top telemetry header (chapter index, title, live balloon/bag/state counters)
 *  - Dynamic 3D-projected vector callout leader lines with center-clearing anti-overlap placement
 *  - Lower-third frosted medical narration card (max 2 lines, crisp white/sky-cyan word emphasis)
 */

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(e0, e1, x) {
  const u = clamp01((x - e0) / Math.max(1e-5, e1 - e0));
  return u * u * (3 - 2 * u);
}

function drawRoundedRect(c, x, y, w, h, r) {
  const rad = Math.min(r, w * 0.5, h * 0.5);
  c.beginPath();
  c.moveTo(x + rad, y);
  c.lineTo(x + w - rad, y);
  c.quadraticCurveTo(x + w, y, x + w, y + rad);
  c.lineTo(x + w, y + h - rad);
  c.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  c.lineTo(x + rad, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - rad);
  c.lineTo(x, y + rad);
  c.quadraticCurveTo(x, y, x + rad, y);
  c.closePath();
}

const CALLOUT_DEFS_BY_BEAT = {
  beat_1_overview: [
    {
      id: 'murphy_eyes',
      anchorKeys: ['tipEyes', 'murphyEyes', 'murphy_eyes', 'drainageEyes'],
      label: 'MURPHY DRAINAGE EYES',
      side: 'left',
      accent: '#38BDF8',
      delay: 0.25,
    },
    {
      id: 'dual_shaft',
      anchorKeys: ['dualLumen', 'shaftMid', 'shaftCutaway'],
      label: 'DUAL-LUMEN SHAFT',
      side: 'left',
      accent: '#2DD4BF',
      delay: 0.55,
    },
    {
      id: 'check_valve',
      anchorKeys: ['checkValve', 'valveSide', 'inflationValve'],
      label: 'INFLATION VALVE',
      side: 'right',
      accent: '#38BDF8',
      delay: 0.85,
    },
  ],
  beat_2_dual_lumen: [
    {
      id: 'drainage_channel',
      anchorKeys: ['drainageLumen', 'drainageChannel', 'dualLumen'],
      label: 'DRAINAGE CHANNEL',
      side: 'left',
      accent: '#38BDF8',
      yOffset: -48,
      delay: 0.30,
    },
    {
      id: 'inflation_lumen',
      anchorKeys: ['inflationLumen', 'inflationChannel', 'dualLumen'],
      label: 'INFLATION LUMEN',
      side: 'right',
      accent: '#2DD4BF',
      yOffset: 48,
      delay: 0.55,
    },
  ],
  beat_3_insertion: [
    {
      id: 'bladder_cavity',
      anchorKeys: ['bladderCavity', 'bladderCenter', 'bladderDome'],
      label: 'BLADDER CAVITY',
      side: 'right',
      accent: '#2DD4BF',
      yOffset: -24,
      delay: 0.30,
    },
    {
      id: 'murphy_entry',
      anchorKeys: ['tipEyes', 'murphyEyes', 'catheterTip'],
      label: 'MURPHY EYES ENTRY',
      side: 'left',
      accent: '#38BDF8',
      yOffset: 24,
      delay: 0.55,
    },
  ],
  beat_4_balloon_lock: [
    {
      id: 'retention_balloon',
      anchorKeys: ['balloon', 'retentionBalloon', 'balloonCenter'],
      label: '10 mL BALLOON',
      side: 'right',
      accent: '#38BDF8',
      yOffset: -28,
      delay: 0.30,
    },
    {
      id: 'bladder_neck_seal',
      anchorKeys: ['bladderNeck', 'neckSeal', 'bladderNeckSeal'],
      label: 'BLADDER NECK SEAL',
      side: 'left',
      accent: '#2DD4BF',
      yOffset: 10,
      delay: 1.35,
    },
    {
      id: 'water_syringe',
      anchorKeys: ['syringe', 'checkValve', 'valveSide'],
      label: '10 mL SYRINGE',
      side: 'right',
      accent: '#38BDF8',
      yOffset: 18,
      delay: 0.45,
    },
  ],
  beat_5_gravity_drainage: [
    {
      id: 'gravity_flow',
      anchorKeys: ['dualLumen', 'tipEyes', 'shaftMid'],
      label: 'GRAVITY FLOW',
      side: 'right',
      accent: '#F59E0B',
      yOffset: -18,
      delay: 0.35,
    },
    {
      id: 'closed_bag',
      anchorKeys: ['drainageBag', 'drainagePort', 'bagCenter'],
      label: 'CLOSED DRAINAGE BAG',
      side: 'right',
      accent: '#F59E0B',
      yOffset: 0,
      delay: 0.65,
    },
  ],
  beat_6_deflation_recap: [
    {
      id: 'safe_deflation',
      anchorKeys: ['balloon', 'retentionBalloon', 'balloonCenter'],
      label: 'SAFE DEFLATION',
      side: 'left',
      accent: '#38BDF8',
      yOffset: -20,
      delay: 0.25,
    },
    {
      id: 'valve_release',
      anchorKeys: ['checkValve', 'syringe', 'valveSide'],
      label: 'VALVE RELEASE',
      side: 'right',
      accent: '#2DD4BF',
      yOffset: 16,
      delay: 0.45,
    },
  ],
};

export function createMedHud(timeline, manifest = null, canvas = null) {
  const width = timeline?.resolution?.width || 1080;
  const height = timeline?.resolution?.height || 1920;
  const duration = Number(timeline?.duration || 30.0);
  const beats = Array.isArray(timeline?.beats) ? timeline.beats : [];

  if (!canvas && typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
  }
  if (canvas) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas ? canvas.getContext('2d', { alpha: true }) : null;

  const titleText = timeline?.title || 'HOW A FOLEY CATHETER WORKS';
  const categoryBadge = timeline?.categoryBadge || 'CLINICAL ANATOMY • 2-WAY FOLEY';

  const rawLines = Array.isArray(manifest?.lines) && manifest.lines.length > 0
    ? manifest.lines
    : (timeline?.dialogue || []).map((d) => ({
        ...d,
        words: buildFallbackWords(d.text, d.start, d.end),
      }));

  const subtitlePages = rawLines.map((line) => ({
    id: line.id,
    beatId: line.beatId,
    speaker: line.speaker || 'narrator',
    start: line.start,
    end: line.end,
    text: line.text,
    words: Array.isArray(line.words) && line.words.length > 0
      ? line.words
      : buildFallbackWords(line.text, line.start, line.end),
  }));

  function buildFallbackWords(text, start, end) {
    const raw = String(text || '').trim().split(/\s+/).filter(Boolean);
    const words = [];
    for (const tok of raw) {
      if (tok.includes('—') && !tok.endsWith('—')) {
        const parts = tok.split('—');
        parts.forEach((pt, idx) => {
          if (idx < parts.length - 1) words.push(pt + '—');
          else if (pt) words.push(pt);
        });
      } else {
        words.push(tok);
      }
    }
    const dur = Math.max(0.05, end - start);
    const step = dur / Math.max(1, words.length);
    return words.map((w, i) => ({
      word: w,
      start: start + i * step,
      end: start + (i + 1) * step,
    }));
  }

  function getActiveBeat(t) {
    for (let i = 0; i < beats.length; i++) {
      const b = beats[i];
      if (t >= b.start && (t < b.end || i === beats.length - 1)) return b;
    }
    return beats[0] || { id: 'beat_1_overview', chapter: '01 • DEVICE OVERVIEW', start: 0, end: 5 };
  }

  function getActiveSubtitlePage(t) {
    // Active narration line with tiny gentle pre-roll/hold
    for (let i = 0; i < subtitlePages.length; i++) {
      const p = subtitlePages[i];
      if (t >= p.start - 0.12 && t <= p.end + 0.14) {
        return p;
      }
    }
    // Fallback to beat-linked narration line during micro-gaps between beats
    const beat = getActiveBeat(t);
    for (let i = 0; i < subtitlePages.length; i++) {
      if (subtitlePages[i].beatId === beat.id) return subtitlePages[i];
    }
    return subtitlePages[0] || null;
  }

  function resolveTelemetry(t, telemetry = {}) {
    let fallbackBalloon = 0.0;
    if (t >= 15.6 && t < 19.6) {
      fallbackBalloon = 10.0 * smoothstep(15.6, 19.4, t);
    } else if (t >= 19.6 && t < 26.3) {
      fallbackBalloon = 10.0;
    } else if (t >= 26.3 && t < 28.2) {
      fallbackBalloon = 10.0 * (1.0 - smoothstep(26.3, 28.0, t));
    }

    let fallbackBag = 0.0;
    if (t >= 21.0 && t < 26.0) {
      fallbackBag = 250.0 * smoothstep(21.0, 25.8, t);
    } else if (t >= 26.0) {
      fallbackBag = 250.0;
    }

    let fallbackState = 'READY';
    if (t < 5.0) fallbackState = 'OVERVIEW';
    else if (t < 10.2) fallbackState = 'DUAL LUMEN';
    else if (t < 15.2) fallbackState = t < 14.2 ? 'INSERTING' : 'SEATED';
    else if (t < 20.8) fallbackState = t < 18.8 ? 'INFLATING' : 'ANCHORED';
    else if (t < 26.2) fallbackState = 'DRAINING';
    else fallbackState = t < 28.0 ? 'DEFLATING' : 'REMOVED';

    const balloonMl = Number.isFinite(telemetry.balloonMl)
      ? telemetry.balloonMl
      : Number.isFinite(telemetry.balloonVolumeMl)
        ? telemetry.balloonVolumeMl
        : fallbackBalloon;

    const bagMl = Number.isFinite(telemetry.drainageMl)
      ? telemetry.drainageMl
      : Number.isFinite(telemetry.bagMl)
        ? telemetry.bagMl
        : Number.isFinite(telemetry.bagVolumeMl)
          ? telemetry.bagVolumeMl
          : fallbackBag;

    const state = String(telemetry.state || telemetry.status || fallbackState).toUpperCase();

    return {
      balloonMl: clamp(balloonMl, 0, 10.0),
      bagMl: clamp(bagMl, 0, 250.0),
      state,
    };
  }

  // Pre-baked subtle vignette layer (1080x1920)
  let vigCanvas = null;
  if (typeof document !== 'undefined') {
    vigCanvas = document.createElement('canvas');
    vigCanvas.width = width;
    vigCanvas.height = height;
    const vctx = vigCanvas.getContext('2d');
    const vig = vctx.createRadialGradient(
      width * 0.5,
      height * 0.46,
      height * 0.28,
      width * 0.5,
      height * 0.5,
      height * 0.72
    );
    vig.addColorStop(0.0, 'rgba(0, 0, 0, 0)');
    vig.addColorStop(0.74, 'rgba(4, 11, 22, 0.12)');
    vig.addColorStop(1.0, 'rgba(2, 7, 16, 0.42)');
    vctx.fillStyle = vig;
    vctx.fillRect(0, 0, width, height);
  }

  const progGrad = ctx
    ? (() => {
        const g = ctx.createLinearGradient(0, 0, width, 0);
        g.addColorStop(0.0, '#38BDF8');
        g.addColorStop(0.55, '#2DD4BF');
        g.addColorStop(1.0, '#7DD3FC');
        return g;
      })()
    : null;

  function pickAnchor(screenAnchors, candidateKeys) {
    if (!screenAnchors) return null;
    for (const k of candidateKeys) {
      const a = screenAnchors[k];
      if (a && a.visible !== false && Number.isFinite(a.x) && Number.isFinite(a.y)) {
        return a;
      }
    }
    return null;
  }

  function wrapSubtitleLines(c, words, maxWidthPx) {
    const sizes = [36, 34, 32, 30, 28, 26];
    for (const fontSize of sizes) {
      c.font = `700 ${fontSize}px "DejaVu Sans", sans-serif`;
      const spacePx = c.measureText(' ').width * 1.1;
      const lines = [];
      let current = [];
      let currentPx = 0;

      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        const noSpaceBefore = i > 0 && words[i - 1].word.endsWith('—');
        const wPx = c.measureText(w.word).width;
        const addPx = (current.length > 0 && !noSpaceBefore ? spacePx : 0) + wPx;

        if (current.length > 0 && currentPx + addPx > maxWidthPx && !noSpaceBefore) {
          lines.push(current);
          current = [w];
          currentPx = wPx;
        } else {
          current.push({ ...w, noSpaceBefore });
          currentPx += addPx;
        }
      }
      if (current.length > 0) lines.push(current);
      if (lines.length <= 2 || fontSize === sizes[sizes.length - 1]) {
        return { fontSize, lines: lines.slice(0, 2) };
      }
    }
    return { fontSize: 34, lines: [] };
  }

  function drawTopTelemetryHeader(t, beat, tele) {
    const hx = 40;
    const hy = 44;
    const hw = 1000;
    const hh = 166;

    // Top 5px clinical progress bar
    const prog = clamp01(t / duration);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
    ctx.fillRect(0, 0, width, 5);
    ctx.fillStyle = progGrad || '#38BDF8';
    ctx.fillRect(0, 0, width * prog, 5);

    ctx.save();
    // Frosted dark medical slate panel
    drawRoundedRect(ctx, hx, hy, hw, hh, 16);
    const panelGrad = ctx.createLinearGradient(hx, hy, hx, hy + hh);
    panelGrad.addColorStop(0.0, 'rgba(6, 17, 34, 0.88)');
    panelGrad.addColorStop(1.0, 'rgba(9, 24, 46, 0.82)');
    ctx.fillStyle = panelGrad;
    ctx.fill();

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.48)';
    ctx.stroke();

    // Subtle top specular hairline
    ctx.beginPath();
    ctx.moveTo(hx + 20, hy + 1.5);
    ctx.lineTo(hx + hw - 20, hy + 1.5);
    ctx.strokeStyle = 'rgba(186, 230, 253, 0.24)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Row 1: Chapter Index Pill (left) & Category + Timecode (right)
    const chapText = (beat?.chapter || '01 • DEVICE OVERVIEW').toUpperCase();
    ctx.font = '700 20px "DejaVu Sans", sans-serif';
    const chapTextW = ctx.measureText(chapText).width;
    const chapPillW = Math.min(540, chapTextW + 46);
    const chapX = hx + 22;
    const chapY = hy + 16;

    drawRoundedRect(ctx, chapX, chapY, chapPillW, 32, 8);
    ctx.fillStyle = 'rgba(14, 116, 144, 0.34)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.50)';
    ctx.stroke();

    // Pulsing cyan telemetry dot
    const dotPulse = 0.7 + 0.3 * Math.sin(t * 4.5);
    ctx.beginPath();
    ctx.arc(chapX + 16, chapY + 16, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(45, 212, 191, ${dotPulse.toFixed(2)})`;
    ctx.fill();

    ctx.fillStyle = '#7DD3FC';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(chapText, chapX + 30, chapY + 17);

    // Right side category + elapsed timer
    const secStr = `${String(Math.floor(t)).padStart(2, '0')}s / ${Math.round(duration)}s`;
    ctx.font = '600 18px "DejaVu Sans", sans-serif';
    ctx.fillStyle = '#94A3B8';
    ctx.textAlign = 'right';
    ctx.fillText(`${categoryBadge}   |   ${secStr}`, hx + hw - 24, chapY + 17);

    // Row 2: Authoritative Title
    ctx.font = '800 33px "DejaVu Sans", sans-serif';
    ctx.fillStyle = '#F8FAFC';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(titleText, hx + 24, hy + 78);

    // Subtle divider hairline
    ctx.beginPath();
    ctx.moveTo(hx + 22, hy + 106);
    ctx.lineTo(hx + hw - 22, hy + 106);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Row 3: 3 Live Device Telemetry Pills
    const pillY = hy + 118;
    const pillH = 34;
    const innerX = hx + 22;
    const gap = 14;
    const pillW = (hw - 44 - gap * 2) / 3;

    // Pill 1: BALLOON VOLUME
    drawTelemetryPill(ctx, innerX, pillY, pillW, pillH, {
      label: 'BALLOON:',
      value: `${tele.balloonMl.toFixed(1)} mL`,
      progress: tele.balloonMl / 10.0,
      accent: tele.balloonMl > 0.2 ? '#38BDF8' : '#64748B',
    });

    // Pill 2: BAG VOLUME
    drawTelemetryPill(ctx, innerX + pillW + gap, pillY, pillW, pillH, {
      label: 'BAG VOL:',
      value: `${Math.round(tele.bagMl)} mL`,
      progress: tele.bagMl / 250.0,
      accent: tele.bagMl > 1.0 ? '#F59E0B' : '#64748B',
    });

    // Pill 3: VALVE / DEVICE STATE
    const stateAccent =
      tele.state === 'DRAINING' ? '#F59E0B'
        : tele.state === 'ANCHORED' || tele.state === 'SEATED' ? '#2DD4BF'
          : '#38BDF8';
    drawTelemetryPill(ctx, innerX + (pillW + gap) * 2, pillY, pillW, pillH, {
      label: 'STATE:',
      value: tele.state,
      dotColor: stateAccent,
      accent: stateAccent,
    });

    ctx.restore();
  }

  function drawTelemetryPill(c, x, y, w, h, cfg) {
    drawRoundedRect(c, x, y, w, h, 8);
    c.fillStyle = 'rgba(15, 29, 52, 0.85)';
    c.fill();
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    c.stroke();

    if (typeof cfg.progress === 'number') {
      const barW = Math.max(0, (w - 8) * clamp01(cfg.progress));
      if (barW > 1) {
        drawRoundedRect(c, x + 4, y + h - 5, barW, 2.5, 1.2);
        c.fillStyle = cfg.accent;
        c.fill();
      }
    }

    let textStartX = x + 14;
    if (cfg.dotColor) {
      c.beginPath();
      c.arc(x + 16, y + h * 0.5, 4, 0, Math.PI * 2);
      c.fillStyle = cfg.dotColor;
      c.fill();
      textStartX = x + 28;
    }

    c.font = '700 18px "DejaVu Sans", sans-serif';
    c.fillStyle = '#94A3B8';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(cfg.label, textStartX, y + h * 0.5 - 0.5);

    c.font = '800 19px "DejaVu Sans", sans-serif';
    c.fillStyle = '#F8FAFC';
    c.textAlign = 'right';
    c.fillText(cfg.value, x + w - 14, y + h * 0.5 - 0.5);
  }

  function drawVectorCallouts(t, beat, screenAnchors) {
    const defs = CALLOUT_DEFS_BY_BEAT[beat?.id] || [];
    if (defs.length === 0 || !screenAnchors) return;

    const beatElapsed = t - (beat?.start ?? 0);
    const beatRemaining = (beat?.end ?? duration) - t;
    const beatFadeOut = beatRemaining < 0.24 ? clamp01(beatRemaining / 0.24) : 1.0;

    const prepared = [];
    ctx.font = '700 19px "DejaVu Sans", sans-serif';

    for (const def of defs) {
      const anchor = pickAnchor(screenAnchors, def.anchorKeys);
      if (!anchor) continue;
      const ax = anchor.x;
      const ay = anchor.y;
      if (ax < 30 || ax > width - 30 || ay < 230 || ay > 1470) continue;

      const fadeIn = clamp01((beatElapsed - (def.delay || 0)) / 0.28);
      const alpha = fadeIn * beatFadeOut;
      if (alpha <= 0.02) continue;

      const pillW = Math.min(395, ctx.measureText(def.label).width + 48);
      const pillH = 44;

      // Determine smart side to keep center anatomy unobstructed & stay within [44 .. 1036]
      let side = def.side || 'left';
      if (side === 'left' && ax < 44 + pillW + 24) side = 'right';
      if (side === 'right' && ax > width - 44 - pillW - 24) side = 'left';

      let pillX;
      if (side === 'left') {
        pillX = clamp(Math.min(ax - 68 - pillW, 415 - pillW), 44, width - 44 - pillW);
        // Ensure pill doesn't swallow anchor
        if (pillX + pillW > ax - 24) {
          pillX = clamp(ax - 32 - pillW, 44, width - 44 - pillW);
        }
      } else {
        pillX = clamp(Math.max(ax + 68, 665), 44, width - 44 - pillW);
        if (pillX < ax + 24) {
          pillX = clamp(ax + 32, 44, width - 44 - pillW);
        }
      }

      const pillY = clamp(ay + (def.yOffset || 0) - pillH * 0.5, 260, 1430 - pillH);

      prepared.push({
        def,
        ax,
        ay,
        side,
        pillX,
        pillY,
        pillW,
        pillH,
        alpha,
      });
    }

    // Resolve vertical overlaps cleanly per side inside [260 .. 1430 - pillH]
    for (const side of ['left', 'right']) {
      const group = prepared.filter((p) => p.side === side).sort((a, b) => a.pillY - b.pillY);
      const minGap = 58;
      for (let i = 1; i < group.length; i++) {
        if (group[i].pillY - group[i - 1].pillY < minGap) {
          group[i].pillY = Math.min(1430 - group[i].pillH, group[i - 1].pillY + minGap);
        }
      }
      for (let i = group.length - 2; i >= 0; i--) {
        if (group[i + 1].pillY - group[i].pillY < minGap) {
          group[i].pillY = Math.max(260, group[i + 1].pillY - minGap);
        }
      }
    }

    // Render each leader line + precision badge
    for (const item of prepared) {
      const { def, ax, ay, side, pillX, pillY, pillW, pillH, alpha } = item;
      const accent = def.accent || '#38BDF8';
      const badgeEdgeX = side === 'left' ? pillX + pillW : pillX;
      const badgeMidY = pillY + pillH * 0.5;
      const dy = badgeMidY - ay;
      const dxTotal = Math.abs(badgeEdgeX - ax);
      const diagRun = Math.min(dxTotal * 0.45, Math.max(22, Math.abs(dy) * 0.85 + 16));
      const elbowX = side === 'left' ? ax - diagRun : ax + diagRun;

      ctx.save();
      ctx.globalAlpha = alpha;

      // 1. Dark under-stroke halo for crisp separation over translucent tissues
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(elbowX, badgeMidY);
      ctx.lineTo(badgeEdgeX, badgeMidY);
      ctx.lineWidth = 4.5;
      ctx.strokeStyle = 'rgba(4, 11, 22, 0.78)';
      ctx.stroke();

      // 2. Precision 2px cyan/teal leader line
      ctx.lineWidth = 2.0;
      ctx.strokeStyle = accent;
      ctx.stroke();

      // 3. Target anchor pulse ring + bright center dot
      const pulseR = 10 + 3.0 * Math.sin(t * 4.2);
      ctx.beginPath();
      ctx.arc(ax, ay, pulseR, 0, Math.PI * 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = accent;
      ctx.globalAlpha = alpha * 0.48;
      ctx.stroke();

      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(ax, ay, 5.0, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(ax, ay, 2.0, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();

      // 4. Sleek clinical slate badge pill
      drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 8);
      ctx.fillStyle = 'rgba(7, 19, 38, 0.90)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = accent;
      ctx.stroke();

      // Accent dot inside pill (always near text start)
      ctx.beginPath();
      ctx.arc(pillX + 18, badgeMidY, 4.2, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();

      ctx.font = '700 19px "DejaVu Sans", sans-serif';
      ctx.fillStyle = '#F1F5F9';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.label, pillX + 32, badgeMidY + 0.5);

      ctx.restore();
    }
  }

  function drawLowerThirdCaption(t, page) {
    if (!page) return;
    const cx = 56;
    const cy = 1525;
    const cw = 968;
    const ch = 230;

    ctx.save();
    drawRoundedRect(ctx, cx, cy, cw, ch, 14);
    const cardGrad = ctx.createLinearGradient(cx, cy, cx, cy + ch);
    cardGrad.addColorStop(0.0, 'rgba(5, 14, 28, 0.88)');
    cardGrad.addColorStop(1.0, 'rgba(4, 11, 22, 0.92)');
    ctx.fillStyle = cardGrad;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.stroke();

    // Left sleek cyan clinical bar
    drawRoundedRect(ctx, cx + 14, cy + 20, 5, ch - 40, 2.5);
    ctx.fillStyle = '#38BDF8';
    ctx.fill();

    // Header tag: CLINICAL NARRATION
    ctx.font = '700 18px "DejaVu Sans", sans-serif';
    ctx.fillStyle = '#38BDF8';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('CLINICAL NARRATION', cx + 36, cy + 38);

    // Subtle speaking waveform indicator on top-right of card
    const isSpeaking = t >= page.start && t <= page.end;
    for (let b = 0; b < 4; b++) {
      const hFrac = isSpeaking ? 0.35 + 0.65 * Math.abs(Math.sin(t * 8.5 + b * 1.1)) : 0.25;
      const bh = 16 * hFrac;
      ctx.fillStyle = isSpeaking ? 'rgba(56, 189, 248, 0.78)' : 'rgba(148, 163, 184, 0.30)';
      drawRoundedRect(ctx, cx + cw - 54 + b * 8, cy + 38 - bh * 0.5, 4, bh, 2);
      ctx.fill();
    }

    // Wrapped 2-line clinical caption with subtle calm sky-cyan active word highlight
    const { fontSize, lines } = wrapSubtitleLines(ctx, page.words, cw - 76);
    const lineH = fontSize * 1.42;
    const textStartY = lines.length === 1 ? cy + 132 : cy + 106;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (let li = 0; li < lines.length; li++) {
      const lineWords = lines[li];
      const y = textStartY + li * lineH;
      let x = cx + 36;

      ctx.font = `600 ${fontSize}px "DejaVu Sans", sans-serif`;
      const spacePx = ctx.measureText(' ').width * 1.1;

      for (let wi = 0; wi < lineWords.length; wi++) {
        const w = lineWords[wi];
        if (wi > 0 && !w.noSpaceBefore) x += spacePx;

        const isActive = t >= w.start - 0.02 && t <= w.end + 0.04;
        const isSpoken = t > w.end + 0.04;

        ctx.save();
        ctx.font = `${isActive ? 700 : 600} ${fontSize}px "DejaVu Sans", sans-serif`;
        const wp = ctx.measureText(w.word).width;

        ctx.shadowColor = isActive ? 'rgba(56, 189, 248, 0.38)' : 'rgba(2, 6, 14, 0.75)';
        ctx.shadowBlur = isActive ? 8 : 3;
        ctx.shadowOffsetY = isActive ? 0 : 1.5;

        if (isActive) {
          ctx.fillStyle = '#38BDF8';
        } else if (isSpoken) {
          ctx.fillStyle = '#E2E8F0';
        } else {
          ctx.fillStyle = '#FFFFFF';
        }
        ctx.fillText(w.word, x, y);
        ctx.restore();

        x += wp;
      }
    }

    ctx.restore();
  }

  function draw(t, telemetry = {}, screenAnchors = {}) {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    if (vigCanvas) {
      ctx.drawImage(vigCanvas, 0, 0);
    }

    const beat = getActiveBeat(t);
    const tele = resolveTelemetry(t, telemetry);

    drawVectorCallouts(t, beat, screenAnchors);
    drawTopTelemetryHeader(t, beat, tele);
    drawLowerThirdCaption(t, getActiveSubtitlePage(t));
  }

  return {
    canvas,
    draw,
    getActiveBeat,
    getActiveSubtitlePage,
    subtitlePages,
  };
}

export const createHudCompositor = createMedHud;

export function createFrameCompositor(webglCanvas, hudCanvas, width = 1080, height = 1920) {
  const compCanvas = document.createElement('canvas');
  compCanvas.width = width;
  compCanvas.height = height;
  const ctx = compCanvas.getContext('2d', { alpha: false });

  function composite() {
    ctx.drawImage(webglCanvas, 0, 0, width, height);
    if (hudCanvas) {
      ctx.drawImage(hudCanvas, 0, 0, width, height);
    }
    return compCanvas;
  }

  return { canvas: compCanvas, composite };
}
