export class AudioFeatures {
  constructor() {
    this.ready = false;
    this.ctx = null;
    this.analyser = null;
    this.timeDomain = null;
    this.freqDomain = null;
    this.prevRMS = 0;
    this.onset = 0;
    this.smoothed = { centroid: 0, rolloff: 0, zcr: 0, rms: 0, pitch: 0 };
    this.affect = { valence: 0, arousal: 0, tension: 0, density: 0 };
  }
  async start() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const source = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0;
    source.connect(this.analyser);
    this.timeDomain = new Float32Array(this.analyser.fftSize);
    this.freqDomain = new Uint8Array(this.analyser.frequencyBinCount);
    this.ready = true;
  }
  _estimatePitch(buf, sampleRate) {
    const SIZE = buf.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return 0;
    let r1 = 0, r2 = SIZE - 1;
    for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buf[i]) < 0.2) { r1 = i; break; }
    for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buf[SIZE - i]) < 0.2) { r2 = SIZE - i; break; }
    const trimmed = buf.slice(r1, r2);
    const n = trimmed.length;
    if (n < 128) return 0;
    const c = new Float32Array(n);
    for (let lag = 0; lag < n; lag++) {
      let sum = 0;
      for (let i = 0; i < n - lag; i++) sum += trimmed[i] * trimmed[i + lag];
      c[lag] = sum;
    }
    let d = 0;
    while (d < n - 1 && c[d] > c[d + 1]) d++;
    let maxVal = -1, maxPos = -1;
    for (let i = d; i < n; i++) if (c[i] > maxVal) { maxVal = c[i]; maxPos = i; }
    if (maxPos <= 0) return 0;
    return sampleRate / maxPos;
  }
  read() {
    if (!this.ready) return null;
    this.analyser.getFloatTimeDomainData(this.timeDomain);
    this.analyser.getByteFrequencyData(this.freqDomain);
    const bins = this.freqDomain.length;
    const nyquist = this.ctx.sampleRate / 2;
    let num = 0, den = 0;
    for (let i = 0; i < bins; i++) {
      const mag = this.freqDomain[i] / 255;
      num += ((i / bins) * nyquist) * mag;
      den += mag;
    }
    const centroid = den > 0 ? num / den : 0;
    let total = 0;
    for (let i = 0; i < bins; i++) total += this.freqDomain[i];
    let cum = 0, rolloffBin = 0;
    for (let i = 0; i < bins; i++) {
      cum += this.freqDomain[i];
      if (cum >= total * 0.85) { rolloffBin = i; break; }
    }
    const rolloff = (rolloffBin / bins) * nyquist;
    let zc = 0;
    for (let i = 1; i < this.timeDomain.length; i++) {
      if ((this.timeDomain[i] >= 0) !== (this.timeDomain[i - 1] >= 0)) zc++;
    }
    const zcr = zc / this.timeDomain.length;
    let rmsSum = 0;
    for (let i = 0; i < this.timeDomain.length; i++) rmsSum += this.timeDomain[i] ** 2;
    const rms = Math.sqrt(rmsSum / this.timeDomain.length);
    this.onset = Math.max(0, rms - this.prevRMS) > 0.045 ? 1 : this.onset * 0.85;
    this.prevRMS = rms;
    const pitch = this._estimatePitch(this.timeDomain, this.ctx.sampleRate);
    const a = 0.3;
    const s = this.smoothed;
    s.centroid = a * centroid + (1 - a) * s.centroid;
    s.rolloff  = a * rolloff  + (1 - a) * s.rolloff;
    s.zcr      = a * zcr      + (1 - a) * s.zcr;
    s.rms      = a * rms      + (1 - a) * s.rms;
    s.pitch    = a * pitch    + (1 - a) * s.pitch;
    const centroidN = Math.min(1, s.centroid / 4000);
    const rolloffN  = Math.min(1, s.rolloff / 8000);
    const zcrN      = Math.min(1, s.zcr * 4);
    const rmsN      = Math.min(1, s.rms * 6);
    const pitchN    = Math.min(1, s.pitch / 500);
    this.affect.valence = 0.5 * pitchN + 0.5 * centroidN;
    this.affect.arousal = 0.6 * rmsN + 0.4 * this.onset;
    this.affect.tension = 1 - Math.min(1, s.rolloff > 0 ? s.centroid / s.rolloff : 0);
    this.affect.density = zcrN;
    return {
      raw: [centroidN, rolloffN, zcrN, rmsN, pitchN],
      affect: [this.affect.valence, this.affect.arousal, this.affect.tension, this.affect.density],
      onset: this.onset,
      rms: s.rms,
    };
  }
}
