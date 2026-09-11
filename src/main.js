import './style.css';
import { AudioFeatures } from './audio/features.js';
import { NeuralController } from './ai/controller.js';
import { Scene } from './render/scene.js';
import { Effects } from './render/effects.js';
import { UI3D } from './render/ui3d.js';
import { Recorder } from './recording/recorder.js';

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const gate      = document.getElementById('gate');
const errBox    = document.getElementById('err');
const loadingEl = document.getElementById('loading');
const backendHint = document.getElementById('backend-hint');
const btnMic    = document.getElementById('btn-mic');
const btnNoMic  = document.getElementById('btn-nomic');
const btnRecord = document.getElementById('btn-record');
const btnNarrate= document.getElementById('btn-narrate');
const btnSnap   = document.getElementById('btn-snapshot');
const btnBurst  = document.getElementById('btn-burst');
const galleryEl = document.getElementById('gallery');

function showError(msg) {
  errBox.textContent = msg;
  errBox.style.display = 'block';
  console.error('[err]', msg);
}

// Enable gate buttons immediately so clicks always work.
btnMic.disabled = false;
btnNoMic.disabled = false;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const sceneObj  = new Scene(document.getElementById('canvas-wrap'));
const effects   = new Effects(sceneObj.scene);
const ui        = new UI3D(sceneObj.scene, sceneObj.camera, sceneObj.renderer.domElement);
const audio     = new AudioFeatures();
const controller= new NeuralController();

let micMode       = false;
let frozen        = false;
let burstUntil    = 0;
let lastShatter   = 0;
let narrate       = false;
let isRecording   = false;
let recorder      = null;
let lastNarrateAt = 0;
let modelReady    = false;
let inferenceMs   = 0;
let fps           = 0;

const snapshots = [];
const cursor    = { x: 0, y: 0, vx: 0, vy: 0, px: 0, py: 0 };
const input16   = new Float32Array(16);

// ---------------------------------------------------------------------------
// Load ONNX model
// ---------------------------------------------------------------------------
(async () => {
  try {
    await controller.init('/controller.onnx');
    modelReady = controller.ready;
    backendHint.textContent = 'inference: ' + controller.backend;
    loadingEl.textContent = modelReady
      ? 'model loaded (' + controller.backend + ')'
      : 'model failed — using direct drive';
  } catch (err) {
    modelReady = false;
    backendHint.textContent = 'inference: direct';
    loadingEl.textContent = 'ready';
  }
  btnRecord.disabled = false;
  btnNarrate.disabled = false;
  btnSnap.disabled = false;
  btnBurst.disabled = false;
})();

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
window.addEventListener('mousemove', (e) => {
  const nx = (e.clientX / window.innerWidth) * 2 - 1;
  const ny = (e.clientY / window.innerHeight) * 2 - 1;
  cursor.vx = nx - cursor.px;
  cursor.vy = ny - cursor.py;
  cursor.px = nx; cursor.py = ny;
  cursor.x = nx; cursor.y = ny;
});

window.addEventListener('wheel', (e) => {
  sceneObj.cameraTargetZ = Math.min(13, Math.max(4.5,
    sceneObj.cameraTargetZ + e.deltaY * 0.003));
}, { passive: true });

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    triggerBurst();
    e.preventDefault();
  }
  if (e.key === 'Shift') frozen = true;
  if (e.key === 's' || e.key === 'S') takeSnapshot();
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') frozen = false;
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function begin(withMic) {
  if (withMic) {
    try {
      await audio.start();
      micMode = true;
    } catch (err) {
      showError('Mic denied — cursor input only.');
      micMode = false;
    }
  } else {
    micMode = false;
  }
  gate.classList.add('hidden');
  last = performance.now();
  requestAnimationFrame(loop);
}
btnMic.addEventListener('click', () => begin(true));
btnNoMic.addEventListener('click', () => begin(false));

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function triggerBurst() {
  burstUntil = performance.now() + 900;
  const hue = 0.55 + (Math.random() - 0.5) * 0.2;
  effects.blast(400, null, 5.0, hue);
  effects.spawnRing(hue, 6.0);
}

