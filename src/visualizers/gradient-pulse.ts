import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uLevel;
uniform float uBass;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  float d = length(uv);
  float radius = 0.3 + 0.5 * uBass + 0.4 * uBeat;
  // filled disc that grows with bass/beat; feathers at the edge
  float disc = smoothstep(radius + 0.4, radius - 0.1, d);
  float wave = 0.5 + 0.5 * sin(uTime * 0.5 + d * 6.0 - uLevel * 4.0);
  vec3 col = mix(uAccent, uPrimary, disc);
  col *= 0.4 + 0.6 * wave;
  col += uBeat * 0.2;
  fragColor = vec4(col, 1.0);
}
`;

const UNIFORM_NAMES = ['uResolution', 'uTime', 'uLevel', 'uBass', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createGradientPulse(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'gradient-pulse',
    name: 'Gradient Pulse',

    init(context: VisualizerContext) {
      ctx = context;
      gl = context.gl;
      program = context.compileFragment(FRAG);
      for (const name of UNIFORM_NAMES) u[name] = gl.getUniformLocation(program, name);
    },

    resize() {
      // Resolution is passed as a uniform each frame; nothing to cache here.
    },

    render(frame: RenderFrame) {
      gl.useProgram(program);
      ctx.quad.bind(program);
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uTime, frame.time);
      gl.uniform1f(u.uLevel, frame.audio.level);
      gl.uniform1f(u.uBass, frame.audio.bass);
      gl.uniform1f(u.uBeat, frame.audio.beat);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },

    dispose() {
      gl.deleteProgram(program);
    },
  };
}
