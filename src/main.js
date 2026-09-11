import './style.css';
import { AudioFeatures } from './audio/features.js';
import { NeuralController } from './ai/controller.js';
import { Scene } from './render/scene.js';
import { Recorder } from './recording/recorder.js';
import { UI3D } from './render/ui3d.js';

const gate = document.getElementById('gate');
const errBox = document.getElementById('err');
const loadingEl = document.getElementById('loading');
const backendHint = document.getElementById('backend-hint');
const btnMic = document.getElementById('btn-mic');
const btnNoMic = document.getElementById('btn-nomic');
const recordBtn = document.getElementById('btn-record');
const narrateBtn = document.getElementById('btn-narrate');
const galleryEl = document.getElementById('gallery');

const sceneObj = new Scene(document.getElementById('canvas-wrap'));
const controller = new NeuralController();
const audio = new AudioFeatures();
const ui = new UI3D(sceneObj.scene, sceneObj.camera, sceneObj.renderer.domElement);

let micMode = false;
let frozen = false;
let burstUntil = 0;
let narrate = false;
let isRecording = false;
let recorder = null;
let lastNarrateAt = 0;
let fps = 0;

const snapshots = [];
const cursor = { x: 0, y: 0, vx: 0, vy: 0, px: 0, py: 0 };

window.addEventListener('mousemove', (e) => {
  const nx = (e.clientX / window.innerWidth) * 2 - 1;
  const ny = (e.clientY / window.innerHeight) * 2 - 1;
  cursor.vx = nx - cursor.px;
  cursor.vy = ny - cursor.py;
  cursor.px = nx;
  cursor.py = ny;
  cursor.x = nx;
  cursor.y = ny;
});

window.addEventListener('wheel', (e) => {
  sceneObj.cameraTargetZ = Math.min(11, Math.max(3.5,
    sceneObj.cameraTargetZ + e.deltaY * 0.003));
}, { passive: true });

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { burstUntil = performance.now() + 700; e.preventDefault(); }
  if (e.key === 'Shift') frozen = true;
  if (e.key === 's' || e.key === 'S') takeSnapshot();
});
window.addEventListener('keyup', (e) => { if (e.key === 'Shift') frozen = false; });

function showError(msg) {
  errBox.textContent = msg;
  errBox.style.display = 'block';
}

(async () => {
  await controller.init('/controller.onnx');
  backendHint.textContent = 'inference: ' + controller.backend;
  loadingEl.textContent = controller.ready
    ? 'model loaded (' + controller.backend + ')'
    : 'model failed - check console';
  btnMic.disabled = false;
  btnNoMic.disabled = false;
  recordBtn.disabled = false;
  narrateBtn.disabled = false;
})();

async function begin(withMic) {
  if (withMic) {
    try {
      await audio.start();
      micMode = true;
    } catch (err) {
      showError('Mic access denied - cursor input only.');
      micMode = false;
    }
  }
  gate.classList.add('hidden');
  requestAnimationFrame(loop);
}
btnMic.addEventListener('click', () => begin(true));
btnNoMic.addEventListener('click', () => begin(false));

recordBtn.addEventListener('click', async () => {
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
    recordBtn.textContent = '\u25A0 Stop';
    recordBtn.style.borderColor = '#ff4444';
    recordBtn.style.color = '#ff4444';
    ui.setButtonActive('record', true);
    ui.setButtonLabel('record', '\u25A0 Stop');
  } else {
    await recorder.stop();
    isRecording = false;
    recordBtn.textContent = '\u25CF Record';
    recordBtn.style.borderColor = '';
    recordBtn.style.color = '';
    ui.setButtonActive('record', false);
    ui.setButtonLabel('record', '\u25CF Record');
  }
});

