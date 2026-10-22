export interface OnsetOptions {
  /** Seconds over which the flux mean/deviation baseline adapts. */
  adapt?: number;
  /** Onset fires when flux exceeds mean + sensitivity * deviation. */
  sensitivity?: number;
  /** Minimum flux (dB of rise per bin, normalized to 60 fps) that can count as an onset. */
  minFlux?: number;
  /** Shortest gap between onsets in seconds (suppresses double triggers on one hit). */
  refractory?: number;
  /** Pulse decay time constant in seconds. */
  decay?: number;
}

/** Seconds after an onset during which a rising strength can still lift the pulse. */
const ONSET_RISE = 0.05;
/**
 * An onset this much stronger than the current pulse may fire inside the refractory window, so
 * a kick landing right after a weaker hat/arp onset (common: both on the same beat) is not lost.
 */
const UPGRADE_MARGIN = 0.2;

/**
 * Adaptive onset detector over a spectral-flux signal. Feed it the rectified flux each frame;
 * it returns a pulse (0..1) that jumps to 1 on an onset and decays exponentially (frame-rate
 * independent). The threshold follows a running mean + deviation, so it locks onto the hits
 * of the current track (kicks in a drop, hats are ignored) at any loudness.
 */
export class OnsetDetector {
  private mean = 0;
  private dev = 0;
  private pulse = 0;
  private sinceLast = Infinity;
  private lastStrength = 0; // peak strength of the most recent onset (incl. its rise window)
  private primed = false;
  private readonly adapt: number;
  private readonly sensitivity: number;
  private readonly minFlux: number;
  private readonly refractory: number;
  private readonly decay: number;

  constructor(opts: OnsetOptions = {}) {
    this.adapt = opts.adapt ?? 0.8;
    this.sensitivity = opts.sensitivity ?? 1.6;
    this.minFlux = opts.minFlux ?? 1.2;
    this.refractory = opts.refractory ?? 0.14;
    this.decay = opts.decay ?? 0.16;
  }

  /**
   * @param flux rectified spectral flux for this frame
   * @param strength 0..1 height of the pulse for an onset (e.g. lower for onsets that carry no
   *   kick energy, so an arpeggio pulses softer than a kick drum). It is also applied for a few
   *   frames after the onset, since the energy that sets it can peak slightly after the flux.
   */
  update(flux: number, dt: number, strength = 1): number {
    // flux per frame shrinks at higher frame rates (less change between frames); normalize to 60 fps
    const f = flux * (1 / 60 / Math.max(dt, 1e-4));
    this.sinceLast += dt;
    const threshold = this.mean + this.sensitivity * this.dev;
    const blocked =
      this.sinceLast < this.refractory && strength < this.lastStrength + UPGRADE_MARGIN;
    const isOnset = this.primed && f > threshold && f > this.minFlux && !blocked;
    const k = 1 - Math.exp(-dt / this.adapt);
    this.mean += (f - this.mean) * k;
    this.dev += (Math.abs(f - this.mean) - this.dev) * k;
    this.primed = true;
    if (isOnset) {
      this.pulse = Math.max(this.pulse, strength);
      this.lastStrength = strength;
      this.sinceLast = 0;
    } else {
      this.pulse *= Math.exp(-dt / this.decay);
      if (this.sinceLast <= ONSET_RISE) {
        this.pulse = Math.max(this.pulse, strength);
        this.lastStrength = Math.max(this.lastStrength, strength);
      }
    }
    return this.pulse;
  }
}
