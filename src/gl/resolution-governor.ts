export interface GovernorOptions {
  /** Lowest render scale (fraction of the native drawing-buffer size per axis). */
  minScale?: number;
  /** Highest render scale. */
  maxScale?: number;
  /** Rendered-pixel cap a visualizer starts from before its real cost is known. */
  pixelBudget?: number;
}

const WARMUP = 0.6; // s ignored after a switch (shader compile + first-frame hitches)
const SLOW_RATIO = 1.3; // frame time vs refresh interval that counts as dropping frames
const FAST_RATIO = 1.08; // frame time vs refresh interval that counts as having headroom
const SLOW_HOLD = 0.35; // s of sustained slowness before stepping down
const FAST_HOLD = 1.5; // s of sustained headroom before probing up
const PROBE_STEP = 1.2;
const CEILING_MEMORY = 20; // s a scale that proved too slow is not probed again
const CEILING_MEMORY_MAX = 320; // s; failing again at the same ceiling doubles the wait

interface Ceiling {
  scale: number; // a scale that proved too slow for this visualizer
  hold: number; // seconds of activity before it may be probed again
}

/**
 * Dynamic resolution: watches frame times and picks the render scale so heavy shaders keep a
 * smooth frame rate on weak GPUs / 4K screens while cheap ones climb back to full resolution.
 * Fragment cost is proportional to pixel count (scale^2), so a step down is sized from the
 * measured overshoot. The last good scale is remembered per visualizer id.
 */
export class ResolutionGovernor {
  private readonly minScale: number;
  private readonly maxScale: number;
  private readonly pixelBudget: number;
  private nativePixels = 1920 * 1080;
  private scale = 1;
  private id: string | null = null;
  private readonly memory = new Map<string, number>();
  private readonly ceilings = new Map<string, Ceiling>();
  private warmup = WARMUP;
  private ema = 0;
  private refresh = 1 / 60;
  private slowTime = 0;
  private fastTime = 0;
  private cooldown = 0;
  private ceiling = Infinity;
  private ceilingTimer = 0;

  constructor(opts: GovernorOptions = {}) {
    this.minScale = opts.minScale ?? 0.35;
    this.maxScale = opts.maxScale ?? 1;
    this.pixelBudget = opts.pixelBudget ?? 1920 * 1080;
    this.scale = this.startScale();
  }

  get value(): number {
    return this.scale;
  }

  setNativeSize(width: number, height: number): void {
    const px = Math.max(1, width * height);
    if (px === this.nativePixels) return;
    this.nativePixels = px;
    // a new screen size invalidates everything learned about per-visualizer cost
    this.memory.clear();
    this.ceilings.clear();
    this.begin(this.id);
  }

  /** Start tracking a (newly activated) visualizer, resuming from its remembered scale. */
  begin(id: string | null): void {
    this.id = id;
    this.scale = (id !== null && this.memory.get(id)) || this.startScale();
    this.warmup = WARMUP;
    this.ema = 0;
    this.slowTime = 0;
    this.fastTime = 0;
    this.cooldown = 0;
    // a scale that already stalled this visualizer stays off limits when it comes back, so
    // rotation does not replay the same failed probe (a visible stutter) on every activation
    const c = id !== null ? this.ceilings.get(id) : undefined;
    this.ceiling = c ? c.scale : Infinity;
    this.ceilingTimer = c ? c.hold : 0;
  }

  /** Feed one frame interval (s). Returns true when the scale changed. */
  update(dt: number): boolean {
    if (!(dt > 0) || dt > 0.25) return false; // tab switch / debugger pause: not a GPU signal
    if (this.warmup > 0) {
      this.warmup -= dt;
      return false;
    }
    // refresh interval estimate: the fastest recent frame, relaxing slowly upward
    this.refresh = Math.min(Math.max(Math.min(dt, this.refresh * 1.002), 1 / 240), 1 / 30);
    this.ema = this.ema === 0 ? dt : this.ema + (dt - this.ema) * 0.1;
    this.cooldown -= dt;
    if (this.ceilingTimer > 0 && (this.ceilingTimer -= dt) <= 0) this.ceiling = Infinity;

    this.slowTime = this.ema > this.refresh * SLOW_RATIO ? this.slowTime + dt : 0;
    this.fastTime = this.ema < this.refresh * FAST_RATIO ? this.fastTime + dt : 0;
    if (this.cooldown > 0) return false;

    if (this.slowTime > SLOW_HOLD && this.scale > this.minScale) {
      // cost grows with scale^2, so shrink by the square root of the overshoot (bounded per step)
      const factor = Math.min(0.92, Math.max(0.7, Math.sqrt((this.refresh * 1.05) / this.ema)));
      const prev = this.id !== null ? this.ceilings.get(this.id) : undefined;
      const hold =
        prev && this.scale >= prev.scale * 0.98
          ? Math.min(prev.hold * 2, CEILING_MEMORY_MAX)
          : CEILING_MEMORY;
      this.ceiling = this.scale;
      this.ceilingTimer = hold;
      if (this.id !== null) this.ceilings.set(this.id, { scale: this.scale, hold });
      return this.set(this.scale * factor, 0.5);
    }
    if (this.fastTime > FAST_HOLD && this.scale < this.maxScale) {
      const next = Math.min(this.maxScale, this.scale * PROBE_STEP);
      if (next < this.ceiling * 0.98) return this.set(next, 1);
    }
    return false;
  }

  private set(scale: number, cooldown: number): boolean {
    const s = Math.min(this.maxScale, Math.max(this.minScale, Math.round(scale * 100) / 100));
    this.cooldown = cooldown;
    this.slowTime = 0;
    this.fastTime = 0;
    this.ema = 0; // re-measure at the new size
    if (s === this.scale) return false;
    this.scale = s;
    if (this.id !== null) this.memory.set(this.id, s);
    return true;
  }

  private startScale(): number {
    const fit = Math.sqrt(this.pixelBudget / this.nativePixels);
    return Math.min(this.maxScale, Math.max(this.minScale, Math.round(fit * 100) / 100));
  }
}
