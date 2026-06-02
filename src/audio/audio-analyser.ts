import { computeBands } from './bands';
import { BeatDetector } from './beat';
import type { AudioFrame } from '../core/types';

/** Wraps an AudioContext + AnalyserNode over a MediaStream and produces AudioFrames. */
export class AudioAnalyser {
  private ctx: AudioContext;
  private source: MediaStreamAudioSourceNode;
  private analyser: AnalyserNode;
  private spectrum: Uint8Array<ArrayBuffer>;
  private beat = new BeatDetector();

  constructor(stream: MediaStream) {
    this.ctx = new AudioContext();
    this.source = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.8;
    // Intentionally NOT connected to ctx.destination — we only analyze, never play back.
    this.source.connect(this.analyser);
    this.spectrum = new Uint8Array(this.analyser.frequencyBinCount);
  }

  frame(): AudioFrame {
    this.analyser.getByteFrequencyData(this.spectrum);
    const bands = computeBands(this.spectrum);
    const beat = this.beat.update(bands.level);
    // NOTE: spectrum is a reused, per-frame buffer (not a snapshot). The sole consumer
    // is the render loop, which uploads it synchronously before the next frame() call.
    // Do not retain this reference across frames.
    return { spectrum: this.spectrum, bass: bands.bass, mid: bands.mid, treble: bands.treble, level: bands.level, beat };
  }

  async resume(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  close(): void {
    this.source.disconnect();
    void this.ctx.close();
  }
}
