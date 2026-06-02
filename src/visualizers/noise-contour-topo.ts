import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  for (int i = 0; i < 6; i++) {
    v += amp * noise(p * freq);
    freq *= 2.13;
    amp *= 0.48;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = (uv - 0.5) * 2.5;
  p.x *= uResolution.x / uResolution.y;

  // Drift over time; uMid morphs the terrain shape
  vec2 drift = vec2(uTime * 0.05, uTime * 0.032);
  float midShift = uMid * 0.6;
  float h = fbm(p * 2.0 + drift + midShift);

  // uBeat causes an elevation swell
  h += uBeat * 0.18 * sin(length(p) * 4.0 - uTime * 2.0);

  // Contour lines: N bands
  float N = 10.0;
  float band = fract(h * N);
  float lineWidth = 0.04 + uTreble * 0.08; // uTreble sharpens lines
  float sharpness = 1.0 / max(lineWidth, 0.004);
  float line = 1.0 - smoothstep(0.0, lineWidth, abs(band - 0.5));

  // Approximate gradient for relief shading
  float eps = 0.004;
  float hx = fbm((p + vec2(eps, 0.0)) * 2.0 + drift + midShift);
  float hy = fbm((p + vec2(0.0, eps)) * 2.0 + drift + midShift);
  vec2 grad = vec2(hx - h, hy - h) / eps;
  vec2 lightDir = normalize(vec2(0.6, 0.8));
  float relief = clamp(dot(normalize(grad + 0.0001), lightDir), 0.0, 1.0);
  float shade = 0.55 + 0.45 * relief;

  // Elevation fill color
  vec3 fillCol = mix(uPrimary, uAccent, h) * shade;

  // Contour line glow color — brighten with uBass
  float bassBright = 1.0 + uBass * 1.4;
  vec3 lineCol = mix(uAccent, vec3(1.0), 0.35) * bassBright;

  // Compose: fill + glowing contour lines
  vec3 col = mix(fillCol, lineCol, line * (0.7 + uBass * 0.3));

  // Subtle outer vignette for cartographic feel
  float vig = 1.0 - smoothstep(0.6, 1.3, length((uv - 0.5) * 1.6));
  col *= vig;

  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uBass', 'uMid', 'uTreble', 'uBeat', 'uPrimary', 'uAccent',
] as const;

export function createNoiseContourTopo(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'noise-contour-topo',
    name: 'Topographic Contour Lines',
    init(context: VisualizerContext) {
      ctx = context;
      gl = context.gl;
      program = context.compileFragment(FRAG);
      for (const name of NAMES) u[name] = gl.getUniformLocation(program, name);
    },
    resize() {},
    render(frame: RenderFrame) {
      gl.useProgram(program);
      ctx.quad.bind(program);
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uTime, frame.time);
      gl.uniform1f(u.uBass, frame.audio.bass);
      gl.uniform1f(u.uMid, frame.audio.mid);
      gl.uniform1f(u.uTreble, frame.audio.treble);
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
