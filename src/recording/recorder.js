export class Recorder {
  constructor(canvas, audioStream) {
    this.canvas = canvas;
    this.audioStream = audioStream;
    this.recorder = null;
    this.chunks = [];
  }
  start() {
    const stream = this.canvas.captureStream(60);
    if (this.audioStream) {
      this.audioStream.getAudioTracks().forEach((t) => stream.addTrack(t));
    }
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9' : 'video/webm';
    this.recorder = new MediaRecorder(stream, {
      mimeType: mime, videoBitsPerSecond: 8000000,
    });
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(1000);
  }
  stop() {
    return new Promise((resolve) => {
      this.recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'neural-sculptor-' + Date.now() + '.webm';
        a.click();
        resolve(blob);
      };
      this.recorder.stop();
    });
  }
}
