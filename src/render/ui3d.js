import * as THREE from 'three';

// Full 3D UI. Nothing HTML. Everything lives inside the Three.js scene.
// Components:
//   - ControlRing: torus of glowing segments around the sculpture
//   - StatusOrb: small glowing sphere that encodes live energy
//   - ValuePanel: curved glass panel with live metrics
//   - SnapCarousel: cubes orbiting the ring
//   - GridFloor: reflective grid with audio ripples

export class UI3D {
  constructor(scene, camera, domElement) {
    this.scene = scene;
    this.camera = camera;
    this.dom = domElement;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(-2, -2);
    this.hovered = null;
    this.clickHandlers = new Map();
    this.t = 0;

    this._buildControlRing();
    this._buildStatusOrb();
    this._buildValuePanel();
    this._buildSnapCarousel();
    this._buildGridFloor();

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

  // =====================================================================
  // CONTROL RING — a torus made of N segments around the sculpture.
  // Each segment is a clickable control.
  // =====================================================================
  _buildControlRing() {
    this.ringGroup = new THREE.Group();
    this.ringGroup.position.y = -0.15;
    this.scene.add(this.ringGroup);

    const segs = [
      { id: 'record',   label: 'REC',  hue: 0.98 },
      { id: 'narrate',  label: 'NARR', hue: 0.45 },
      { id: 'snapshot', label: 'SNAP', hue: 0.08 },
      { id: 'burst',    label: 'BURST',hue: 0.60 },
      { id: 'reset',    label: 'RESET',hue: 0.75 },
    ];
    const R = 2.6;
    const segGeo = new THREE.BoxGeometry(0.42, 0.06, 0.3);
    const N = segs.length;

    this.ringSegments = [];
    segs.forEach((seg, i) => {
      const angle = (i / N) * Math.PI * 2 - Math.PI / 2;
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(seg.hue, 0.7, 0.4),
        emissive: new THREE.Color().setHSL(seg.hue, 0.9, 0.2),
        emissiveIntensity: 0.3,
        metalness: 0.6,
        roughness: 0.3,
        transparent: true,
        opacity: 0.9,
      });
      const mesh = new THREE.Mesh(segGeo, mat);
      mesh.position.set(Math.cos(angle) * R, 0, Math.sin(angle) * R);
      mesh.lookAt(0, 0, 0);
      mesh.userData = { id: seg.id, hue: seg.hue, active: false, angle };

      // invisible bigger hitbox so hover is easy
      const hitGeo = new THREE.BoxGeometry(0.75, 0.4, 0.6);
      const hitMat = new THREE.MeshBasicMaterial({ visible: false });
      const hit = new THREE.Mesh(hitGeo, hitMat);
      hit.userData = { parent: mesh };
      mesh.add(hit);

      this.ringGroup.add(mesh);
      this.ringSegments.push(mesh);

      // label sprite
      const label = this._makeTextSprite(seg.label, seg.hue);
      label.position.set(Math.cos(angle) * R * 1.35, 0.05, Math.sin(angle) * R * 1.35);
      this.ringGroup.add(label);
    });

