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

  const rawLines = Array.isArray(manifest?.lines) && manifest.lines.length > 0
    ? manifest.lines
    : (timeline?.dialogue || []).map((d) => ({
        ...d,
        words: buildFallbackWords(d.text, d.start, d.end),
      }));

  const CLAUSE_BREAK_WORDS = new Set([
    'for',
    'until',
    'into',
    'through',
    'without',
    'while',
    'when',
    'because',
    'collapses',
  ]);

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

  function joinWordsCharLen(slice) {
    let s = '';
    for (let i = 0; i < slice.length; i++) {
      const w = slice[i].word || '';
      if (i > 0 && !(slice[i - 1].word || '').endsWith('—')) s += ' ';
      s += w;
    }
    return s.length;
  }

  function splitLineIntoCards(line) {
    const words = Array.isArray(line.words) && line.words.length > 0
      ? line.words
      : buildFallbackWords(line.text, line.start, line.end);

    if (words.length <= 7 && joinWordsCharLen(words) <= 44) {
      return [
        {
          id: `${line.id}_0`,
          beatId: line.beatId,
          start: words[0]?.start ?? line.start,
          end: words[words.length - 1]?.end ?? line.end,
          words,
        },
      ];
    }

    const cards = [];
    let idx = 0;
    while (idx < words.length) {
      const remaining = words.length - idx;
      if (remaining <= 7 && joinWordsCharLen(words.slice(idx)) <= 44) {
        cards.push(words.slice(idx));
        break;
      }

      let bestSplit = Math.min(words.length, idx + 5);
      let bestScore = -1e9;
      const minK = Math.min(words.length, idx + 2);
      const maxK = Math.min(words.length, idx + 7);

      for (let k = minK; k <= maxK; k++) {
        const chunk = words.slice(idx, k);
        const charLen = joinWordsCharLen(chunk);
        const remCount = words.length - k;

        if (charLen > 45 && k > idx + 2) continue;
        if ((words[k - 1]?.word || '').endsWith('—')) continue;
        // Avoid tiny 1-word orphan tail unless unavoidable
        if (remCount === 1) continue;

        let score = 0;
        const prevWord = (words[k - 1]?.word || '');
        const nextWordLower = (words[k]?.word || '').toLowerCase().replace(/[^a-z]/g, '');

        if (/[,.;:!?]$/.test(prevWord)) score += 60;
        if (CLAUSE_BREAK_WORDS.has(nextWordLower)) score += 45;
        if (k - idx >= 4 && k - idx <= 6) score += 16;
        if (remCount >= 3 && remCount <= 7 && joinWordsCharLen(words.slice(k)) <= 44) {
          score += 24;
        }
        // Favor ~28..38 chars per card
        score -= Math.abs(charLen - 33) * 0.7;

        if (score > bestScore) {
          bestScore = score;
          bestSplit = k;
        }
      }

      cards.push(words.slice(idx, bestSplit));
      idx = bestSplit;
    }

    return cards.map((chunk, cIdx) => ({
      id: `${line.id}_${cIdx}`,
      beatId: line.beatId,
      start: chunk[0]?.start ?? line.start,
      end: chunk[chunk.length - 1]?.end ?? line.end,
      words: chunk,
    }));
  }

  const subtitlePages = rawLines.flatMap((line) => splitLineIntoCards(line));

  function getActiveBeat(t) {
    for (let i = 0; i < beats.length; i++) {
      const b = beats[i];
      if (t >= b.start && (t < b.end || i === beats.length - 1)) return b;
    }
    return beats[0] || { id: 'beat_1_overview', chapter: '01 • DEVICE OVERVIEW', start: 0, end: 5 };
  }

  function getActiveSubtitlePage(t) {
    for (let i = 0; i < subtitlePages.length; i++) {
      const p = subtitlePages[i];
      const nextStart = i + 1 < subtitlePages.length ? subtitlePages[i + 1].start : duration + 1.0;
      const winStart = p.start - 0.06;
      const winEnd = Math.min(nextStart - 0.04, p.end + 0.24);
      if (t >= winStart && t <= winEnd) {
        return p;
      }
    }
    return null;
  }

  // Pre-baked subtle cinematic vignette layer (1080x1920)
  let vigCanvas = null;
  let subCanvas = null;
  let subCtx = null;
  const SUB_CANVAS_H = 260;
  const SUB_CANVAS_TOP = 1520;
  if (typeof document !== 'undefined') {
    vigCanvas = document.createElement('canvas');
    vigCanvas.width = width;
    vigCanvas.height = height;
    const vctx = vigCanvas.getContext('2d');
    const vig = vctx.createRadialGradient(
      width * 0.5,
      height * 0.45,
      height * 0.30,
      width * 0.5,
      height * 0.5,
      height * 0.74
    );
    vig.addColorStop(0.0, 'rgba(0, 0, 0, 0)');
    vig.addColorStop(0.74, 'rgba(4, 11, 22, 0.10)');
    vig.addColorStop(1.0, 'rgba(2, 7, 16, 0.38)');
    vctx.fillStyle = vig;
    vctx.fillRect(0, 0, width, height);

    // Offscreen subtitle scratch buffer prevents stroke/fill alpha-bleed during fades
    subCanvas = document.createElement('canvas');
    subCanvas.width = width;
    subCanvas.height = SUB_CANVAS_H;
    subCtx = subCanvas.getContext('2d', { alpha: true });
  }

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

  function measureSlicePx(c, slice, spacePx) {
    let w = 0;
    for (let i = 0; i < slice.length; i++) {
      if (i > 0 && !(slice[i - 1].word || '').endsWith('—')) w += spacePx;
      w += c.measureText(slice[i].word).width;
    }
    return w;
  }

  function annotateNoSpace(slice) {
    return slice.map((w, i) => ({
      ...w,
      noSpaceBefore: i > 0 && (slice[i - 1].word || '').endsWith('—'),
    }));
  }

  function wrapSubtitleLines(c, words, maxWidthPx) {
    const sizes = [42, 40, 38, 36];
    for (const fontSize of sizes) {
      c.font = `800 ${fontSize}px "DejaVu Sans", sans-serif`;
      const spacePx = c.measureText(' ').width * 1.08;
      const singlePx = measureSlicePx(c, words, spacePx);
      if (singlePx <= maxWidthPx) {
        return { fontSize, lines: [annotateNoSpace(words)] };
      }

      // Balanced 2-line split avoiding 1-word tails
      let bestK = -1;
      let bestCost = 1e9;
      for (let k = 1; k < words.length; k++) {
        if ((words[k - 1].word || '').endsWith('—')) continue;
        const left = words.slice(0, k);
        const right = words.slice(k);
        if (words.length >= 4 && (left.length < 2 || right.length < 2)) continue;

        const w1 = measureSlicePx(c, left, spacePx);
        const w2 = measureSlicePx(c, right, spacePx);
        if (w1 > maxWidthPx || w2 > maxWidthPx) continue;

        let cost = Math.abs(w1 - w2);
        const lastLeftLower = (left[left.length - 1].word || '').toLowerCase();
        const firstRightLower = (right[0].word || '').toLowerCase().replace(/[^a-z]/g, '');
        if (/^(a|an|the|is|are|of|in|at|to|for)$/.test(lastLeftLower)) cost += 90;
        if (CLAUSE_BREAK_WORDS.has(firstRightLower) || /[,.;:!?]$/.test(left[left.length - 1].word || '')) {
          cost -= 110;
        }
        if (cost < bestCost) {
          bestCost = cost;
          bestK = k;
        }
      }

      if (bestK > 0) {
        return {
          fontSize,
          lines: [
            annotateNoSpace(words.slice(0, bestK)),
            annotateNoSpace(words.slice(bestK)),
          ],
        };
      }
    }

    // Fallback last-resort balanced midpoint at 36px
    c.font = '800 36px "DejaVu Sans", sans-serif';
    const mid = Math.max(1, Math.ceil(words.length / 2));
    return {
      fontSize: 36,
      lines: [annotateNoSpace(words.slice(0, mid)), annotateNoSpace(words.slice(mid))].filter((l) => l.length > 0),
    };
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
      if (ax < 30 || ax > width - 30 || ay < 70 || ay > 1495) continue;

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
        if (pillX + pillW > ax - 24) {
          pillX = clamp(ax - 32 - pillW, 44, width - 44 - pillW);
        }
      } else {
        pillX = clamp(Math.max(ax + 68, 665), 44, width - 44 - pillW);
        if (pillX < ax + 24) {
          pillX = clamp(ax + 32, 44, width - 44 - pillW);
        }
      }

      const pillY = clamp(ay + (def.yOffset || 0) - pillH * 0.5, 95, 1455 - pillH);

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

    // Resolve vertical overlaps cleanly per side inside [95 .. 1455 - pillH]
    for (const side of ['left', 'right']) {
      const group = prepared.filter((p) => p.side === side).sort((a, b) => a.pillY - b.pillY);
      const minGap = 58;
      for (let i = 1; i < group.length; i++) {
        if (group[i].pillY - group[i - 1].pillY < minGap) {
          group[i].pillY = Math.min(1455 - group[i].pillH, group[i - 1].pillY + minGap);
        }
      }
      for (let i = group.length - 2; i >= 0; i--) {
        if (group[i + 1].pillY - group[i].pillY < minGap) {
          group[i].pillY = Math.max(95, group[i + 1].pillY - minGap);
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

      // Accent dot inside pill
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

  function drawYoutubeSubtitles(t, page) {
    if (!page || !page.words || page.words.length === 0) return;

    const fadeIn = clamp01((t - (page.start - 0.06)) / 0.08);
    const fadeOut = t > page.end + 0.06 ? clamp01(1.0 - (t - (page.end + 0.06)) / 0.12) : 1.0;
    const alpha = fadeIn * fadeOut;
    if (alpha <= 0.02) return;

    const targetCtx = subCtx || ctx;
    const localOffsetY = subCtx ? SUB_CANVAS_TOP : 0;
    if (subCtx) {
      subCtx.clearRect(0, 0, width, SUB_CANVAS_H);
    }

    const { fontSize, lines } = wrapSubtitleLines(targetCtx, page.words, 900);
    if (lines.length === 0) return;

    const lineH = fontSize * 1.32;
    const centerAnchorY = 1650 - localOffsetY;
    const startY = lines.length === 1 ? centerAnchorY : centerAnchorY - lineH * 0.45;

    targetCtx.save();
    targetCtx.globalAlpha = subCtx ? 1.0 : alpha;
    targetCtx.font = `800 ${fontSize}px "DejaVu Sans", sans-serif`;
    const spacePx = targetCtx.measureText(' ').width * 1.08;
    targetCtx.textAlign = 'left';
    targetCtx.textBaseline = 'middle';
    targetCtx.lineJoin = 'round';
    targetCtx.miterLimit = 2;

    for (let li = 0; li < lines.length; li++) {
      const lineWords = lines[li];
      const y = startY + li * lineH;

      // Measure total line pixel width for dead-center alignment
      let totalLineW = 0;
      const wordWidths = [];
      for (let wi = 0; wi < lineWords.length; wi++) {
        const wp = targetCtx.measureText(lineWords[wi].word).width;
        wordWidths.push(wp);
        if (wi > 0 && !lineWords[wi].noSpaceBefore) totalLineW += spacePx;
        totalLineW += wp;
      }

      let x = (width - totalLineW) * 0.5;

      // Pass 1: Crisp dark outline + subtle soft drop shadow (zero box container)
      for (let wi = 0; wi < lineWords.length; wi++) {
        const w = lineWords[wi];
        if (wi > 0 && !w.noSpaceBefore) x += spacePx;

        targetCtx.save();
        targetCtx.shadowColor = 'rgba(2, 6, 16, 0.90)';
        targetCtx.shadowBlur = 14;
        targetCtx.shadowOffsetY = 3;
        targetCtx.lineWidth = 10;
        targetCtx.strokeStyle = 'rgba(3, 8, 18, 0.98)';
        targetCtx.strokeText(w.word, x, y);
        targetCtx.restore();

        x += wordWidths[wi];
      }

      // Pass 2: Crisp YouTube white fill with subtle sky-cyan emphasis on active spoken word
      x = (width - totalLineW) * 0.5;
      for (let wi = 0; wi < lineWords.length; wi++) {
        const w = lineWords[wi];
        if (wi > 0 && !w.noSpaceBefore) x += spacePx;

        const isActive = t >= w.start - 0.03 && t <= w.end + 0.04;
        targetCtx.save();
        if (isActive) {
          targetCtx.shadowColor = 'rgba(56, 189, 248, 0.50)';
          targetCtx.shadowBlur = 10;
          targetCtx.fillStyle = '#38BDF8';
        } else {
          targetCtx.fillStyle = '#FFFFFF';
        }
        targetCtx.fillText(w.word, x, y);
        targetCtx.restore();

        x += wordWidths[wi];
      }
    }

    targetCtx.restore();

    if (subCanvas) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(subCanvas, 0, SUB_CANVAS_TOP);
      ctx.restore();
    }
  }

  function draw(t, _telemetry = {}, screenAnchors = {}) {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    if (vigCanvas) {
      ctx.drawImage(vigCanvas, 0, 0);
    }

    const beat = getActiveBeat(t);
    drawVectorCallouts(t, beat, screenAnchors);
    drawYoutubeSubtitles(t, getActiveSubtitlePage(t));
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
