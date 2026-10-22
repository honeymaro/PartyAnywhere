import type { AudioFrame, Palette } from '../core/types';
import type { OverlayEffect } from './overlay-effects';
import { OVERLAY_EFFECTS } from './overlay-effects';

/**
 * Centered image overlay over the visualizer. Owns an `.overlay-anchor > .overlay-img`
 * pair (anchor centers; the active effects transform/filter the inner img). Multiple
 * effects can be active at once: each returns a transform/filter fragment and the overlay
 * composes them (e.g. Spin + Pulse). Visible only when enabled AND an image is loaded.
 * Independent of the active color source.
 */
export class ImageOverlay {
  private anchor: HTMLDivElement;
  private img: HTMLImageElement;
  private cache = new Map<string, OverlayEffect>(); // instances kept to preserve state (spin angle)
  private active: OverlayEffect[] = []; // active effects in OVERLAY_EFFECTS order
  private enabled = false;
  private hasImage = false;
  private url: string | null = null;
  private time = 0;
  private sBass = 0;
  private beatPop = 0;

  constructor(stage: HTMLElement) {
    this.anchor = document.createElement('div');
    this.anchor.className = 'overlay-anchor';
    this.img = document.createElement('img');
    this.img.className = 'overlay-img';
    this.img.alt = '';
    this.anchor.appendChild(this.img);
    stage.appendChild(this.anchor);
    this.updateVisibility();
  }

  setImageFile(file: File | null): void {
    if (this.url) {
      URL.revokeObjectURL(this.url);
      this.url = null;
    }
    if (!file) {
      this.hasImage = false;
      this.img.removeAttribute('src');
      this.updateVisibility();
      return;
    }
    const url = URL.createObjectURL(file);
    this.url = url;
    this.img.onload = () => {
      if (this.url !== url) return; // superseded by a newer setImageFile
      this.hasImage = true;
      this.updateVisibility();
    };
    this.img.onerror = () => {
      if (this.url !== url) return; // superseded; its URL was already handled
      URL.revokeObjectURL(this.url);
      this.url = null;
      this.hasImage = false;
      this.img.removeAttribute('src');
      this.updateVisibility();
    };
    this.img.src = url;
  }

  setEnabled(enabled: boolean): void {
    if (!enabled && this.enabled) this.clearStyles();
    this.enabled = enabled;
    this.updateVisibility();
  }

  /** Set the active effect set (any combination); unknown ids are ignored. */
  setEffects(ids: string[]): void {
    this.active = [];
    for (const e of OVERLAY_EFFECTS) {
      if (!ids.includes(e.id)) continue;
      let inst = this.cache.get(e.id);
      if (!inst) {
        inst = e.factory();
        this.cache.set(e.id, inst);
      }
      this.active.push(inst);
    }
    if (this.active.length === 0) this.clearStyles(); // nothing active → static
  }

  /** Called each frame while sharing is active. */
  update(audio: AudioFrame, dt: number, palette: Palette): void {
    if (!this.enabled || !this.hasImage) return;
    this.time += dt;
    const k = 1 - Math.exp(-(dt || 0) / 0.15);
    this.sBass += (audio.bass - this.sBass) * k;
    // Snappy "kick" driver: jump to whichever of the beat onset or the (squared) bass is louder,
    // then decay fast so each hit reads as a distinct punch (쿵짝) rather than a steady swell.
    // Squaring keeps the bass bed between kicks from holding the image permanently enlarged.
    const decayK = Math.exp(-(dt || 0) / 0.06); // ~40ms half-life
    const kick = Math.max(audio.beat, audio.bass * audio.bass);
    this.beatPop = Math.max(this.beatPop * decayK, kick);

    if (this.active.length === 0) {
      this.clearStyles();
      return;
    }
    const frame = {
      time: this.time,
      dt,
      level: audio.level,
      treble: audio.treble,
      sBass: this.sBass,
      beatPop: this.beatPop,
      palette,
    };
    let transform = '';
    let filter = '';
    for (const eff of this.active) {
      const s = eff.apply(frame);
      if (s.transform) transform += (transform ? ' ' : '') + s.transform;
      if (s.filter) filter += (filter ? ' ' : '') + s.filter;
    }
    this.img.style.transform = transform;
    this.img.style.filter = filter;
  }

  /** Reset per-session animation state (call when sharing stops). */
  reset(): void {
    this.time = 0;
    this.sBass = 0;
    this.beatPop = 0;
    for (const inst of this.cache.values()) inst.reset();
    this.clearStyles();
  }

  dispose(): void {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.anchor.remove();
  }

  private clearStyles(): void {
    this.img.style.transform = '';
    this.img.style.filter = '';
  }

  private updateVisibility(): void {
    this.anchor.style.display = this.enabled && this.hasImage ? 'block' : 'none';
  }
}