    this.ringGroup.rotation.y = 0;
  }

  _makeTextSprite(text, hue) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = `hsl(${hue * 360}, 80%, 65%)`;
    ctx.font = 'bold 28px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.5, 0.125, 1);
    return sprite;
  }

  setRingActive(id, active) {
    this.ringSegments.forEach((s) => {
      if (s.userData.id === id) {
        s.userData.active = active;
        s.material.emissiveIntensity = active ? 1.2 : 0.3;
        s.scale.setScalar(active ? 1.15 : 1.0);
      }
    });
  }

  // =====================================================================
  // STATUS ORB — small glowing sphere that orbits the sculpture,
  // size and brightness encode live energy.
  // =====================================================================
  _buildStatusOrb() {
    const geo = new THREE.SphereGeometry(0.12, 24, 24);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x5EEAD4,
      emissive: 0x5EEAD4,
      emissiveIntensity: 1.2,
      metalness: 0.7,
      roughness: 0.2,
    });
    this.statusOrb = new THREE.Mesh(geo, mat);
    this.statusOrb.position.set(2.2, 1.4, 0);
    this.scene.add(this.statusOrb);

    // glow halo
    const haloGeo = new THREE.SphereGeometry(0.28, 24, 24);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x5EEAD4,
      transparent: true,
      opacity: 0.15,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.statusHalo = new THREE.Mesh(haloGeo, haloMat);
    this.statusOrb.add(this.statusHalo);
  }

  // =====================================================================
  // VALUE PANEL — curved glass panel with live metrics on the side.
  // =====================================================================
  _buildValuePanel() {
    const W = 512, H = 320;
    this.panelCanvas = document.createElement('canvas');
    this.panelCanvas.width = W;
    this.panelCanvas.height = H;
    this.panelCtx = this.panelCanvas.getContext('2d');
    this.panelTex = new THREE.CanvasTexture(this.panelCanvas);
    this.panelTex.minFilter = THREE.LinearFilter;
    this.panelTex.magFilter = THREE.LinearFilter;

    const geo = new THREE.PlaneGeometry(2.4, 1.5, 20, 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setZ(i, -Math.pow(x / 1.2, 2) * 0.25);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    const mat = new THREE.MeshBasicMaterial({
      map: this.panelTex,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      opacity: 0.92,
    });
    this.panel = new THREE.Mesh(geo, mat);
    this.panel.position.set(-3.2, 0.3, 0.4);
    this.panel.rotation.y = 0.5;
    this.scene.add(this.panel);

    this._drawPanel({
      rms: 0, centroid: 0, onset: 0,
      valence: 0, arousal: 0, tension: 0, density: 0,
      fps: 0, backend: 'direct',
    });
  }

  _drawPanel(d) {
    const c = this.panelCtx;
    const W = 512, H = 320;
    c.clearRect(0, 0, W, H);

    // background glass
    const grad = c.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(20, 26, 40, 0.85)');
    grad.addColorStop(1, 'rgba(11, 14, 20, 0.7)');
    c.fillStyle = grad;
    this._roundRect(c, 8, 8, W - 16, H - 16, 16);
    c.fill();

    // border
    c.strokeStyle = 'rgba(255, 122, 69, 0.45)';
    c.lineWidth = 1.5;
    this._roundRect(c, 8, 8, W - 16, H - 16, 16);
    c.stroke();

    // title
    c.fillStyle = 'rgba(255, 122, 69, 1)';
    c.font = 'bold 14px ui-monospace, monospace';
    c.fillText('NEURAL SCULPTOR', 28, 42);

    // subtitle
    c.fillStyle = 'rgba(122, 130, 144, 1)';
    c.font = '11px ui-monospace, monospace';
    c.fillText('direct drive · ' + d.backend, 28, 60);

    // metric bars
    const bars = [
      ['rms',     d.rms,     0xff7a45],
      ['centroid',d.centroid,0x5eead4],
      ['onset',   d.onset,   0xffd166],
      ['valence', d.valence, 0xa78bfa],
    ];
    const barW = 380, barH = 10;
    bars.forEach((b, i) => {
      const y = 100 + i * 34;
      c.fillStyle = 'rgba(122, 130, 144, 1)';
      c.font = '12px ui-monospace, monospace';
      c.fillText(b[0], 28, y + 9);

      // bg
      c.fillStyle = 'rgba(255,255,255,0.06)';
      this._roundRect(c, 120, y, barW, barH, 5);
      c.fill();

      // value
      const v = Math.max(0, Math.min(1, b[1]));
      const col = '#' + b[2].toString(16).padStart(6, '0');
      c.fillStyle = col;
      this._roundRect(c, 120, y, barW * v, barH, 5);
      c.fill();

      // number
      c.fillStyle = 'rgba(232, 230, 225, 1)';
      c.font = '11px ui-monospace, monospace';
      c.fillText(v.toFixed(2), 120 + barW + 10, y + 9);
    });

    // fps bottom right
    c.fillStyle = 'rgba(122, 130, 144, 0.9)';
    c.font = '11px ui-monospace, monospace';
    c.fillText(d.fps.toFixed(0) + ' fps', W - 88, H - 28);

    this.panelTex.needsUpdate = true;
  }

  _roundRect(ctx, x, y, w, h, r) {
    if (w < r * 2) r = w / 2;
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

  updatePanel(data) { this._drawPanel(data); }

  // =====================================================================
  // SNAP CAROUSEL — cubes orbiting the ring.
  // =====================================================================
  _buildSnapCarousel() {
    this.carousel = new THREE.Group();
    this.scene.add(this.carousel);
    this.snapMeshes = [];
  }

  setSnapshots(snaps, onPick) {
    while (this.carousel.children.length) {
      const m = this.carousel.children.pop();
      m.geometry.dispose();
      m.material.dispose();
    }
    this.snapMeshes = [];

    const count = snaps.length;
    snaps.forEach((snap, i) => {
      const geo = new THREE.BoxGeometry(0.24, 0.24, 0.24);
      const col = new THREE.Color().setHSL(snap.hue, 0.75, 0.55);
      const mat = new THREE.MeshStandardMaterial({
        color: col,
        emissive: col,
        emissiveIntensity: 0.5,
        metalness: 0.6,
        roughness: 0.25,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData = {
        angle: (i / Math.max(count, 1)) * Math.PI * 2,
        hue: snap.hue,
      };
      this.carousel.add(mesh);
      this.snapMeshes.push(mesh);
      this.onClick(mesh, () => onPick(snap));
    });
  }

  // =====================================================================
  // GRID FLOOR — reflective plane with ripples driven by audio.
  // =====================================================================
  _buildGridFloor() {
    const grid = new THREE.GridHelper(24, 60, 0x3a6cb8, 0x1a2a4a);
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    grid.position.y = -2.6;
    this.floor = grid;
    this.scene.add(grid);

    // ripple rings that expand on onset
    this.ripples = [];
    const rGeo = new THREE.RingGeometry(0.9, 1.0, 64);
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x5EEAD4, side: THREE.DoubleSide,
        transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(rGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = -2.59;
      mesh.visible = false;
      this.scene.add(mesh);
      this.ripples.push({ mesh, life: 0 });
    }
  }

  spawnFloorRipple() {
    const r = this.ripples.find((x) => !x.mesh.visible);
    if (!r) return;
    r.mesh.visible = true;
    r.mesh.scale.setScalar(0.5);
    r.mesh.material.opacity = 0.8;
    r.life = 0;
  }

  // =====================================================================
  // PER-FRAME
  // =====================================================================
  update(t, data) {
    this.t = t;

    // rotate ring
    this.ringGroup.rotation.y = t * 0.15;

    // hover detection
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this.ringSegments, true);
    let newHovered = null;
    if (hits.length > 0) {
      let obj = hits[0].object;
      while (obj && !this.ringSegments.includes(obj)) obj = obj.parent;
      if (obj) newHovered = obj;
    }
    // also snapshots
    const snapHits = this.raycaster.intersectObjects(this.snapMeshes);
    if (!newHovered && snapHits.length > 0) newHovered = snapHits[0].object;

    if (newHovered !== this.hovered) {
      const old = this.hovered;
      this.hovered = newHovered;

      if (old && old.userData.id) {
        old.material.emissiveIntensity = old.userData.active ? 1.2 : 0.3;
        old.scale.setScalar(old.userData.active ? 1.15 : 1.0);
      }
      if (newHovered && newHovered.userData.id) {
        newHovered.material.emissiveIntensity = 1.6;
        newHovered.scale.setScalar(1.15);
      }
      this.dom.style.cursor = newHovered ? 'pointer' : 'default';
    }

    // status orb orbit + reactive size/color
    const angle = t * 0.6;
    const r = 2.4 + data.rms * 0.3;
    this.statusOrb.position.set(
      Math.cos(angle) * r,
      1.2 + Math.sin(t * 1.3) * 0.3,
      Math.sin(angle) * r
    );
    const energy = Math.min(1, data.rms * 1.5);
    const s = 0.8 + energy * 1.4;
    this.statusOrb.scale.setScalar(s);
    const hue = (0.55 - energy * 0.4 + 1) % 1;
    const col = new THREE.Color().setHSL(hue, 0.85, 0.55);
    this.statusOrb.material.color.copy(col);
    this.statusOrb.material.emissive.copy(col);
    this.statusHalo.material.color.copy(col);
    this.statusHalo.material.opacity = 0.1 + energy * 0.25;

    // snap carousel
    const carR = 3.4;
    this.snapMeshes.forEach((m) => {
      const a = m.userData.angle - t * 0.25;
      m.position.set(Math.cos(a) * carR, 0.9 + Math.sin(t + a) * 0.15, Math.sin(a) * carR);
      m.rotation.x = t * 0.8;
      m.rotation.y = t * 1.1;
      // pulse on loudness
      const pulse = 1 + data.rms * 0.6;
      m.scale.setScalar(pulse);
    });

    // floor ripples
    this.ripples.forEach((r) => {
      if (!r.mesh.visible) return;
      r.life += 1 / 60;
      const life = r.life / 1.6;
      if (life >= 1) { r.mesh.visible = false; return; }
      r.mesh.scale.setScalar(0.5 + life * 6);
      r.mesh.material.opacity = 0.7 * (1 - life);
    });

    // rotate floor
    this.floor.rotation.y = t * 0.02;
  }

  // Called by main.js when audio onset crosses threshold
  triggerOnset() {
    this.spawnFloorRipple();
  }
}
