A real-time neural-controlled 3D instrument. Speak, hum, or move your cursor — a trained MLP turns audio features into a 32-dimensional latent vector that drives geometry, color, and motion in the browser.

**Live demo:** [neural-sculptor.vercel.app](https://neural-sculptor.vercel.app)

---

## What It Does

The neural network does not generate content. It is a **continuous control signal** — a 32-dimensional vector updated 60 times per second that describes how the scene should feel right now.

- Speak softly → the sphere contracts and dims
- Shout → it swells and brightens
- Hum a low note → the color shifts warm
- Move your cursor fast → particles accelerate outward
- Press Space → a burst of energy
- Press S → save the current latent as an orbiting cube

All inference runs on-device. No server. No API calls. Latency from mic to pixels: under 20 ms.

---

## Architecture
Microphone
↓
Web Audio API → 5 audio features (centroid, rolloff, ZCR, RMS, pitch)
↓
16-dim input vector (with cursor, time, onset)
↓
MLP: 16 → 64 → 32 (trained in PyTorch, exported to ONNX)
↓
onnxruntime-web inference (WebGPU with WASM fallback)
↓
32-dim latent vector
↓
Three.js + custom GLSL shaders (vertex, fragment, particles, 3D UI)
↓
WebGL at 60 fps

text

---

## Features

- **Real-time neural inference** — trained MLP runs every frame in the browser
- **Custom GLSL shaders** — vertex displacement driven by latent-modulated simplex noise
- **Particle field** — 3,500 GPU-instanced particles driven by latent vectors
- **3D UI** — HUD panel, floating buttons, orbiting snapshot cubes rendered in the scene
- **Audio DSP from scratch** — spectral features and pitch detection via Web Audio API
- **Recording** — one click captures canvas + audio to a downloadable `.webm`
- **TTS narration** — the scene describes itself aloud
- **Latent snapshots** — press `S` to save, click a cube to reload
- **Real-time chat** — multi-user chat with latent sharing
- **Adaptive performance** — particle count and resolution scale on mobile

---

## Stack

| Layer | Technology |
|-------|-----------|
| Training | PyTorch → ONNX |
| Inference | onnxruntime-web (WebGPU + WASM SIMD) |
| Rendering | Three.js r160 + custom GLSL |
| Audio DSP | Web Audio API |
| 3D UI | CanvasTexture + raycasting |
| Recording | MediaRecorder + canvas.captureStream() |
| Narration | Web Speech API |
| Chat | WebSocket |
| Build | Vite 6 |
| Deploy | Vercel |

---

## Run Locally

### Prerequisites

- Node.js 20+
- Python 3.10+
- A microphone
- Chrome or Edge (recommended)

### Setup

```bash
git clone https://github.com/Neelakshh/neural-sculptor.git
cd neural-sculptor
npm install

python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install torch numpy onnx onnxscript

python scripts/train_controller.py
npm run dev
