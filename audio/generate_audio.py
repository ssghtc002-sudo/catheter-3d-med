"""
Medical Documentary Audio & Clinical Foley Generator
(/home/antigravity/catheter-3d-med/audio/generate_audio.py)

Synthesizes:
  1. Authoritative clinical narration via Kokoro ONNX (`bm_george`, en-gb)
     using shared `audio/dspCore.py`.
  2. Calm clinical medical education ambient underscore:
     - Airy sterile room warmth & sub foundation
     - Soft warm stereo filtered felt chords (Cmaj9 / Fmaj7 / Em7 / Am9 / G6)
     - Delicate glass-piano / felt marimba harmonic motif at 72 BPM
     - Subtle 72 BPM clinical heartbeat / precision telemetry pulse
  3. 12 tactile clinical Foley SFX events synced to `config/timeline.json`.
  4. Mastered 44.1 kHz stereo WAV (`-14 LUFS` feel, peak <= -1.0 dBFS),
     `voice_manifest.json` (with 30fps lipSync + word alignment), and `output/subtitles.srt`.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
from scipy import signal

try:
    from audio.dspCore import (
        CHANNELS,
        DURATION,
        SR,
        TOTAL_SAMPLES,
        add_stereo_event,
        adsr_env,
        butter_filter,
        master_and_export,
        midi_to_hz,
        pan_stereo,
        synthesize_dialogue,
    )
except ImportError:
    from dspCore import (
        CHANNELS,
        DURATION,
        SR,
        TOTAL_SAMPLES,
        add_stereo_event,
        adsr_env,
        butter_filter,
        master_and_export,
        midi_to_hz,
        pan_stereo,
        synthesize_dialogue,
    )

PROJECT_ROOT = Path(__file__).resolve().parent.parent
TIMELINE_PATH = PROJECT_ROOT / "config" / "timeline.json"


def load_timeline(path: Path = TIMELINE_PATH) -> dict[str, Any]:
    """Load timeline contract JSON from disk."""
    return json.loads(path.read_text(encoding="utf-8"))


def synth_felt_pad_chord(
    midis: list[int],
    dur: float,
    gain: float = 0.085,
    attack: float = 0.70,
    release: float = 0.90,
) -> np.ndarray:
    """Warm stereo low-passed felt harmonic pad chord with subtle L/R chorus."""
    n = int(round(dur * SR))
    if n <= 0:
        return np.zeros((0, CHANNELS), dtype=np.float32)
    t = np.linspace(0.0, dur, n, endpoint=False, dtype=np.float32)

    left = np.zeros(n, dtype=np.float32)
    right = np.zeros(n, dtype=np.float32)

    for idx, m in enumerate(midis):
        f = midi_to_hz(m)
        # Subtle symmetrical detune for warm stereo width without phase smear
        det = 0.0014 * (1.0 + 0.15 * idx)
        fl = f * (1.0 - det)
        fr = f * (1.0 + det)

        # Warm soft triangle-sine blend (very mild 2nd & 3rd harmonics)
        wl = (
            0.78 * np.sin(2.0 * math.pi * fl * t)
            + 0.18 * np.sin(2.0 * math.pi * (fl * 2.0) * t)
            + 0.04 * np.sin(2.0 * math.pi * (fl * 3.0) * t)
        )
        wr = (
            0.78 * np.sin(2.0 * math.pi * fr * t)
            + 0.18 * np.sin(2.0 * math.pi * (fr * 2.0) * t)
            + 0.04 * np.sin(2.0 * math.pi * (fr * 3.0) * t)
        )
        # Weight lower/middle chord voices slightly warmer than top extensions
        weight = 1.0 / (1.0 + 0.14 * idx)
        left += wl * weight
        right += wr * weight

    norm = max(1.0, len(midis) * 0.72)
    stereo = np.stack([left / norm, right / norm], axis=-1).astype(np.float32)

    # Felt low-pass warmth
    stereo = butter_filter(stereo, "low", 920.0, order=2)

    # Gentle slow breathing swell
    breath = 0.90 + 0.10 * np.sin(2.0 * math.pi * 0.16 * t)
    env = adsr_env(n, attack=attack, decay=0.20, sustain=0.88, release=release)
    return (stereo * (env * breath)[:, None] * gain).astype(np.float32)


def synth_glass_felt_note(freq: float, dur: float = 0.85, gain: float = 0.09) -> np.ndarray:
    """Delicate clinical glass-piano / felt marimba pluck with clean soft transient."""
    n = int(round(dur * SR))
    if n <= 0:
        return np.zeros(0, dtype=np.float32)
    t = np.linspace(0.0, dur, n, endpoint=False, dtype=np.float32)

    # Pure fundamental + warm 2nd harmonic + very delicate glassy 3rd/4th shimmer
    body = (
        0.68 * np.sin(2.0 * math.pi * freq * t) * np.exp(-t * 3.8)
        + 0.24 * np.sin(2.0 * math.pi * (freq * 2.0) * t) * np.exp(-t * 6.4)
        + 0.06 * np.sin(2.0 * math.pi * (freq * 3.0) * t) * np.exp(-t * 11.0)
        + 0.02 * np.sin(2.0 * math.pi * (freq * 4.0) * t) * np.exp(-t * 16.0)
    )
    # Soft felt hammer thump (400 Hz low-passed impulse)
    felt = (
        butter_filter(np.random.randn(n).astype(np.float32), "low", 480.0, order=2)
        * np.exp(-t * 85.0)
        * 0.14
    )
    attack = np.clip(t / 0.005, 0.0, 1.0)
    tail_fade = np.linspace(1.0, 0.0, min(n, int(0.04 * SR)), dtype=np.float32)
    sig = (body + felt) * attack * gain
    sig[-len(tail_fade):] *= tail_fade
    return sig.astype(np.float32)


def synth_clinical_pulse(accent: bool = False, gain: float = 0.045) -> np.ndarray:
    """Subtle 72 BPM muted clinical heartbeat / soft clock precision pulse."""
    dur = 0.14
    n = int(round(dur * SR))
    t = np.linspace(0.0, dur, n, endpoint=False, dtype=np.float32)

    # Muted warm sub-thump (heartbeat / soft wood-felt pulse)
    f0 = 78.0 if accent else 66.0
    freq_curve = f0 * (0.68 ** np.clip(t / 0.06, 0.0, 1.0))
    phase = 2.0 * math.pi * np.cumsum(freq_curve) / SR
    thump = np.sin(phase) * np.exp(-t * 28.0) * (1.0 if accent else 0.72)

    # Tiny crystalline clock tick on accented downbeats only
    tick = np.zeros(n, dtype=np.float32)
    if accent:
        tick = np.sin(2.0 * math.pi * 1760.0 * t) * np.exp(-t * 95.0) * 0.14

    env = np.clip(t / 0.003, 0.0, 1.0)
    return ((thump + tick) * env * gain).astype(np.float32)


def generate_bgm() -> np.ndarray:
    """Generate 30.0s calm clinical medical education ambient underscore."""
    rng = np.random.default_rng(202611)
    np.random.seed(202611)

    bgm = np.zeros((TOTAL_SAMPLES, CHANNELS), dtype=np.float32)
    t_all = np.linspace(0.0, DURATION, TOTAL_SAMPLES, endpoint=False, dtype=np.float32)

    # 1. Airy Sterile Room Warmth (subtle filtered room tone so silence feels clinical & organic)
    air_l = butter_filter(rng.standard_normal(TOTAL_SAMPLES).astype(np.float32), "band", (210.0, 1050.0), order=2)
    air_r = butter_filter(rng.standard_normal(TOTAL_SAMPLES).astype(np.float32), "band", (225.0, 1100.0), order=2)
    air_mod = 0.85 + 0.15 * np.sin(2.0 * math.pi * 0.11 * t_all)
    bgm[:, 0] += air_l * air_mod * 0.022
    bgm[:, 1] += air_r * air_mod * 0.022

    # 2. Warm Stereo Filtered Felt Chord Progression (C Lydian / Cmaj9 -> Fmaj7 -> Em7/Am9 -> G6 -> Cmaj9)
    # Aligned smoothly to the 6 clinical beats with overlapping crossfades
    chord_schedule = [
        # (start, dur, midi_notes, bass_midi, gain)
        (0.00, 5.65, [48, 55, 59, 62, 64], 36, 0.185),       # Beat 1: Cmaj9
        (4.85, 5.95, [53, 60, 64, 67, 69], 41, 0.190),       # Beat 2: Fmaj7(9)
        (10.05, 3.20, [52, 59, 62, 67], 40, 0.178),          # Beat 3a: Em7
        (12.55, 3.30, [45, 52, 55, 59, 60], 45, 0.182),      # Beat 3b: Am9
        (15.05, 3.35, [53, 60, 64, 67, 71], 41, 0.190),      # Beat 4a: Fmaj7(#11) (C Lydian color)
        (17.75, 3.65, [43, 50, 55, 59, 64], 43, 0.190),      # Beat 4b: G6
        (20.65, 3.55, [48, 55, 59, 62, 64], 36, 0.185),      # Beat 5a: Cmaj9
        (23.50, 3.35, [53, 60, 64, 69], 41, 0.185),          # Beat 5b: Fmaj7
        (26.05, 2.30, [43, 50, 55, 60, 64], 43, 0.178),      # Beat 6a: G6sus4
        (27.60, 2.40, [48, 55, 59, 62, 64, 67], 36, 0.195),  # Beat 6b: Cmaj9 resolution
    ]

    for st, dur, midis, bass_midi, gain in chord_schedule:
        pad = synth_felt_pad_chord(midis, dur, gain=gain, attack=0.68, release=0.88)
        add_stereo_event(bgm, pad, st)

        # Warm smooth sub-bass sine anchor under each chord
        bn = int(round(dur * SR))
        bt = np.linspace(0.0, dur, bn, endpoint=False, dtype=np.float32)
        bf = midi_to_hz(bass_midi)
        bass = np.sin(2.0 * math.pi * bf * bt) * adsr_env(bn, attack=0.45, decay=0.25, sustain=0.80, release=0.80) * 0.088
        add_stereo_event(bgm, pan_stereo(bass, 0.0), st)

    # 3. Delicate Glass-Piano / Felt Marimba Motif at 72 BPM (quarter = 0.8333s, eighth = 0.4167s)
    # 72 BPM divides 30.0s into exactly 36 beats (or 72 eighth-note steps)
    eighth_dur = 60.0 / 72.0 / 2.0  # 0.416667 s
    motif_sections = [
        # (end_time, scale_notes, pattern_indices, pan_spread, gain)
        (5.00, [64, 67, 71, 74, 76], [0, 1, 2, 4, 3, 1], 0.22, 0.155),       # Cmaj9
        (10.20, [64, 67, 69, 72, 76], [0, 2, 1, 3, 4, 2], 0.24, 0.155),      # Fmaj7(9)
        (12.70, [62, 67, 71, 74, 76], [0, 1, 2, 3, 2, 1], 0.22, 0.145),      # Em7
        (15.20, [64, 67, 71, 72, 76], [0, 2, 3, 4, 2, 1], 0.22, 0.150),      # Am9
        (18.00, [64, 67, 71, 74, 76], [0, 1, 2, 3, 4, 2], 0.25, 0.155),      # Fmaj7(#11) Lydian glow
        (20.80, [62, 67, 71, 74, 76], [1, 2, 3, 4, 3, 1], 0.24, 0.160),      # G6
        (23.70, [64, 67, 71, 74, 76], [0, 1, 2, 4, 3, 2], 0.22, 0.155),      # Cmaj9
        (26.20, [64, 69, 72, 76, 79], [0, 1, 2, 3, 2, 1], 0.24, 0.155),      # Fmaj7
        (27.80, [62, 67, 72, 74, 76], [0, 1, 2, 3, 2, 1], 0.20, 0.150),      # G6sus4
        (30.00, [64, 67, 71, 74, 79], [0, 1, 2, 3, 4, 4], 0.18, 0.165),      # Cmaj9 outro
    ]

    step_idx = 0
    cur = 0.0
    while cur < DURATION - 0.50:
        # Leave gentle breathing spaces every 6th eighth note for documentary poise
        if step_idx % 6 != 5:
            sec = next((s for s in motif_sections if cur < s[0]), motif_sections[-1])
            _, notes, pat, pan_amt, base_g = sec
            note_midi = notes[pat[step_idx % len(pat)]]
            freq = midi_to_hz(note_midi)
            # Subtle dynamic humanization
            vel = 1.0 if (step_idx % 2 == 0) else 0.78
            pan = -pan_amt if (step_idx % 2 == 0) else pan_amt
            note_wav = synth_glass_felt_note(freq, dur=0.95, gain=base_g * vel)
            add_stereo_event(bgm, pan_stereo(note_wav, pan), cur)
        step_idx += 1
        cur = step_idx * eighth_dur

    # 4. Subtle 72 BPM Clinical Heartbeat / Precision Pulse (quarter-note grid = 0.833333 s)
    quarter_dur = 60.0 / 72.0  # 0.833333 s
    beat_idx = 0
    bt_pos = 0.0
    while bt_pos < DURATION - 0.65:
        is_down = (beat_idx % 2 == 0)
        pulse = synth_clinical_pulse(accent=is_down, gain=0.095 if is_down else 0.068)
        add_stereo_event(bgm, pan_stereo(pulse, -0.05 if is_down else 0.05), bt_pos)
        beat_idx += 1
        bt_pos = beat_idx * quarter_dur

    # Clean fade-in (0.25s) and smooth tail fade-out (0.85s)
    fade_in = int(0.25 * SR)
    fade_out = int(0.85 * SR)
    bgm[:fade_in] *= np.linspace(0.0, 1.0, fade_in, dtype=np.float32)[:, None]
    bgm[-fade_out:] *= np.linspace(1.0, 0.0, fade_out, dtype=np.float32)[:, None]
    return bgm


def _bandpass_swept_noise(
    dur: float,
    f_start: float,
    f_end: float,
    bw_ratio: float = 0.45,
    seed: int = 101,
) -> np.ndarray:
    """Generate smooth swept bandpass air/fluid noise using short overlapping STFT-free chunks."""
    rng = np.random.default_rng(seed)
    n = int(round(dur * SR))
    if n <= 0:
        return np.zeros(0, dtype=np.float32)

    noise = rng.standard_normal(n).astype(np.float32)
    # Split into 24 overlapping Hann-blended segments for smooth frequency sweep
    num_segs = 24
    seg_hop = max(64, n // num_segs)
    win_len = min(n, seg_hop * 2)
    hann = np.hanning(win_len).astype(np.float32)
    out = np.zeros(n, dtype=np.float32)
    norm = np.zeros(n, dtype=np.float32)

    pos = 0
    while pos < n:
        frac = min(1.0, pos / max(1, n - 1))
        fc = f_start + (f_end - f_start) * frac
        lo = max(60.0, fc * (1.0 - bw_ratio * 0.5))
        hi = min(SR * 0.42, fc * (1.0 + bw_ratio * 0.8))
        if hi <= lo + 20.0:
            hi = lo + 40.0
        end = min(n, pos + win_len)
        seg_n = end - pos
        if seg_n >= 16:
            filt = butter_filter(noise[pos:end], "band", (lo, hi), order=2)
            w = hann[:seg_n]
            out[pos:end] += filt * w
            norm[pos:end] += w
        pos += seg_hop

    mask = norm > 1e-4
    out[mask] /= norm[mask]
    return out.astype(np.float32)


def synth_sfx(sfx_type: str) -> np.ndarray:
    """Synthesize subtle tactile clinical Foley SFX matching timeline.json sfxEvents."""
    if sfx_type == "sterile_chime":
        dur = 0.95
        n = int(round(dur * SR))
        t = np.linspace(0.0, dur, n, endpoint=False, dtype=np.float32)
        out = np.zeros(n, dtype=np.float32)
        # Clean crystalline bell harmonics (C5, G5, D6, E6)
        tones = [(0.00, 523.25, 0.34, 4.2), (0.04, 783.99, 0.28, 4.8), (0.08, 1174.66, 0.20, 5.5), (0.12, 1318.51, 0.14, 6.2)]
        for delay_s, fr, amp, dec in tones:
            d = int(round(delay_s * SR))
            if d < n:
                tt = t[: n - d]
                tri = (2.0 / math.pi) * np.arcsin(np.sin(2.0 * math.pi * fr * tt))
                bell = 0.78 * np.sin(2.0 * math.pi * fr * tt) + 0.22 * tri
                att = np.clip(tt / 0.006, 0.0, 1.0)
                out[d:] += bell * np.exp(-tt * dec) * att * amp
        fade = min(n, int(0.04 * SR))
        out[-fade:] *= np.linspace(1.0, 0.0, fade, dtype=np.float32)
        return out.astype(np.float32)

    if sfx_type == "seat_chime":
        dur = 0.80
        n = int(round(dur * SR))
        t = np.linspace(0.0, dur, n, endpoint=False, dtype=np.float32)
        # Warm crystalline confirmation dyad (G5 + B5 + soft octave G6) + soft seated cushion thud
        bell = (
            0.40 * np.sin(2.0 * math.pi * 783.99 * t) * np.exp(-t * 5.0)
            + 0.30 * np.sin(2.0 * math.pi * 987.77 * t) * np.exp(-t * 5.6)
            + 0.14 * np.sin(2.0 * math.pi * 1567.98 * t) * np.exp(-t * 7.8)
        )
        cushion = np.sin(2.0 * math.pi * 115.0 * t) * np.exp(-t * 42.0) * 0.22
        env = np.clip(t / 0.005, 0.0, 1.0)
        out = (bell + cushion) * env
        fade = min(n, int(0.04 * SR))
        out[-fade:] *= np.linspace(1.0, 0.0, fade, dtype=np.float32)
        return out.astype(np.float32)

    if sfx_type == "outro_chime":
        dur = 1.15
        n = int(round(dur * SR))
        t = np.linspace(0.0, dur, n, endpoint=False, dtype=np.float32)
        out = np.zeros(n, dtype=np.float32)
        # Clean resolving Cmaj9 chime
        tones = [
            (0.00, 523.25, 0.28, 3.2),
            (0.05, 659.25, 0.24, 3.4),
            (0.10, 783.99, 0.22, 3.6),
            (0.15, 987.77, 0.18, 4.0),
            (0.20, 1174.66, 0.16, 4.4),
        ]
        for delay_s, fr, amp, dec in tones:
            d = int(round(delay_s * SR))
            if d < n:
                tt = t[: n - d]
                tri = (2.0 / math.pi) * np.arcsin(np.sin(2.0 * math.pi * fr * tt))
                tone = 0.80 * np.sin(2.0 * math.pi * fr * tt) + 0.20 * tri
                att = np.clip(tt / 0.006, 0.0, 1.0)
                out[d:] += tone * np.exp(-tt * dec) * att * amp
        fade = min(n, int(0.08 * SR))
        out[-fade:] *= np.linspace(1.0, 0.0, fade, dtype=np.float32)
        return out.astype(np.float32)

    if sfx_type == "section_slice":
        dur = 0.52
        n = int(round(dur * SR))
        t = np.linspace(0.0, dur, n, endpoint=False, dtype=np.float32)
        air = _bandpass_swept_noise(dur, 420.0, 2600.0, bw_ratio=0.50, seed=505)
        env = (np.sin(math.pi * t / dur) ** 1.35) * np.exp(-t * 1.4)
        shimmer = np.sin(2.0 * math.pi * np.cumsum(940.0 + 520.0 * (t / dur)) / SR) * np.exp(-t * 11.0) * 0.22
        return (air * env * 0.90 + shimmer * np.clip(t / 0.01, 0.0, 1.0)).astype(np.float32)

    if sfx_type == "soft_glide":
        dur = 0.92
        n = int(round(dur * SR))
        t = np.linspace(0.0, dur, n, endpoint=False, dtype=np.float32)
        glide_air = _bandpass_swept_noise(dur, 260.0, 720.0, bw_ratio=0.65, seed=1030)
        lubricated = _bandpass_swept_noise(dur, 1100.0, 1850.0, bw_ratio=0.40, seed=1031)
        env = np.sin(math.pi * t / dur) ** 1.45
        silicone_hum = np.sin(2.0 * math.pi * np.cumsum(165.0 + 60.0 * np.sin(math.pi * t / dur)) / SR) * env * 0.12
        return ((glide_air * 0.88 + lubricated * 0.28) * env + silicone_hum).astype(np.float32)

    if sfx_type == "pulse_scan":
        dur = 0.56
        n = int(round(dur * SR))
        t = np.linspace(0.0, dur, n, endpoint=False, dtype=np.float32)
        out = np.zeros(n, dtype=np.float32)
        # Subtle dual-tone medical telemetry ping (A5 -> E6)
        pings = [(0.00, 880.0, 0.44, 11.5), (0.10, 1318.51, 0.38, 9.5)]
        for delay_s, fr, amp, dec in pings:
            d = int(round(delay_s * SR))
            tt = t[: n - d]
            ping = (0.85 * np.sin(2.0 * math.pi * fr * tt) + 0.15 * np.sin(2.0 * math.pi * (fr * 2.0) * tt))
            att = np.clip(tt / 0.004, 0.0, 1.0)
            out[d:] += ping * np.exp(-tt * dec) * att * amp
        return out.astype(np.float32)

    if sfx_type == "valve_click":
        dur = 0.16
        n = int(round(dur * SR))
        t = np.linspace(0.0, dur, n, endpoint=False, dtype=np.float32)
        rng = np.random.default_rng(1535)
        out = np.zeros(n, dtype=np.float32)
        for delay_s, f_body, amp in [(0.00, 660.0, 0.58), (0.028, 1380.0, 0.68)]:
            d = int(round(delay_s * SR))
            m = n - d
            tt = t[:m]
            imp = butter_filter(rng.standard_normal(m).astype(np.float32), "band", (1700.0, 5200.0), order=2)
            click = imp * np.exp(-tt * 145.0) * 0.85
            poly = np.sin(2.0 * math.pi * f_body * tt) * np.exp(-tt * 72.0) * 0.45
            out[d:] += (click + poly) * amp
        return np.tanh(out * 1.15).astype(np.float32) * 0.85

    if sfx_type == "valve_lock":
        dur = 0.22
        n = int(round(dur * SR))
        t = np.linspace(0.0, dur, n, endpoint=False, dtype=np.float32)
        rng = np.random.default_rng(1940)
        out = np.zeros(n, dtype=np.float32)
        for delay_s, f_body, amp in [(0.00, 740.0, 0.56), (0.045, 1620.0, 0.72)]:
            d = int(round(delay_s * SR))
            m = n - d
            tt = t[:m]
            imp = butter_filter(rng.standard_normal(m).astype(np.float32), "band", (1900.0, 5800.0), order=2)
            click = imp * np.exp(-tt * 135.0) * 0.82
            latch = (0.65 * np.sin(2.0 * math.pi * f_body * tt) + 0.35 * np.sin(2.0 * math.pi * (f_body * 1.42) * tt)) * np.exp(-tt * 52.0) * 0.45
            out[d:] += (click + latch) * amp
        thump = np.sin(2.0 * math.pi * 155.0 * t) * np.exp(-t * 48.0) * 0.26
        return np.tanh((out + thump) * 1.1).astype(np.float32) * 0.85

    if sfx_type == "valve_release":
        dur = 0.72
        n = int(round(dur * SR))
        t = np.linspace(0.0, dur, n, endpoint=False, dtype=np.float32)
        rng = np.random.default_rng(2625)
        imp = butter_filter(rng.standard_normal(n).astype(np.float32), "band", (1600.0, 4800.0), order=2)
        unlatch = imp * np.exp(-t * 120.0) * 0.55 + np.sin(2.0 * math.pi * 920.0 * t) * np.exp(-t * 68.0) * 0.30
        sigh = _bandpass_swept_noise(dur, 1050.0, 260.0, bw_ratio=0.55, seed=2626)
        sigh_env = np.sin(math.pi * t / dur) ** 1.2 * np.exp(-t * 1.6)
        return (unlatch + sigh * sigh_env * 0.72).astype(np.float32)

    if sfx_type == "fluid_inflate":
        dur = 2.15
        n = int(round(dur * SR))
        t = np.linspace(0.0, dur, n, endpoint=False, dtype=np.float32)
        # Smooth rising laminar fluid pressure into silicone retention balloon
        laminar = _bandpass_swept_noise(dur, 320.0, 960.0, bw_ratio=0.60, seed=1600)
        shimmer = _bandpass_swept_noise(dur, 1300.0, 2600.0, bw_ratio=0.45, seed=1601)
        env = adsr_env(n, attack=0.18, decay=0.30, sustain=0.78, release=0.38)
        # Gentle silicone elastic tension pitch rise
        f_elastic = 138.0 + 96.0 * (t / dur) ** 0.85
        elastic = np.sin(2.0 * math.pi * np.cumsum(f_elastic) / SR) * 0.11
        return ((laminar * 0.72 + shimmer * 0.22 + elastic) * env).astype(np.float32)

    if sfx_type == "gravity_flow":
        dur = 2.35
        n = int(round(dur * SR))
        t = np.linspace(0.0, dur, n, endpoint=False, dtype=np.float32)
        rng = np.random.default_rng(2105)
        # Smooth closed-system laminar drainage cascade
        flow_main = butter_filter(rng.standard_normal(n).astype(np.float32), "band", (420.0, 1750.0), order=2)
        flow_warm = butter_filter(rng.standard_normal(n).astype(np.float32), "band", (190.0, 480.0), order=2)
        ripple = 0.84 + 0.16 * np.sin(2.0 * math.pi * 2.4 * t) * np.sin(2.0 * math.pi * 0.9 * t)
        env = adsr_env(n, attack=0.22, decay=0.25, sustain=0.80, release=0.45)
        return ((flow_main * 0.62 + flow_warm * 0.36) * ripple * env).astype(np.float32)

    if sfx_type == "drip_echo":
        dur = 0.95
        n = int(round(dur * SR))
        t = np.linspace(0.0, dur, n, endpoint=False, dtype=np.float32)
        out = np.zeros(n, dtype=np.float32)
        # 3 soft sterile droplets entering collection chamber
        drops = [(0.00, 620.0, 0.56), (0.28, 740.0, 0.46), (0.56, 675.0, 0.36)]
        for delay_s, f_base, amp in drops:
            d = int(round(delay_s * SR))
            m = n - d
            tt = t[:m]
            # Classic upward pitch-chirp sterile water droplet
            f_drop = f_base * (1.0 + 1.15 * (1.0 - np.exp(-tt * 38.0)))
            drop = np.sin(2.0 * math.pi * np.cumsum(f_drop) / SR) * np.exp(-tt * 28.0)
            chamber = np.sin(2.0 * math.pi * (f_base * 0.52) * tt) * np.exp(-tt * 9.5) * 0.28
            att = np.clip(tt / 0.002, 0.0, 1.0)
            out[d:] += (drop + chamber) * att * amp
        return out.astype(np.float32)

    return np.zeros(int(0.1 * SR), dtype=np.float32)


def main() -> None:
    timeline = load_timeline(TIMELINE_PATH)

    print("[Audio] Synthesizing Kokoro clinical narration (bm_george)...")
    dialogue_bus, speaker_mono_buses, manifest_lines = synthesize_dialogue(timeline)

    print("[Audio] Synthesizing calm clinical ambient underscore (72 BPM, Cmaj9/Fmaj7/G6/Em7)...")
    bgm_bus = generate_bgm()

    sfx_events = timeline.get("sfxEvents", [])
    print(f"[Audio] Synthesizing {len(sfx_events)} tactile clinical Foley SFX events...")
    sfx_bus = np.zeros((TOTAL_SAMPLES, CHANNELS), dtype=np.float32)
    for ev in sfx_events:
        wav = synth_sfx(ev["type"]) * float(ev.get("gain", 0.60))
        add_stereo_event(sfx_bus, pan_stereo(wav, float(ev.get("pan", 0.0))), float(ev["time"]))

    master_and_export(PROJECT_ROOT, timeline, dialogue_bus, bgm_bus, sfx_bus, speaker_mono_buses, manifest_lines)


if __name__ == "__main__":
    main()
