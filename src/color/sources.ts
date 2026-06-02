import type { Palette, RGB } from '../core/types';
import type { ColorSource, ColorSourceId } from './color-service';
import { derivePalette } from './palette';
import { extractDominantColor } from './extract';

/** Draws a source into an offscreen canvas of the given size and returns its RGBA bytes. */
function sampleToData(
  source: HTMLImageElement | HTMLVideoElement,
  canvas: HTMLCanvasElement,
): Uint8ClampedArray | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

/** User-picked color. */
export class ManualColorSource implements ColorSource {
  readonly id: ColorSourceId = 'manual';
  private palette: Palette;
  constructor(initial: Palette) {
    this.palette = initial;
  }
  setPrimary(primary: RGB): void {
    this.palette = derivePalette(primary);
  }
  target(): Palette | null {
    return this.palette;
  }
}

/** Dominant color extracted from an uploaded image. */
export class ImageColorSource implements ColorSource {
  readonly id: ColorSourceId = 'image';
  private palette: Palette | null = null;
  private canvas = makeCanvas(64);

  setImage(img: HTMLImageElement): void {
    const data = sampleToData(img, this.canvas);
    const dom = data ? extractDominantColor(data) : null;
    if (dom) this.palette = derivePalette(dom);
  }
  target(): Palette | null {
    return this.palette;
  }
}

/** Dominant color sampled periodically from the shared screen's video frames. */
export class ScreenColorSource implements ColorSource {
  readonly id: ColorSourceId = 'screen';
  private palette: Palette | null = null;
  private canvas = makeCanvas(64);
  private lastSample = 0;
  private video: HTMLVideoElement;
  private intervalMs: number;

  constructor(video: HTMLVideoElement, intervalMs = 2000) {
    this.video = video;
    this.intervalMs = intervalMs;
  }

  /** Call each frame with the current timestamp (ms); throttles internally. */
  sample(now: number): void {
    if (now - this.lastSample < this.intervalMs) return;
    if (this.video.readyState < 2 || this.video.videoWidth === 0) return;
    this.lastSample = now;
    const data = sampleToData(this.video, this.canvas);
    const dom = data ? extractDominantColor(data) : null;
    if (dom) this.palette = derivePalette(dom);
  }
  target(): Palette | null {
    return this.palette;
  }
}
