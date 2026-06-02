import type { Palette, RGB } from '../core/types';
import { lerpOklab } from './oklab';

export type ColorSourceId = 'screen' | 'image' | 'manual';

/** A provider of a desired palette. Returns null when it has nothing to offer yet. */
export interface ColorSource {
  readonly id: ColorSourceId;
  target(): Palette | null;
}

function clonePalette(p: Palette): Palette {
  return { primary: [...p.primary] as RGB, accent: [...p.accent] as RGB };
}

/** Holds color sources and eases the current palette toward the active source each frame. */
export class ColorService {
  private sources = new Map<ColorSourceId, ColorSource>();
  private activeId: ColorSourceId;
  private currentPalette: Palette;
  private readonly tau: number;

  /** @param tau time constant in seconds (smaller = snappier transitions). */
  constructor(initial: Palette, activeId: ColorSourceId, tau = 0.4) {
    this.currentPalette = clonePalette(initial);
    this.activeId = activeId;
    this.tau = tau;
  }

  addSource(source: ColorSource): void {
    this.sources.set(source.id, source);
  }

  removeSource(id: ColorSourceId): void {
    this.sources.delete(id);
  }

  setActive(id: ColorSourceId): void {
    this.activeId = id;
  }

  getActive(): ColorSourceId {
    return this.activeId;
  }

  /** Ease the current palette toward the active source's target by dt seconds; returns it. */
  update(dt: number): Palette {
    const target = this.sources.get(this.activeId)?.target() ?? null;
    if (target) {
      const k = 1 - Math.exp(-dt / this.tau);
      this.currentPalette = {
        primary: lerpOklab(this.currentPalette.primary, target.primary, k),
        accent: lerpOklab(this.currentPalette.accent, target.accent, k),
      };
    }
    return this.currentPalette;
  }

  current(): Palette {
    return this.currentPalette;
  }
}
