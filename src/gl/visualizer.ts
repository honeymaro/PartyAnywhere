import type { RenderFrame } from '../core/types';
import type { QuadGeometry } from './gl-utils';

/** GL context + shared resources the host hands to each visualizer at init. */
export interface VisualizerContext {
  gl: WebGL2RenderingContext;
  quad: QuadGeometry; // shared fullscreen-triangle geometry
  spectrumTex: WebGLTexture; // host refreshes this each frame
  compileFragment(fragSrc: string): WebGLProgram; // links against the shared vertex shader
}

/** The unified contract. Implement this and a visualizer can be added/removed/switched at runtime. */
export interface Visualizer {
  readonly id: string;
  readonly name: string;
  init(ctx: VisualizerContext): void;
  resize(width: number, height: number): void;
  render(frame: RenderFrame): void;
  dispose(): void;
}

export type VisualizerFactory = () => Visualizer;
