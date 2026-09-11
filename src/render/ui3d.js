import * as THREE from 'three';

export class UI3D {
  constructor(scene, camera, domElement) {
    this.scene = scene;
    this.camera = camera;
    this.dom = domElement;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(-2, -2);
    this.hovered = null;
    this.clickHandlers = new Map();

    this._buildHudPanel();
    this._buildControlButtons();
    this._buildSnapshotRing();
    this._buildFloor();

    this.dom.addEventListener('mousemove', (e) => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });
    this.dom.addEventListener('click', () => {
      if (this.hovered && this.clickHandlers.has(this.hovered)) {
        this.clickHandlers.get(this.hovered)();
      }
    });
  }

  onClick(obj, fn) { this.clickHandlers.set(obj, fn); }

  _buildHudPanel() {
    const W = 512, H = 256;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    this.hudCtx = canvas.getContext('2d');
    this.hudTex = new THREE.CanvasTexture(canvas);
    this.hudTex.minFilter = THREE.LinearFilter;
    this.hudTex.magFilter = THREE.LinearFilter;

    const geo = new THREE.PlaneGeometry(6.4, 3.2);
    const mat = new THREE.MeshBasicMaterial({
      map: this.hudTex, transparent: true, opacity: 0.85,
      depthWrite: false, side: THREE.DoubleSide,
    });
    this.hud = new THREE.Mesh(geo, mat);
    this.hud.position.set(0, 0, -3.4);
    this.hud.renderOrder = -1;
    this.scene.add(this.hud);

    this._drawHud({ valence: 0, arousal: 0, tension: 0, density: 0,
      rms: 0, onset: 0, infer: 0, fps: 0, backend: 'loading' });
  }

  _drawHud(data) {
    const c = this.hudCtx;
    const W = 512, H = 256;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(11, 14, 20, 0.55)';
    this._roundRect(c, 8, 8, W - 16, H - 16, 14);
    c.fill();
    c.strokeStyle = 'rgba(255, 122, 69, 0.35)';
    c.lineWidth = 1.5;
    this._roundRect(c, 8, 8, W - 16, H - 16, 14);
    c.stroke();
    c.fillStyle = 'rgba(255, 122, 69, 1)';
    c.font = 'bold 13px ui-monospace, monospace';
    c.fillText('AUDIO \u2192 LATENT', 28, 40);
    const rows = [
      ['valence', data.valence.toFixed(2)],
      ['arousal', data.arousal.toFixed(2)],
      ['tension', data.tension.toFixed(2)],
      ['density', data.density.toFixed(2)],
      ['rms',     data.rms.toFixed(3)],
      ['onset',   data.onset > 0.5 ? 'triggered' : '\u2013'],
      ['infer',   data.infer.toFixed(2) + ' ms'],
      ['fps',     data.fps.toFixed(1)],
    ];
    c.font = '12px ui-monospace, monospace';
    const colW = (W - 56) / 2;
    rows.forEach((row, i) => {
      const col = Math.floor(i / 4);
      const rowIdx = i % 4;
      const x = 28 + col * colW;
      const y = 70 + rowIdx * 28;
      c.fillStyle = 'rgba(122, 130, 144, 1)';
      c.fillText(row[0], x, y);
      c.fillStyle = 'rgba(232, 230, 225, 1)';
      c.fillText(row[1], x + colW * 0.55, y);
    });
    c.fillStyle = 'rgba(94, 234, 212, 0.9)';
    c.font = '11px ui-monospace, monospace';
    c.fillText('backend: ' + data.backend, 28, H - 24);
    this.hudTex.needsUpdate = true;
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  updateHud(data) { this._drawHud(data); }

  _buildControlButtons() {
    this.buttons = [];
    const defs = [
      { id: 'record',   label: '\u25CF Record',   x: -2.2 },
      { id: 'narrate',  label: '\u25CB Narrate',  x:  0.0 },
      { id: 'snapshot', label: '\u25A0 Snapshot', x:  2.2 },
    ];
    for (const def of defs) {
      const W = 256, H = 64;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      const tex = new THREE.CanvasTexture(canvas);
      tex.minFilter = THREE.LinearFilter;
      const geo = new THREE.PlaneGeometry(1.5, 0.375);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(def.x, -2.6, 1.6);
      mesh.userData = { id: def.id, canvas, ctx, tex, label: def.label, active: false };
      this.scene.add(mesh);
      this.buttons.push(mesh);
      this._drawButton(mesh, false);
    }
  }

  _drawButton(mesh, hovered) {
    const { canvas, ctx, tex, label, active } = mesh.userData;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const borderColor = active ? '#5EEAD4' : (hovered ? '#FF7A45' : 'rgba(255,255,255,0.28)');
    const textColor   = active ? '#5EEAD4' : (hovered ? '#FF7A45' : '#E8E6E1');
    const bgColor     = hovered || active ? 'rgba(255,122,69,0.08)' : 'rgba(18,22,32,0.55)';
    ctx.fillStyle = bgColor;
    this._roundRect(ctx, 4, 4, W - 8, H - 8, 12);
    ctx.fill();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2;
    this._roundRect(ctx, 4, 4, W - 8, H - 8, 12);
    ctx.stroke();
    ctx.fillStyle = textColor;
    ctx.font = 'bold 20px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, W / 2, H / 2);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
    tex.needsUpdate = true;
  }

  setButtonActive(id, active) {
    for (const btn of this.buttons) {
      if (btn.userData.id === id) {
        btn.userData.active = active;
        this._drawButton(btn, this.hovered === btn);
      }
    }
  }

  setButtonLabel(id, label) {
    for (const btn of this.buttons) {
      if (btn.userData.id === id) {
        btn.userData.label = label;
        this._drawButton(btn, this.hovered === btn);
      }
    }
  }

  _buildSnapshotRing() {
    this.snapshotGroup = new THREE.Group();
    this.scene.add(this.snapshotGroup);
    this.snapMeshes = [];
  }

  setSnapshots(snaps, onPick) {
    while (this.snapshotGroup.children.length) {
      const m = this.snapshotGroup.children.pop();
      m.geometry.dispose();
      m.material.dispose();
    }
    this.snapMeshes = [];
    const count = snaps.length;
    snaps.forEach((snap, i) => {
      const geo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
      const col = new THREE.Color().setHSL(snap.hue, 0.65, 0.5);
      const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.angle = (i / Math.max(count, 8)) * Math.PI * 2;
      this.snapshotGroup.add(mesh);
      this.snapMeshes.push(mesh);
      this.onClick(mesh, () => onPick(snap));
    });
  }

  _buildFloor() {
    const grid = new THREE.GridHelper(20, 40, 0x3a6cb8, 0x1a2a4a);
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    grid.position.y = -3.0;
    this.floor = grid;
    this.scene.add(grid);
  }

  update(t) {
    const ringR = 2.4;
    this.snapMeshes.forEach((m) => {
      const a = m.userData.angle + t * 0.2;
      m.position.set(Math.cos(a) * ringR, Math.sin(a * 0.5) * 0.4 + 0.2, Math.sin(a) * ringR);
      m.rotation.x = t * 0.5;
      m.rotation.y = t * 0.7;
    });
    this.floor.rotation.y = t * 0.02;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const targets = [...this.buttons, ...this.snapMeshes];
    const hits = this.raycaster.intersectObjects(targets);
    const newHovered = hits.length > 0 ? hits[0].object : null;
    if (newHovered !== this.hovered) {
      const old = this.hovered;
      this.hovered = newHovered;
      if (old && old.userData.id) this._drawButton(old, false);
      if (newHovered && newHovered.userData.id) this._drawButton(newHovered, true);
      this.dom.style.cursor = newHovered ? 'pointer' : 'default';
    }
  }
}
