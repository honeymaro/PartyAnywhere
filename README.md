<div align="center">

# ◆ PartyAnywhere

### Share a tab. Play the music. Watch the room come alive.

*Your screen. Your music. Your colors. Bring the party anywhere.*

A browser-based, audio-reactive **WebGL visualizer** that listens to whatever's playing in a shared Chromium tab and turns it into a wall of living light — in **your** colors.

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![WebGL2](https://img.shields.io/badge/WebGL2-shaders-FF4154)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![Visualizers](https://img.shields.io/badge/visualizers-53-purple)
![No install for the audience](https://img.shields.io/badge/audience-zero%20install-brightgreen)

</div>

---

## 🎉 Built for the moment

This isn't a toy spectrum bar. It's a **set-and-forget visual engine** for real rooms:

| | |
|---|---|
| 🪩 **Parties & clubs** | Throw it on the projector, hit fullscreen, share your Spotify/YouTube tab — the floor reacts to every beat while 50+ scenes rotate on their own. |
| 🏢 **Corporate & brand promo** | **Paint the entire show in your brand color.** Type a hex, drop your logo, or let it pull the dominant color straight off the shared screen. Instant on-brand ambiance for booths, launches, lobbies, and conference stages. |
| 🖼️ **Exhibitions & galleries** | Quiet, hypnotic, unattended. Pick a curated subset of visualizers and let it drift for hours. |
| ☕ **Cafés & lounges** | Ambient motion that breathes with the playlist — no DJ, no babysitting. |

---

## ✨ Why it stands out

- **🎨 On-brand by design.** Three color sources you can switch live, all eased through perceptual **OKLab** color so transitions are buttery, never jarring:
  - **Auto (screen)** — extracts the dominant *saturated* color from the shared tab (album art, your product page, a brand site) and follows it as the music changes.
  - **Image** — upload a logo or key art; it pulls the signature color out.
  - **Manual** — drop in an exact hex. Your brand palette, locked in.
- **🌀 53 visualizers, auto-rotating.** From liquid chrome and aurora ribbons to raymarched fractal tunnels and reactive spectrum bars — they cycle on a timer, or you drive them by hand.
- **🖥️ Made for the big screen.** One-click fullscreen, controls that tuck away, runs unattended.
- **🧩 Pick your set.** A live preview gallery (hover any card to see it move) with checkboxes — choose exactly which scenes are in the rotation.
- **💾 Remembers everything.** Your selected scenes, colors, and rotation settings persist across reloads.
- **⚡ Zero install for your audience.** It's a web app. Open a URL, share a tab, done.

---

## 🚀 Quick start

> Requires a **Chromium browser** (Chrome / Edge) — tab-audio capture is a Chromium feature.

```bash
pnpm install
pnpm dev
```

Open the printed local URL, then:

1. Click **Start screen share**.
2. In the picker, choose the **tab** that's playing music (Spotify, YouTube, etc.).
3. **⚠️ Turn ON "Share tab audio"** in the share dialog. *(This is the #1 gotcha — without it there's no sound to react to. The app will gently remind you if you forget.)*
4. Hit **Fullscreen** and enjoy. 🎶

---

## 🎛️ Controls

| Control | What it does |
|---|---|
| **Start screen share** | Capture the audio + video of a shared tab |
| **Fullscreen** | Fill the screen; hide the chrome |
| **Color: Auto / Image / Manual** | Choose how the palette is driven (relevant control appears per mode) |
| **Color picker** *(Manual)* | Pin an exact brand color |
| **Upload image** *(Image)* | Extract a color from a logo / key art |
| **◀ / ⏸ Pause / ▶** | Manual previous / pause auto-rotation / next |
| **Rotate (sec)** | How long each visualizer stays before switching |
| **Visualizers ▦** | Open the gallery — preview & checkbox-select your active set (Select all / Deselect all) |

---

## 🌈 The visualizer library

53 single-pass WebGL2 shaders, grouped by vibe:

- **Liquid metal & iridescence** — Liquid Chrome Flow, Liquid Mercury Pool, Chrome Metaball Sculpture, Ferrofluid Spikes, Thin-Film Soap Bubble, Iridescent Iris Portal, Oil Slick Domain Warp, Prism Dispersion Beams
- **Aurora & ribbons** — Aurora Curtains, Flowing Sine Ribbons, Spectral Helix DNA
- **Raymarched worlds** — Twisting SDF Tunnel, Menger Sponge Tunnel, Mandelbox Crystal Cave, Mandelbulb Alien Orbit, KIFS Octahedron Bloom
- **Fractals & attractors** — Julia Morph, Fractal Flame Swirl, Clifford Attractor, Hyperbolic Poincaré
- **Organic & noise** — Curl Noise Ink, Living Voronoi, Metaball Lava, Rising Smoke Plume, Watercolor Bleed, Faux Reaction-Diffusion, Cyber-Organic Nebula
- **Retro & glitch** — Synthwave Grid, CRT VHS Tube, Datamosh Glitch, Moiré Interference
- **Audio-forward** — Radial Spectrum Bars, Concentric Waveform Rings, Equalizer Skyline
- **Geometry & tiles** — Kaleidoscope Mandala, Hex Grid Pulse, Truchet Weave, Phyllotaxis Spiral, Topographic Contours, Hex Ripple Expansion
- **…and more** — Caustics Pool, Branching Lightning, Electric Node Network, Gradient Mesh Blobs, Cosine Palette Field, Starfield Warp, and others.

If a shader ever fails to compile on your GPU, the app quietly skips it — the show never crashes.

---

## ⚙️ How it works

```
Shared Chromium tab ──► getDisplayMedia (audio + video)
        │
        ├─ audio ─► AnalyserNode (FFT) ─► bass · mid · treble · level · beat · spectrum
        │
        └─ video ─► sampled frames ─► dominant-color extraction
                                            │
   manual hex / logo ──► Color sources ──► OKLab-eased palette
                                            │
            AudioFrame + palette ──► WebGL2 host ──► active fullscreen shader ──► screen
```

A single `requestAnimationFrame` loop feeds each visualizer a read-only frame: the current time, the analyzed audio, and the smoothly-interpolated palette. Visualizers are plugins behind one tiny interface, so the rotation can swap them at runtime.

---

## 🧱 Tech & architecture

- **Vite + TypeScript**, **pnpm**, **no runtime dependencies** (no three.js — raw WebGL2 fullscreen fragment shaders).
- Clean module boundaries: pure logic (FFT band reduction, beat detection, OKLab color math, dominant-color extraction, rotation scheduling) is side-effect-free and **unit-tested with Vitest**; browser/WebGL lives at the edges.
- A swappable **`Visualizer`** plugin contract + registry; the gallery and the live host share the same factory list.
- Previews render on **one shared GL context** (hover-to-play, lazy/staggered shader compile) — no per-card context blowup.

```bash
pnpm test        # run the unit tests
pnpm build       # type-check + production build
pnpm preview     # serve the build
```

---

## 🌐 Browser support

| Feature | Support |
|---|---|
| Tab + **tab audio** capture | ✅ Chrome / Edge (Chromium) |
| WebGL2 fullscreen shaders | ✅ Any modern GPU |
| System-wide audio on macOS | ⚠️ Limited by the OS — prefer **tab** sharing |

Tip: for an unattended event, share a tab, pick your visualizer set, set a rotation interval, go fullscreen — and walk away. Your settings will still be there tomorrow.

---

<div align="center">

**Made to make rooms glow.** ✦

</div>
