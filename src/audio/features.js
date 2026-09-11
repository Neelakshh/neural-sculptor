// Audio features with EXTREME sensitivity. If your voice produces any
// nonzero mic signal at all, the affect values will reach 1.0.

const RESPONSE_GAIN = 40;   // crank this up if still not moving
const NOISE_FLOOR   = 0.002;

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
    this.lastRMS = 0;
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
    console.log('[audio] started @', this.ctx.sampleRate);
  }

  read() {
    if (!this.ready) return null;
    this.analyser.getFloatTimeDomainData(this.timeDomain);
    this.analyser.getByteFrequencyData(this.freqDomain);

    // --- RMS energy: this is the primary driver ---
    let rmsSum = 0;
    for (let i = 0; i < this.timeDomain.length; i++) {
      rmsSum += this.timeDomain[i] * this.timeDomain[i];
    }
    const rms = Math.sqrt(rmsSum / this.timeDomain.length);
    this.lastRMS = rms;

    // --- spectral centroid (brightness) ---
    const bins = this.freqDomain.length;
    let num = 0, den = 0;
    for (let i = 0; i < bins; i++) {
      const mag = this.freqDomain[i] / 255;
      num += i * mag;
      den += mag;
    }
    const centroid01 = den > 0 ? (num / den) / bins : 0;

    // --- zero-crossing rate (noisiness) ---
    let zc = 0;
    for (let i = 1; i < this.timeDomain.length; i++) {
      if ((this.timeDomain[i] >= 0) !== (this.timeDomain[i - 1] >= 0)) zc++;
    }
    const zcr01 = Math.min(1, (zc / this.timeDomain.length) * 20);

    // --- onset detection ---
    const jump = rms - this.prevRMS;
    this.onset = jump > NOISE_FLOOR ? 1 : this.onset * 0.85;
    this.prevRMS = rms;

    // --- AGGRESSIVE gain applied here ---
    // If rms is 0.02 (normal speech), rmsN becomes 0.02 * 40 = 0.8
    const rmsN      = Math.min(1, Math.max(0, (rms - NOISE_FLOOR) * RESPONSE_GAIN));
    const centroidN = Math.min(1, centroid01 * 4);
    const zcrN      = zcr01;

    // affect vector — this is what drives the scene
    this.affect.valence = Math.min(1, 0.5 * rmsN + 0.5 * centroidN);
    this.affect.arousal = Math.min(1, 0.7 * rmsN + 0.3 * this.onset);
    this.affect.tension = zcrN;
    this.affect.density = Math.min(1, rmsN * 0.5 + zcrN * 0.5);

    return {
      raw: [rmsN, centroidN, zcrN, rmsN, 0],
      affect: [
        this.affect.valence,
        this.affect.arousal,
        this.affect.tension,
        this.affect.density,
      ],
      onset: this.onset,
      rms,
    };
  }
}
