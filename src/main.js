import './style.css';
import { AudioFeatures } from './audio/features.js';
import { Scene } from './render/scene.js';
import { Effects } from './render/effects.js';

const gate = document.getElementById('gate');
const loadingEl = document.getElementById('loading');
const backendHint = document.getElementById('backend-hint');
const btnMic = document.getElementById('btn-mic');
const btnNoMic = document.getElementById('btn-nomic');

const sceneObj = new Scene(document.getElementById('canvas-wrap'));
const effects = new Effects(sceneObj.scene);
const audio = new AudioFeatures();

let micMode = false;
let frozen = false;
let burstUntil = 0;
let lastShatter = 0;
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
  sceneObj.cameraTargetZ = Math.min(11, Math.max(3.5,
    sceneObj.cameraTargetZ + e.deltaY * 0.003));
}, { passive: true });
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    burstUntil = performance.now() + 900;
    // big blast on Space
    const hue = 0.55 + (Math.random() - 0.5) * 0.2;
    effects.blast(400, null, 5.0, hue);
    effects.spawnRing(hue, 6.0);
    e.preventDefault();
  }
  if (e.key === 'Shift') frozen = true;
});
window.addEventListener('keyup', (e) => { if (e.key === 'Shift') frozen = false; });

backendHint.textContent = 'direct drive + effects';
loadingEl.textContent = 'ready — click to start';
btnMic.disabled = false;
btnNoMic.disabled = false;

async function begin(withMic) {
  if (withMic) {
    try {
      await audio.start();
      micMode = true;
      backendHint.textContent = 'listening';
    } catch (err) {
      backendHint.textContent = 'mic denied — cursor only';
      micMode = false;
    }
  } else {
    backendHint.textContent = 'cursor only';
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
    document.getElementById('r-fps').textContent = fps.toFixed(1);
  }

  if (frozen) {
    sceneObj.update(0, false);
    effects.update(0, 0, 0, 0.5);
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

  // continuous particle emission driven by loudness
  if (rms > 0.4) {
    const count = Math.floor(rms * 15);
    effects.blast(count, null, 1.5 + rms * 2.5, hue);
  }

  // onset-triggered shatter — but only every 2 seconds
  if (onset > 0.6 && now - lastShatter > 2000) {
    effects.shatter();
    lastShatter = now;
  }

  sceneObj.setAudio(rms, centroid, onset, hue);
  sceneObj.update(dt, burst);
  effects.update(dt, rms, onset, hue);

  document.getElementById('r-valence').textContent = rms.toFixed(2);
  document.getElementById('r-arousal').textContent = centroid.toFixed(2);
  document.getElementById('r-tension').textContent = onset.toFixed(2);
  document.getElementById('r-density').textContent = (rms * 0.5 + centroid * 0.5).toFixed(2);
  document.getElementById('r-rms').textContent = audio.lastRMS.toFixed(4);
  document.getElementById('r-onset').textContent = onset > 0.5 ? 'BOOM' : '-';
  document.getElementById('r-infer').textContent = 'direct';
}
