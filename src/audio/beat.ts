export interface BeatOptions {
  smoothing?: number; // running-average inertia 0..1
  sensitivity?: number; // multiple of the running average that counts as a beat
  decay?: number; // per-frame pulse decay 0..1
}

/**
 * Energy-based onset detector. Feed it the overall level each frame; it returns a
 * pulse (0..1) that jumps to 1 on a beat and decays afterward.
 */
export class BeatDetector {
  private avg = 0;
  private pulse = 0;
  private readonly smoothing: number;
  private readonly sensitivity: number;
  private readonly decay: number;

  constructor(opts: BeatOptions = {}) {
    this.smoothing = opts.smoothing ?? 0.9;
    this.sensitivity = opts.sensitivity ?? 1.3;
    this.decay = opts.decay ?? 0.85;
  }

  update(level: number): number {
    const isBeat = this.avg > 0.0001 && level > this.avg * this.sensitivity;
    this.avg = this.smoothing * this.avg + (1 - this.smoothing) * level;
    if (isBeat) this.pulse = 1;
    else this.pulse *= this.decay;
    return this.pulse;
  }
}
