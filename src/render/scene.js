import * as THREE from 'three';

const NOISE_GLSL = `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(
    i.z+vec4(0.0,i1.z,i2.z,1.0))
    +i.y+vec4(0.0,i1.y,i2.y,1.0))
    +i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

const VERT = NOISE_GLSL + `
uniform float uTime;
uniform float uRms;         // 0..1 loudness (primary driver)
uniform float uCentroid;    // 0..1 brightness
uniform float uOnset;       // 0..1 impulse
uniform float uHue;         // 0..1 color

varying vec3 vNormal;
varying float vDisp;
varying vec3 vWorldPos;

void main() {
  vNormal = normal;

  // Amplify RMS hard. Even a whisper reaches 0.3 here.
  float amp = 0.15 + uRms * 2.8 + uOnset * 0.5;

  // Frequency of noise reacts to brightness.
  float freq = 0.8 + uCentroid * 3.0;

  // Three octaves of noise, phase-shifted by time and onset.
  float n = snoise(position * freq + vec3(uTime * 0.4, uTime * 0.3, uOnset * 2.0));
  n += 0.5 * snoise(position * freq * 2.3 + vec3(uTime * 0.7));
  n += 0.25 * snoise(position * freq * 5.1 + vec3(uTime * 1.1));

  float disp = n * amp;
  vDisp = disp;

  vec3 newPos = position + normal * disp;
  vec4 wp = modelMatrix * vec4(newPos, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = `
uniform float uHue;
uniform float uRms;
uniform float uOnset;
uniform float uTime;
varying vec3 vNormal;
varying float vDisp;
varying vec3 vWorldPos;

vec3 hsl2rgb(vec3 c){
  vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0);
  return c.z + c.y*(rgb-0.5)*(1.0-abs(2.0*c.z-1.0));
}

void main() {
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float fres = pow(1.0 - max(dot(normalize(vNormal), viewDir), 0.0), 2.0);

  // Hue shifts with RMS — louder means warmer
  float hue = fract(uHue + vDisp * 0.4 + uRms * 0.3);
  // Saturation rises with loudness
  float sat = 0.4 + uRms * 0.5;
  // Brightness rises with displacement
  float light = 0.35 + abs(vDisp) * 2.5 + uRms * 0.6 + uOnset * 0.4;

  vec3 base = hsl2rgb(vec3(hue, sat, clamp(light, 0.05, 0.95)));
  vec3 glow = hsl2rgb(vec3(fract(hue + 0.5), 0.9, 0.6)) * fres * (1.0 + uOnset * 3.0);

  gl_FragColor = vec4(base + glow, 1.0);
}`;

export class Scene {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x0b0e14, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      55, window.innerWidth / window.innerHeight, 0.1, 100
    );
    this.camera.position.set(0, 0, 6.2);
    this.cameraTargetZ = 6.2;

    const detail = window.innerWidth < 700 ? 5 : 7;
    const geo = new THREE.IcosahedronGeometry(1.4, detail);

    this.uniforms = {
      uTime:     { value: 0 },
      uRms:      { value: 0 },
      uCentroid: { value: 0 },
      uOnset:    { value: 0 },
      uHue:      { value: 0.55 },
    };

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.mesh);

    const COUNT = window.innerWidth < 700 ? 1200 : 3500;
    const positions = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      const r = 2.2 + Math.random() * 1.8;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const pMat = new THREE.PointsMaterial({
      color: 0xff7a45, size: 0.025, transparent: true,
      opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.particles = new THREE.Points(pGeo, pMat);
    this.scene.add(this.particles);
    this.particlePositions = positions;

    window.addEventListener('resize', () => this.onResize());
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // Direct drive: pass raw audio scalars straight in.
  setAudio(rms, centroid, onset, hue) {
    this.uniforms.uRms.value = rms;
    this.uniforms.uCentroid.value = centroid;
    this.uniforms.uOnset.value = onset;
    this.uniforms.uHue.value = hue;
  }

  update(dt, burst) {
    const u = this.uniforms;
    u.uTime.value += dt;

    const pos = this.particlePositions;
    const speed = 1.0 + u.uRms.value * 6.0;
    for (let i = 0; i < pos.length; i += 3) {
      const t = u.uTime.value + i * 0.001;
      let vx = Math.sin(t * 0.7) * 0.005 * speed;
      let vy = Math.cos(t * 0.5) * 0.005 * speed;
      let vz = Math.sin(t * 0.3) * 0.005 * speed;
      if (burst) { vx *= 10; vy *= 10; vz *= 10; }
      pos[i] += vx; pos[i + 1] += vy; pos[i + 2] += vz;
      const d = Math.hypot(pos[i], pos[i + 1], pos[i + 2]);
      if (d > 5 || d < 1.6) {
        pos[i] *= 0.97; pos[i + 1] *= 0.97; pos[i + 2] *= 0.97;
      }
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
    this.mesh.rotation.y += dt * 0.05;
    this.mesh.rotation.x += dt * 0.015;
    this.camera.position.z += (this.cameraTargetZ - this.camera.position.z) * 0.05;
    this.renderer.render(this.scene, this.camera);
  }
}