btnBurst.addEventListener('click', triggerBurst);

btnSnap.addEventListener('click', takeSnapshot);

function takeSnapshot() {
  snapshots.push({
    latent: new Float32Array(controller.prevOut),
    hue: (controller.prevOut[9] + 1) / 2,
  });
  renderGallery();
  ui.setSnapshots(snapshots, (snap) => {
    controller.prevOut.set(snap.latent);
    effects.blast(60, null, 2.0, snap.hue);
  });
  effects.blast(80, null, 3.0, 0.08);
}

function renderGallery() {
  galleryEl.innerHTML = '';
  snapshots.slice(-8).forEach((snap, i) => {
    const div = document.createElement('div');
    div.className = 'snap';
    div.style.background = 'hsl(' + (snap.hue * 360) + ', 65%, 50%)';
    div.title = 'Snapshot ' + (i + 1) + ' — click to load';
    div.onclick = () => {
      controller.prevOut.set(snap.latent);
      effects.blast(60, null, 2.0, snap.hue);
    };
    galleryEl.appendChild(div);
  });
}

btnRecord.addEventListener('click', async () => {
  if (!isRecording) {
    let audioStream = null;
    if (audio.ctx && audio.ready) {
      const dest = audio.ctx.createMediaStreamDestination();
      audio.analyser.connect(dest);
      audioStream = dest.stream;
    }
    recorder = new Recorder(sceneObj.renderer.domElement, audioStream);
    recorder.start();
    isRecording = true;
    btnRecord.textContent = '\u25A0 Stop';
    btnRecord.style.borderColor = '#ff4444';
    btnRecord.style.color = '#ff4444';
    ui.setRingActive('record', true);
  } else {
    await recorder.stop();
    isRecording = false;
    btnRecord.textContent = '\u25CF Record';
    btnRecord.style.borderColor = '';
    btnRecord.style.color = '';
    ui.setRingActive('record', false);
  }
});

btnNarrate.addEventListener('click', () => {
  narrate = !narrate;
  btnNarrate.textContent = narrate ? '\u25C9 Narrating' : '\u25CB Narrate';
  btnNarrate.style.borderColor = narrate ? '#5EEAD4' : '';
  btnNarrate.style.color = narrate ? '#5EEAD4' : '';
  ui.setRingActive('narrate', narrate);
  if (!narrate) speechSynthesis.cancel();
});

// Ring click handlers
ui.onClick(ui.ringSegments.find(s => s.userData.id === 'burst'),    triggerBurst);
ui.onClick(ui.ringSegments.find(s => s.userData.id === 'snapshot'), takeSnapshot);
ui.onClick(ui.ringSegments.find(s => s.userData.id === 'record'),   () => btnRecord.click());
ui.onClick(ui.ringSegments.find(s => s.userData.id === 'narrate'),  () => btnNarrate.click());
ui.onClick(ui.ringSegments.find(s => s.userData.id === 'reset'),    () => {
  snapshots.length = 0;
  renderGallery();
  ui.setSnapshots([], () => {});
  effects.blast(100, null, 3.0, 0.75);
});

