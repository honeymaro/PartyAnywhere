import { AudioFeatureExtractor } from './features';
import type { AudioFrame } from '../core/types';

/** Wraps an AudioContext + AnalyserNode over a MediaStream and produces AudioFrames. */
export class AudioAnalyser {
  private ctx: AudioContext;
  private source: MediaStreamAudioSourceNode;
  private analyser: AnalyserNode;
  private db: Float32Array<ArrayBuffer>;
  private features: AudioFeatureExtractor;

  constructor(stream: MediaStream) {
    this.ctx = new AudioContext();
    this.source = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    // 2048 points gives ~23 Hz bins at 48 kHz, enough to separate kick from bass.
    this.analyser.fftSize = 2048;
    // Light smoothing only: onset detection needs the transients; the feature extractor applies
    // its own attack/release smoothing to the values visualizers see.
    this.analyser.smoothingTimeConstant = 0.5;
    // Intentionally NOT connected to ctx.destination — we only analyze, never play back.
    this.source.connect(this.analyser);
    this.db = new Float32Array(this.analyser.frequencyBinCount);
    this.features = new AudioFeatureExtractor(this.ctx.sampleRate, this.analyser.fftSize);
  }

  /** Analyze the latest audio. `dt` is the seconds since the previous call (for smoothing). */
  frame(dt: number): AudioFrame {
    this.analyser.getFloatFrequencyData(this.db);
    // NOTE: the returned spectrum is a reused, per-frame buffer (not a snapshot). The sole
    // consumer is the render loop, which uploads it synchronously before the next frame() call.
    // Do not retain this reference across frames.
    return this.features.update(this.db, dt);
  }

  async resume(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  close(): void {
    this.source.disconnect();
    void this.ctx.close();
  }
}
