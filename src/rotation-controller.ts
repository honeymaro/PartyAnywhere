export interface RotationOptions {
  intervalSec?: number;
}

/**
 * Decides the current visualizer id from a selected pool: auto-advances on a timer
 * (when not paused and the pool has >1 item) and supports manual next/prev. Emits via onChange.
 */
export class RotationController {
  private pool: string[] = [];
  private index = 0;
  private elapsed = 0;
  private paused = false;
  private intervalSec: number;
  private changeCb: ((id: string) => void) | null = null;

  constructor(opts: RotationOptions = {}) {
    this.intervalSec = opts.intervalSec ?? 20;
  }

  onChange(cb: (id: string) => void): void {
    this.changeCb = cb;
  }

  setIntervalSec(sec: number): void {
    this.intervalSec = sec;
  }

  getIntervalSec(): number {
    return this.intervalSec;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  isPaused(): boolean {
    return this.paused;
  }

  current(): string | null {
    return this.pool[this.index] ?? null;
  }

  /** Replace the pool, keeping the current item selected if it survives. */
  setPool(ids: string[]): void {
    const prev = this.current();
    this.pool = ids;
    const keep = prev !== null ? ids.indexOf(prev) : -1;
    this.index = keep >= 0 ? keep : 0;
    this.elapsed = 0;
    if (this.current() !== prev) this.emit();
  }

  /** Advance time by dt seconds; auto-advances when the interval elapses. */
  update(dt: number): void {
    if (this.paused || this.pool.length <= 1) return;
    this.elapsed += dt;
    if (this.elapsed >= this.intervalSec) {
      this.elapsed = 0;
      this.advance(1);
    }
  }

  next(): void {
    this.elapsed = 0;
    this.advance(1);
  }

  prev(): void {
    this.elapsed = 0;
    this.advance(-1);
  }

  private advance(dir: number): void {
    if (this.pool.length === 0) return;
    this.index = (this.index + dir + this.pool.length) % this.pool.length;
    this.emit();
  }

  private emit(): void {
    const id = this.current();
    if (id !== null && this.changeCb) this.changeCb(id);
  }
}