// ---------------------------------------------------------------------------
// Narration
// ---------------------------------------------------------------------------
function maybeNarrate(latent, affect, now) {
  if (!narrate) return;
  if (now - lastNarrateAt < 3500) return;
  lastNarrateAt = now;
  const phrases = [];
  if (latent[0] > 0.35) phrases.push('expanding');
  if (latent[0] < -0.35) phrases.push('contracting');
  if (latent[9] > 0.25) phrases.push('shifting hue');
  if (latent[16] > 0.3) phrases.push('particles accelerating');
  if (affect[1] > 0.55) phrases.push('sensing intensity');
  if (phrases.length === 0) phrases.push('holding steady');
  const line = 'I am ' + phrases.slice(0, 2).join(', ') + '.';
  const u = new SpeechSynthesisUtterance(line);
  u.rate = 1.15;
  u.pitch = 0.8 + latent[10] * 0.4;
  u.volume = 0.8;
  speechSynthesis.speak(u);
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------
let last = performance.now();
let fpsAccum = 0, fpsCount = 0;

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  fpsAccum += dt; fpsCount++;
  if (fpsAccum > 0.5) {
    fps = fpsCount / fpsAccum;
    fpsAccum = 0; fpsCount = 0;
    document.getElementById('r-fps').textContent = fps.toFixed(1);
  }

  if (frozen) {
    sceneObj.update(0, false);
    effects.update(0, 0, 0, 0.5);
    ui.update(now * 0.001, { rms: 0 });
    return;
  }

  // ----- audio / cursor -> affect + raw -----
  let affect = [0, 0, 0, 0];
  let raw = [0, 0, 0, 0, 0];
  let onset = 0, rms = 0;

  if (micMode) {
    const f = audio.read();
    if (f) { affect = f.affect; raw = f.raw; onset = f.onset; rms = f.rms; }
  } else {
    const speed = Math.min(1, Math.hypot(cursor.vx, cursor.vy) * 15);
    affect = [ (cursor.x + 1) / 2, speed, Math.abs(cursor.vy) * 3, Math.abs(cursor.vx) * 3 ];
    raw = [ (cursor.y + 1) / 2, speed, speed, speed, 0.3 ];
    onset = speed > 0.6 ? 1 : 0;
  }

  const burst = performance.now() < burstUntil;
  const t = now * 0.001;

  // ----- latent: MLP if loaded, otherwise direct drive -----
  let latent;
  if (modelReady) {
    input16.set([
      affect[0], affect[1], affect[2], affect[3],
      raw[0], raw[1], raw[2], raw[3], raw[4],
      cursor.x, cursor.y, Math.min(1, Math.hypot(cursor.vx, cursor.vy) * 10),
      burst ? 1 : 0,
      Math.sin(t * 0.1), Math.cos(t * 0.1),
      onset,
    ]);
    latent = controller.forward(input16);
    inferenceMs = controller.lastInferenceMs();
  } else {
    // direct drive: fabricate a 32-dim latent from audio
    latent = controller.prevOut;
    latent[0] = (rms - 0.5) * 2;
    latent[8] = (rms - 0.5) * 2;
    latent[9] = (affect[0] - 0.5) * 2;
    latent[10] = (affect[1] - 0.5) * 2;
    latent[16] = (affect[2] - 0.5) * 2;
    latent[17] = (affect[3] - 0.5) * 2;
    inferenceMs = 0;
  }

  // ----- drive scene from audio directly (always) -----
  const hue = 0.55 + (affect[0] - 0.5) * 0.5;
  sceneObj.setAudio(rms, raw[0], onset, hue);
  sceneObj.update(dt, burst);

  // ----- effects -----
  if (rms > 0.4) {
    effects.blast(Math.floor(rms * 15), null, 1.5 + rms * 2.5, hue);
  }
  if (onset > 0.6 && now - lastShatter > 2000) {
    effects.shatter();
    lastShatter = now;
    ui.triggerOnset();
  }
  effects.update(dt, rms, onset, hue);

  // ----- 3D UI -----
  ui.update(t, { rms, centroid: raw[0], onset });
  ui.updatePanel({
    rms, centroid: raw[0], onset,
    valence: affect[0], arousal: affect[1],
    tension: affect[2], density: affect[3],
    fps, backend: modelReady ? controller.backend : 'direct',
  });

  // ----- narration -----
  maybeNarrate(latent, affect, now);

  // ----- HTML readout -----
  document.getElementById('r-valence').textContent = affect[0].toFixed(2);
  document.getElementById('r-arousal').textContent = affect[1].toFixed(2);
  document.getElementById('r-tension').textContent = affect[2].toFixed(2);
  document.getElementById('r-density').textContent = affect[3].toFixed(2);
  document.getElementById('r-rms').textContent = rms.toFixed(3);
  document.getElementById('r-onset').textContent = onset > 0.5 ? 'BOOM' : '-';
  document.getElementById('r-infer').textContent = modelReady
    ? inferenceMs.toFixed(2) + ' ms'
    : 'direct';
}
