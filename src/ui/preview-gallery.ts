import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { VisualizerEntry } from '../visualizers/index';
import type { Palette } from '../core/types';
import { createVisualizerContext, uploadSpectrum } from '../gl/gl-utils';
import { demoAudioFrame } from '../audio/demo';

const PREVIEW_PALETTE: Palette = { primary: [0.31, 0.49, 1.0], accent: [1.0, 0.31, 0.64] };
const PREVIEW_W = 240;
const PREVIEW_H = 135;
const STATIC_TIME = 1.7; // representative frame used for the idle thumbnail
const INIT_PER_FRAME = 3; // stagger lazy shader compiles across frames to avoid a hitch

export interface PreviewGalleryOptions {
  container: HTMLElement;
  entries: VisualizerEntry[];
  selected: Set<string>;
  onToggle: (id: string, checked: boolean) => void;
}

type CardStatus = 'pending' | 'ready' | 'failed';

interface CardState {
  entry: VisualizerEntry;
  el: HTMLElement;
  name: HTMLSpanElement;
  checkbox: HTMLInputElement;
  cardCtx: CanvasRenderingContext2D | null;
  viz: Visualizer | null;
  status: CardStatus;
}

/**
 * Lazy, hover-to-play visualizer gallery. Each card shows a single STATIC thumbnail
 * (rendered the first time it scrolls into view) and animates live ONLY while hovered.
 * Shaders are compiled lazily and staggered across frames, so opening the gallery with
 * many visualizers never triggers a compile storm and only the hovered card costs a
 * per-frame draw. One shared WebGL2 context is reused for every card (draw → copy to
 * the card's 2D canvas).
 */
export class PreviewGallery {
  private glCanvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private ctx: VisualizerContext;
  private spectrumTex: WebGLTexture;
  private cards = new Map<string, CardState>();
  private observer: IntersectionObserver | null = null;
  private active = false;
  private initQueue: string[] = [];
  private queueRaf = 0;
  private hoverId: string | null = null;
  private hoverRaf = 0;
  private hoverStart = 0;

