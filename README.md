# How a Foley Catheter Works — 3D Clinical Visualization (9:16)

A **30-second vertical (`1080×1920`, `30 fps`, `900` frames)** clinical anatomy and medical device visualization explaining how a **2-way silicone Foley catheter** operates from placement through closed gravity drainage and safe deflation removal.

## Rendered Video Output
- **Video**: [`output/catheter_how_it_works.mp4`](output/catheter_how_it_works.mp4) (`1080×1920`, H.264 High Profile `avc1.64002a`, `30.000s` / `900` frames, `44.1 kHz` stereo AAC)
- **Captions**: [`output/subtitles.srt`](output/subtitles.srt)

## Clinical Choreography (6 Beats)
1. **01 • Device Overview (`0.0–5.0s`)**: Full upright 2-way silicone catheter displaying twin Murphy drainage eyes, translucent dual-lumen shaft, check valve, and docked `10 mL` syringe.
2. **02 • Dual-Lumen Architecture (`5.0–10.2s`)**: Axial cutaway strips back the outer sheath to expose the parallel **Drainage Channel** and cyan **Inflation Lumen**.
3. **03 • Atraumatic Insertion (`10.2–15.2s`)**: Translucent pelvic bladder and curved urethral cutaway fade in as the lubricated rounded tip glides cleanly until the Murphy eyes sit inside the cavity.
4. **04 • Retention Balloon Lock (`15.2–20.8s`)**: `10 mL` sterile water injects through the blue one-way check valve, inflating the retention balloon securely against the bladder neck seal.
5. **05 • Closed Gravity Drainage (`20.8–26.2s`)**: Urine drains through the top Murphy ports down the central lumen into an anti-reflux drip chamber and graduated `300 mL` sterile bag (`0 → 250 mL`).
6. **06 • Deflation & Safe Removal (`26.2–30.0s`)**: Releasing the valve withdraws `10 mL → 0 mL` back into the syringe so the balloon collapses flush for atraumatic withdrawal.

## Architecture & Pipeline
- **3D Medical Device Rig**: [`src/scene/catheterRig.js`](src/scene/catheterRig.js) — parametric lathe dome tip, recessed Murphy eyes, animated cutaway trough, morphing `0–10 mL` retention balloon, instanced inflation fluid beads, and Luer-lock syringe.
- **Pelvic Anatomy & Studio**: [`src/scene/medStudio.js`](src/scene/medStudio.js) — deep sapphire studio cyclorama, open-front (`+Z`) detrusor & mucosal rugae bladder/urethra cutaway, dynamic bladder urine pool meniscus, `32` instanced drainage droplets, and graduated collection bag.
- **Camera Director & Telemetry HUD**: [`src/camera/director.js`](src/camera/director.js), [`src/hud/medHud.js`](src/hud/medHud.js) — smooth cubic documentary camera framing, top device telemetry bar (`BALLOON`, `BAG VOL`, `STATE`), 3D-projected vector leader callouts, and lower-third narration cards synced to audio word timestamps.
- **Clinical Audio Mastering**: [`audio/generate_audio.py`](audio/generate_audio.py), [`audio/dspCore.py`](audio/dspCore.py) — Kokoro ONNX (`bm_george` `en-gb`), `72 BPM` calm clinical ambient underscore (`Cmaj9 / Fmaj7 / G6 / Em7`), and `12` synchronized clinical Foley cues mastered to `-4.37 dBFS` peak.
- **Pre-Flight Gate & WebCodecs Pipeline**: [`verify_scene.mjs`](verify_scene.mjs), [`render/fastRenderer.mjs`](render/fastRenderer.mjs) — sub-second Node NDC frustum & resource budget verifier (`27` draws, `25,888` tris, `21` mats, `3` lights) followed by headless Chrome WebCodecs H.264 Annex-B rendering and FFmpeg stream copy muxing.

## Reproduction
```bash
# 1. Regenerate narration, ambient underscore, Foley SFX, and subtitles
.venv/bin/python audio/generate_audio.py

# 2. Run <1s Node pre-flight budget & safe-frame verification
node verify_scene.mjs

# 3. Render 900 frames via Chrome WebCodecs & mux final MP4
node render/render_frames.mjs --batch-size=150
```
