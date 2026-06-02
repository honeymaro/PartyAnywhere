import {
  createVisualizerContext,
  uploadSpectrum,
} from './gl-utils';
import type { QuadGeometry } from './gl-utils';
import type { Visualizer, VisualizerContext } from './visualizer';
import type { RenderFrame } from '../core/types';

/** Owns the WebGL2 context and shared resources; manages the active visualizer's lifecycle. */
export class VisualizerHost {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private ctx: VisualizerContext;
  private spectrumTex: WebGLTexture;
  private quad: QuadGeometry;
  private active: Visualizer | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 is not supported in this browser');
    this.gl = gl;

    const { ctx, quad, spectrumTex } = createVisualizerContext(gl);
    this.ctx = ctx;
    this.quad = quad;
    this.spectrumTex = spectrumTex;
  }

  /**
   * Disposes the previous visualizer and initializes the new one.
   * Returns false (and leaves nothing active) if the visualizer fails to
   * initialize — e.g. a shader that won't compile — so one bad visualizer
   * among many can't crash the render loop.
   */
  activate(visualizer: Visualizer): boolean {
    if (this.active) this.active.dispose();
    this.active = null;
    try {
      visualizer.init(this.ctx);
      visualizer.resize(this.canvas.width, this.canvas.height);
      this.active = visualizer;
      return true;
    } catch (err) {
      console.error(`Visualizer "${visualizer.id}" failed to initialize:`, err);
      try {
        visualizer.dispose();
      } catch {
        // ignore secondary failures while cleaning up a broken visualizer
      }
      return false;
    }
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    this.gl.viewport(0, 0, width, height);
    this.active?.resize(width, height);
  }

  render(frame: RenderFrame): void {
    uploadSpectrum(this.gl, this.spectrumTex, frame.audio.spectrum);
    this.active?.render(frame);
  }

  // full teardown; called when the app is destroyed
  dispose(): void {
    this.active?.dispose();
    this.active = null;
    this.gl.deleteTexture(this.spectrumTex);
    this.quad.dispose();
  }
}