  constructor(opts: PreviewGalleryOptions) {
    this.glCanvas = document.createElement('canvas');
    this.glCanvas.width = PREVIEW_W;
    this.glCanvas.height = PREVIEW_H;
    const gl = this.glCanvas.getContext('webgl2', { preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is not supported in this browser');
    this.gl = gl;

    const created = createVisualizerContext(gl);
    this.ctx = created.ctx;
    this.spectrumTex = created.spectrumTex;

    for (const entry of opts.entries) this.buildCard(entry, opts);
  }

  private buildCard(entry: VisualizerEntry, opts: PreviewGalleryOptions): void {
    const card = document.createElement('label');
    card.className = 'viz-card';
    card.dataset.id = entry.info.id;

    const canvas = document.createElement('canvas');
    canvas.width = PREVIEW_W;
    canvas.height = PREVIEW_H;
    canvas.className = 'viz-card-canvas';

    const row = document.createElement('div');
    row.className = 'viz-card-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = opts.selected.has(entry.info.id);
    const name = document.createElement('span');
    name.textContent = entry.info.name;
    row.appendChild(checkbox);
    row.appendChild(name);

    card.appendChild(canvas);
    card.appendChild(row);
    opts.container.appendChild(card);

    const reflect = (): void => {
      card.classList.toggle('off', !checkbox.checked);
    };
    reflect();
    checkbox.addEventListener('change', () => {
      opts.onToggle(entry.info.id, checkbox.checked);
      reflect();
    });

    // Hover to play: only the hovered card animates; everything else stays a still frame.
    card.addEventListener('pointerenter', () => this.playHover(entry.info.id));
    card.addEventListener('pointerleave', () => this.stopHover());

    this.cards.set(entry.info.id, {
      entry,
      el: card,
      name,
      checkbox,
      cardCtx: canvas.getContext('2d'),
      viz: null,
      status: 'pending',
    });
  }

  /** Reflect a select-all / deselect-all from outside without firing per-card onToggle. */
  setAllChecked(checked: boolean): void {
    for (const card of this.cards.values()) {
      card.checkbox.checked = checked;
      card.el.classList.toggle('off', !checked);
    }
  }

  /** Open: observe cards so each renders its static thumbnail as it scrolls into view. */
  start(): void {
    this.active = true;
    const obs = this.observer ?? this.createObserver();
    this.observer = obs;
    for (const card of this.cards.values()) {
      if (card.status === 'pending') obs.observe(card.el);
    }
  }

  /** Close: stop the hover animation and stop observing (thumbnails persist on their canvases). */
  stop(): void {
    this.active = false;
    this.stopHover();
    this.observer?.disconnect();
    if (this.queueRaf) cancelAnimationFrame(this.queueRaf);
    this.queueRaf = 0;
    this.initQueue = [];
  }

  dispose(): void {
    this.stop();
    this.observer = null;
    for (const card of this.cards.values()) {
      if (card.viz) {
        try {
          card.viz.dispose();
        } catch {
          // ignore disposal failures
        }
      }
    }
    this.cards.clear();
    // Release the shared GL resources owned by this gallery's context.
    this.gl.deleteTexture(this.spectrumTex);
    this.ctx.quad.dispose();
  }

  private createObserver(): IntersectionObserver {
    return new IntersectionObserver(
      (items) => {
        for (const it of items) {
          if (!it.isIntersecting) continue;
          const id = (it.target as HTMLElement).dataset.id;
          if (id) this.enqueueStatic(id);
          this.observer?.unobserve(it.target); // a static thumbnail only needs rendering once
        }
      },
      { root: null, rootMargin: '120px' },
    );
  }

  /** Compile a card's shader on first use; returns null (and marks the card failed) on error. */
  private ensureViz(card: CardState): Visualizer | null {
    if (card.status === 'failed') return null;
    if (card.viz) return card.viz;
    const viz = card.entry.factory();
    try {
      viz.init(this.ctx);
      viz.resize(PREVIEW_W, PREVIEW_H);
      card.viz = viz;
      card.status = 'ready';
      return viz;
    } catch (err) {
      console.error(`Preview "${card.entry.info.id}" failed to initialize:`, err);
      try {
        viz.dispose();
      } catch {
        // ignore
      }
      card.status = 'failed';
      card.el.classList.add('failed');
      card.name.textContent = `${card.entry.info.name} (failed)`;
      return null;
    }
  }

  private renderFrame(card: CardState, time: number): void {
    const viz = this.ensureViz(card);
    if (!viz || !card.cardCtx) return;
    const frame = demoAudioFrame(time);
    uploadSpectrum(this.gl, this.spectrumTex, frame.spectrum);
    this.gl.viewport(0, 0, PREVIEW_W, PREVIEW_H);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    try {
      viz.render({
        time,
        dt: 1 / 60,
        resolution: [PREVIEW_W, PREVIEW_H],
        audio: frame,
        palette: PREVIEW_PALETTE,
      });
      card.cardCtx.drawImage(this.glCanvas, 0, 0);
    } catch (err) {
      console.error(`Preview "${card.entry.info.id}" render failed:`, err);
    }
  }

  private enqueueStatic(id: string): void {
    const card = this.cards.get(id);
    if (!card || card.status === 'failed') return;
    if (this.initQueue.includes(id)) return;
    this.initQueue.push(id);
    if (!this.queueRaf) this.queueRaf = requestAnimationFrame(() => this.drainQueue());
  }

  private drainQueue(): void {
    this.queueRaf = 0;
    if (!this.active) {
      this.initQueue = []; // a late IntersectionObserver callback queued work after stop()
      return;
    }
    for (let n = 0; n < INIT_PER_FRAME && this.initQueue.length > 0; n++) {
      const id = this.initQueue.shift()!;
      const card = this.cards.get(id);
      if (card && card.status !== 'ready') this.renderFrame(card, STATIC_TIME);
    }
    if (this.initQueue.length > 0) {
      this.queueRaf = requestAnimationFrame(() => this.drainQueue());
    }
  }

  private playHover(id: string): void {
    if (this.hoverId === id) return;
    this.stopHover();
    const card = this.cards.get(id);
    if (!card || card.status === 'failed') return;
    this.hoverId = id;
    this.hoverStart = 0;
    const loop = (now: number): void => {
      if (this.hoverId !== id) return;
      if (this.hoverStart === 0) this.hoverStart = now;
      const time = (now - this.hoverStart) / 1000;
      const c = this.cards.get(id);
      if (c) this.renderFrame(c, time);
      this.hoverRaf = requestAnimationFrame(loop);
    };
    this.hoverRaf = requestAnimationFrame(loop);
  }

  private stopHover(): void {
    if (this.hoverRaf) cancelAnimationFrame(this.hoverRaf);
    this.hoverRaf = 0;
    const id = this.hoverId;
    this.hoverId = null;
    if (id) {
      const card = this.cards.get(id);
      if (card && card.status !== 'failed') this.renderFrame(card, STATIC_TIME); // settle on a clean still
    }
  }
}
