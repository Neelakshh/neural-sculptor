import './style.css';
import { AudioFeatures } from './audio/features.js';
import { Scene } from './render/scene.js';
import { Effects } from './render/effects.js';
import { UI3D } from './render/ui3d.js';

// Hide the old HTML overlays — the UI is now in 3D.
['readout', 'controls', 'gallery'].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
});

const gate = document.getElementById('gate');
const loadingEl = document.getElementById('loading');
const backendHint = document.getElementById('backend-hint');
const btnMic = document.getElementById('btn-mic');
const btnNoMic = document.getElementById('btn-nomic');

const sceneObj = new Scene(document.getElementById('canvas-wrap'));
const effects = new Effects(sceneObj.scene);
const ui = new UI3D(sceneObj.scene, sceneObj.camera, sceneObj.renderer.domElement);
const audio = new AudioFeatures();

let micMode = false;
let frozen = false;
let burstUntil = 0;
let lastShatter = 0;
let isRecording = false;
let narrate = false;
let recorder = null;
const snapshots = [];
const cursor = { x: 0, y: 0, vx: 0, vy: 0, px: 0, py: 0 };

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
    burstUntil = performance.now() + 900;
    const hue = 0.55 + (Math.random() - 0.5) * 0.2;
    effects.blast(400, null, 5.0, hue);
    effects.spawnRing(hue, 6.0);
    e.preventDefault();
  }
  if (e.key === 'Shift') frozen = true;
  if (e.key === 's' || e.key === 'S') takeSnapshot();
});
window.addEventListener('keyup', (e) => { if (e.key === 'Shift') frozen = false; });

// ---- wire the 3D control ring ----
ui.onClick(ui.ringSegments.find(s => s.userData.id === 'burst'), () => {
  burstUntil = performance.now() + 900;
  const hue = 0.55 + (Math.random() - 0.5) * 0.2;
  effects.blast(400, null, 5.0, hue);
  effects.spawnRing(hue, 6.0);
});
ui.onClick(ui.ringSegments.find(s => s.userData.id === 'snapshot'), () => {
  takeSnapshot();
});
ui.onClick(ui.ringSegments.find(s => s.userData.id === 'reset'), () => {
  snapshots.length = 0;
  ui.setSnapshots([], () => {});
  effects.blast(100, null, 3.0, 0.75);
});
ui.onClick(ui.ringSegments.find(s => s.userData.id === 'record'), () => {
  toggleRecord();
});
ui.onClick(ui.ringSegments.find(s => s.userData.id === 'narrate'), () => {
  narrate = !narrate;
  ui.setRingActive('narrate', narrate);
});

async function toggleRecord() {
  if (!isRecording) {
    const { Recorder } = await import('./recording/recorder.js');
    let audioStream = null;
    if (audio.ctx && audio.ready) {
      const dest = audio.ctx.createMediaStreamDestination();
      audio.analyser.connect(dest);
      audioStream = dest.stream;
    }
    recorder = new Recorder(sceneObj.renderer.domElement, audioStream);
    recorder.start();
    isRecording = true;
    ui.setRingActive('record', true);
  } else {
    await recorder.stop();
    isRecording = false;
    ui.setRingActive('record', false);
  }
}

function takeSnapshot() {
  snapshots.push({
    latent: new Float32Array([0]),
    hue: (0.55 + Math.random() * 0.3) % 1,
  });
  ui.setSnapshots(snapshots, (snap) => {
    effects.blast(60, null, 2.0, snap.hue);
  });
  effects.blast(80, null, 3.0, 0.08);
}

backendHint.textContent = 'ready';
loadingEl.textContent = 'ready - click to start';
btnMic.disabled = false;
btnNoMic.disabled = false;

async function begin(withMic) {
  if (withMic) {
    try {
      await audio.start();
      micMode = true;
    } catch (err) {
      micMode = false;
    }
  }
  gate.classList.add('hidden');
  requestAnimationFrame(loop);
}
btnMic.addEventListener('click', () => begin(true));
btnNoMic.addEventListener('click', () => begin(false));

let last = performance.now();
let fpsAccum = 0, fpsCount = 0, fps = 0;

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  fpsAccum += dt; fpsCount++;
  if (fpsAccum > 0.5) {
    fps = fpsCount / fpsAccum;
    fpsAccum = 0; fpsCount = 0;
  }

  if (frozen) {
    sceneObj.update(0, false);
    effects.update(0, 0, 0, 0.5);
    ui.update(now * 0.001, { rms: 0 });
    return;
  }

  let rms = 0, centroid = 0, onset = 0, hue = 0.55;

  if (micMode) {
    const f = audio.read();
    if (f) {
      rms = f.raw[0];
      centroid = f.raw[1];
      onset = f.onset;
      hue = 0.55 + (f.affect[0] - 0.5) * 0.5;
    }
  } else {
    const speed = Math.min(1, Math.hypot(cursor.vx, cursor.vy) * 15);
    rms = speed;
    centroid = (cursor.x + 1) / 2;
    onset = speed > 0.6 ? 1 : 0;
    hue = (cursor.y + 1) / 2;
  }

  const burst = performance.now() < burstUntil;

  if (rms > 0.4) {
    const count = Math.floor(rms * 15);
    effects.blast(count, null, 1.5 + rms * 2.5, hue);
  }
  if (onset > 0.6 && now - lastShatter > 2000) {
    effects.shatter();
    lastShatter = now;
    ui.triggerOnset();
  }

  sceneObj.setAudio(rms, centroid, onset, hue);
  sceneObj.update(dt, burst);
  effects.update(dt, rms, onset, hue);

  ui.update(now * 0.001, { rms, centroid, onset });
  ui.updatePanel({
    rms, centroid, onset,
    valence: rms,
    arousal: centroid,
    tension: onset,
    density: (rms + centroid) / 2,
    fps,
    backend: 'direct',
  });
}