narrateBtn.addEventListener('click', () => {
  narrate = !narrate;
  narrateBtn.textContent = narrate ? '\u25C9 Narrating' : '\u25CB Narrate';
  narrateBtn.style.borderColor = narrate ? '#5EEAD4' : '';
  narrateBtn.style.color = narrate ? '#5EEAD4' : '';
  ui.setButtonActive('narrate', narrate);
  ui.setButtonLabel('narrate', narrate ? '\u25C9 Narrating' : '\u25CB Narrate');
  if (!narrate) speechSynthesis.cancel();
});

ui.onClick(ui.buttons.find(b => b.userData.id === 'record'), () => recordBtn.click());
ui.onClick(ui.buttons.find(b => b.userData.id === 'narrate'), () => narrateBtn.click());
ui.onClick(ui.buttons.find(b => b.userData.id === 'snapshot'), () => takeSnapshot());

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
  const utter = new SpeechSynthesisUtterance(line);
  utter.rate = 1.15;
  utter.pitch = 0.8 + latent[10] * 0.4;
  utter.volume = 0.8;
  speechSynthesis.speak(utter);
}

function takeSnapshot() {
  snapshots.push({
    latent: new Float32Array(controller.prevOut),
    hue: (controller.prevOut[9] + 1) / 2,
  });
  renderGallery();
  ui.setSnapshots(snapshots, (snap) => {
    controller.prevOut.set(snap.latent);
  });
}

function renderGallery() {
  galleryEl.innerHTML = '';
  snapshots.slice(-8).forEach((snap, i) => {
    const div = document.createElement('div');
    div.className = 'snap';
    div.style.background = 'hsl(' + (snap.hue * 360) + ', 65%, 50%)';
    div.title = 'Snapshot ' + (i + 1);
    div.onclick = () => { controller.prevOut.set(snap.latent); };
    galleryEl.appendChild(div);
  });
}

let last = performance.now();
let fpsAccum = 0, fpsCount = 0;
const input16 = new Float32Array(16);

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

  ui.update(now * 0.001);

  if (frozen) {
    sceneObj.update(controller.prevOut, 0, 0, false);
    return;
  }

  let affect = [0, 0, 0, 0];
  let raw = [0, 0, 0, 0, 0];
  let onset = 0, rms = 0;

  if (micMode) {
    const f = audio.read();
    if (f) { affect = f.affect; raw = f.raw; onset = f.onset; rms = f.rms; }
  } else {
    const speed = Math.min(1, Math.hypot(cursor.vx, cursor.vy) * 12);
    affect = [(cursor.x + 1) / 2, speed, Math.abs(cursor.vy) * 3, Math.abs(cursor.vx) * 3];
    raw = [(cursor.y + 1) / 2, speed, speed, speed, 0.3];
    onset = speed > 0.6 ? 1 : 0;
  }

  const burst = performance.now() < burstUntil;
  const t = now * 0.001;

  input16.set([
    affect[0], affect[1], affect[2], affect[3],
    raw[0], raw[1], raw[2], raw[3], raw[4],
    cursor.x, cursor.y, Math.min(1, Math.hypot(cursor.vx, cursor.vy) * 10),
    burst ? 1 : 0,
    Math.sin(t * 0.1), Math.cos(t * 0.1),
    onset,
  ]);

  const latent = controller.forward(input16);
  sceneObj.update(latent, dt, onset, burst);
  maybeNarrate(latent, affect, now);

  ui.updateHud({
    valence: affect[0], arousal: affect[1],
    tension: affect[2], density: affect[3],
    rms, onset,
    infer: controller.lastInferenceMs(),
    fps,
    backend: controller.backend,
  });

  document.getElementById('r-valence').textContent = affect[0].toFixed(2);
  document.getElementById('r-arousal').textContent = affect[1].toFixed(2);
  document.getElementById('r-tension').textContent = affect[2].toFixed(2);
  document.getElementById('r-density').textContent = affect[3].toFixed(2);
  document.getElementById('r-rms').textContent = rms.toFixed(3);
  document.getElementById('r-onset').textContent = onset > 0.5 ? 'triggered' : '-';
  document.getElementById('r-infer').textContent = controller.lastInferenceMs().toFixed(2) + ' ms';
}
