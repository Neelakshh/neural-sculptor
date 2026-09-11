import * as THREE from 'three';

// Visual response system: particle blast, shockwave rings, fragment chips.
// Driven by audio (rms, onset) and by user actions (Space).

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;

    // --- particle blast pool ---
    this.pMax = 2000;
    this.pPos = new Float32Array(this.pMax * 3);
    this.pVel = new Float32Array(this.pMax * 3);
    this.pLife = new Float32Array(this.pMax);
    this.pAlive = new Uint8Array(this.pMax);
    this.pColor = new Float32Array(this.pMax * 3);
    this.pCursor = 0;

    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(this.pColor, 3));

    const pMat = new THREE.PointsMaterial({
      size: 0.06,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.particles = new THREE.Points(pGeo, pMat);
    this.particles.frustumCulled = false;
    scene.add(this.particles);

    // hide all initially
    for (let i = 0; i < this.pMax; i++) this.pPos[i * 3 + 1] = 9999;

    // --- shockwave rings ---
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(1.0, 1.05, 64);
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff7a45,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.rings.push({ mesh, life: 0, maxLife: 1.2 });
    }

    // --- fragment chips (small tetrahedra) ---
    this.fragments = [];
    const chipGeo = new THREE.TetrahedronGeometry(0.12);
    for (let i = 0; i < 24; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x5EEAD4,
        transparent: true,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(chipGeo, mat);
      // scatter around the sphere
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 1.6;
      mesh.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      );
      mesh.visible = false;
      scene.add(mesh);
      this.fragments.push({
        mesh,
        home: mesh.position.clone(),
        vel: new THREE.Vector3(),
        state: 'idle',
        life: 0,
      });
    }

    this.lastOnset = 0;
  }

  // ---------- particle blast ----------
  blast(count, origin, speed, hueBase) {
    for (let i = 0; i < count; i++) {
      const idx = this.pCursor;
      this.pCursor = (this.pCursor + 1) % this.pMax;

      // spawn on sphere surface, radius 1.4
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 1.4;
      const sx = r * Math.sin(phi) * Math.cos(theta);
      const sy = r * Math.sin(phi) * Math.sin(theta);
      const sz = r * Math.cos(phi);

      // velocity outward + jitter
      const spd = speed * (0.5 + Math.random());
      const nx = sx / r, ny = sy / r, nz = sz / r;
      this.pPos[idx * 3]     = sx + (origin ? origin.x : 0);
      this.pPos[idx * 3 + 1] = sy + (origin ? origin.y : 0);
      this.pPos[idx * 3 + 2] = sz + (origin ? origin.z : 0);
      this.pVel[idx * 3]     = nx * spd + (Math.random() - 0.5) * 0.8;
      this.pVel[idx * 3 + 1] = ny * spd + (Math.random() - 0.5) * 0.8;
      this.pVel[idx * 3 + 2] = nz * spd + (Math.random() - 0.5) * 0.8;

      const hue = (hueBase + (Math.random() - 0.5) * 0.15) % 1;
      const col = new THREE.Color().setHSL((hue + 1) % 1, 0.85, 0.65);
      this.pColor[idx * 3]     = col.r;
      this.pColor[idx * 3 + 1] = col.g;
      this.pColor[idx * 3 + 2] = col.b;

      this.pLife[idx] = 1.0;
      this.pAlive[idx] = 1;
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
    this.particles.geometry.attributes.color.needsUpdate = true;
  }

  // ---------- shockwave ring ----------
  spawnRing(hue, maxR) {
    const r = this.rings.find(r => !r.mesh.visible);
    if (!r) return;
    const col = new THREE.Color().setHSL((hue + 1) % 1, 0.9, 0.65);
    r.mesh.material.color.copy(col);
    r.mesh.position.set(0, 0, 0);
    r.mesh.scale.setScalar(0.5);
    r.mesh.material.opacity = 0.9;
    r.mesh.visible = true;
    r.life = 0;
    r.maxR = maxR || 4.0;
  }

  // ---------- fragment shatter ----------
  shatter() {
    this.fragments.forEach((f, i) => {
      f.state = 'flying';
      f.life = 0;
      // give outward velocity from current position
      const p = f.mesh.position;
      const len = Math.max(0.5, p.length());
      f.vel.set(
        (p.x / len) * (1.5 + Math.random()),
        (p.y / len) * (1.5 + Math.random()),
        (p.z / len) * (1.5 + Math.random())
      );
      const col = new THREE.Color().setHSL(
        (0.55 + Math.random() * 0.3) % 1, 0.8, 0.6
      );
      f.mesh.material.color.copy(col);
      f.mesh.material.opacity = 0;
      f.mesh.visible = true;
      f.mesh.rotation.set(
        Math.random() * 3, Math.random() * 3, Math.random() * 3
      );
    });
  }

  // ---------- per-frame ----------
  update(dt, rms, onset, hue) {
    this.time += dt;

    // --- particles ---
    for (let i = 0; i < this.pMax; i++) {
      if (!this.pAlive[i]) continue;
      this.pLife[i] -= dt * 0.9;
      if (this.pLife[i] <= 0) {
        this.pAlive[i] = 0;
        this.pPos[i * 3 + 1] = 9999;
        continue;
      }
      // move
      this.pPos[i * 3]     += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      // gravity + drag
      this.pVel[i * 3 + 1] -= dt * 0.4;
      this.pVel[i * 3]     *= 1 - dt * 1.4;
      this.pVel[i * 3 + 1] *= 1 - dt * 1.4;
      this.pVel[i * 3 + 2] *= 1 - dt * 1.4;
    }
    this.particles.geometry.attributes.position.needsUpdate = true;

    // --- rings ---
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.life += dt;
      const t = r.life / r.maxLife;
      if (t >= 1) { r.mesh.visible = false; continue; }
      r.mesh.scale.setScalar(0.5 + t * (r.maxR || 4.0));
      r.mesh.material.opacity = 0.9 * (1 - t);
      r.mesh.lookAt(0, 0, 10); // face camera-ish
    }

    // --- fragments ---
    for (const f of this.fragments) {
      if (f.state === 'idle') continue;
      f.life += dt;
      if (f.state === 'flying') {
        f.mesh.position.addScaledVector(f.vel, dt);
        f.vel.multiplyScalar(1 - dt * 1.2);
        f.mesh.material.opacity = Math.min(1, f.life * 3);
        f.mesh.rotation.x += dt * 2;
        f.mesh.rotation.y += dt * 1.5;
        if (f.life > 1.0) {
          f.state = 'returning';
        }
      } else if (f.state === 'returning') {
        // spring back to home
        const toHome = f.home.clone().sub(f.mesh.position);
        f.vel.addScaledVector(toHome, dt * 6);
        f.vel.multiplyScalar(1 - dt * 3);
        f.mesh.position.addScaledVector(f.vel, dt);
        f.mesh.material.opacity = Math.max(0, 1 - f.life / 1.5);
        if (f.mesh.position.distanceTo(f.home) < 0.05) {
          f.state = 'idle';
          f.mesh.visible = false;
          f.mesh.material.opacity = 0;
          f.mesh.position.copy(f.home);
        }
      }
    }

    // --- automatic onset trigger ---
    // Every loud sound spawns a small ring + small particle burst.
    if (onset > 0.6 && this.lastOnset <= 0.3) {
      this.spawnRing(hue, 3.5);
      this.blast(40, null, 2.5, hue);
    }
    this.lastOnset = onset;
  }
}
