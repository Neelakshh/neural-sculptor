import * as ort from 'onnxruntime-web';

export class NeuralController {
  constructor(inDim = 16, outDim = 32) {
    this.inDim = inDim;
    this.outDim = outDim;
    this.session = null;
    this.ready = false;
    this.prevOut = new Float32Array(outDim);
    this.inertia = 0.82;
    this._pending = false;
    this._lastInferenceMs = 0;
    this.backend = 'unloaded';
  }
  async init(modelUrl = '/controller.onnx') {
    try {
      ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 2);
      ort.env.wasm.simd = true;
      const eps = [];
      if (typeof navigator !== 'undefined' && 'gpu' in navigator) eps.push('webgpu');
      eps.push('wasm');
      this.session = await ort.InferenceSession.create(modelUrl, { executionProviders: eps });
      this.backend = (this.session.executionProviders && this.session.executionProviders[0]) || eps[0];
      this.ready = true;
    } catch (err) {
      console.warn('[controller] ONNX init failed:', err);
      this.ready = false;
      this.backend = 'fallback (zero latent)';
    }
    return this;
  }
  lastInferenceMs() { return this._lastInferenceMs; }
  forward(input16) {
    if (!this.ready) return this.prevOut;
    const inputData = new Float32Array(this.inDim);
    inputData.set(input16);
    if (!this._pending) {
      this._pending = true;
      const tensor = new ort.Tensor('float32', inputData, [1, this.inDim]);
      const t0 = performance.now();
      this.session.run({ input: tensor }).then((out) => {
        const data = out.latent.data;
        for (let i = 0; i < this.outDim; i++) {
          this.prevOut[i] = this.inertia * this.prevOut[i] + (1 - this.inertia) * data[i];
        }
        this._lastInferenceMs = performance.now() - t0;
      }).catch((e) => {
        console.error('[controller] run failed:', e);
        this.ready = false;
      }).finally(() => {
        this._pending = false;
      });
    }
    return this.prevOut;
  }
}
