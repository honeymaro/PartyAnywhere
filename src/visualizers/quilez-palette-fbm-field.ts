import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Domain-warped fbm field colored with an iq cosine palette built from the live colors.
// The field scale is fixed (no zoom pumping); the flow and the palette drift are phases
// accumulated on the CPU (audio sets the rate, one-way). Valleys sink dark, ridges glow,
// and each kick flashes the ridges. Cost: one 3-octave vec2 fbm for the warp plus one
// 4-octave fbm for the field (7 noise lookups instead of 15).
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uFlow;      // accumulated flow phase
uniform float uPalPhase;  // accumulated palette drift
uniform float uBass;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

const float TWO_PI = 6.28318530718;

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

vec2 hash2(vec2 p) {
  float h = hash(p);
  return vec2(h, hash(p + h + 17.17));
}

// Smooth value noise
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

// Two-channel value noise (one lattice walk for both warp components)
vec2 noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 a = hash2(i);
  vec2 b = hash2(i + vec2(1.0, 0.0));
  vec2 c = hash2(i + vec2(0.0, 1.0));
  vec2 d = hash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

const mat2 ROT = mat2(0.8, 0.6, -0.6, 0.8); // rotate octaves to hide lattice alignment

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p = ROT * p * 2.03 + 1.7;
    amp *= 0.5;
  }
  return v / 0.9375;
}

vec2 fbm2(vec2 p) {
  vec2 v = vec2(0.0);
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    v += amp * noise2(p);
    p = ROT * p * 2.03 + 3.1;
    amp *= 0.5;
  }
  return v / 0.875;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  vec2 p = uv * 2.1 + vec2(uFlow * 0.25, uFlow * 0.1);
  vec2 q = fbm2(p + vec2(0.0, uFlow * 0.4)) * 2.0 - 1.0;
  float f = fbm(p + q * 1.1 + vec2(uFlow * 0.15, -uFlow * 0.1));

  // value-noise fbm clusters near 0.5; stretch it (softly) to use more of the range
  float t = clamp((f - 0.5) * 1.8 + 0.5, 0.0, 1.0);

  // iq cosine palette: midpoint and half-difference of the live colors, a small
  // per-channel phase spread for iridescence, slowly drifting with uPalPhase
  vec3 a = (uPrimary + uAccent) * 0.5;
  vec3 b = (uPrimary - uAccent) * 0.5;
  vec3 pal = a + b * cos(TWO_PI * (t * 1.6 + uPalPhase + vec3(0.0, 0.06, 0.12)));
  pal = max(pal, 0.0);

  // valleys deep, ridges lit; warp strength adds accent veins
  float shade = smoothstep(0.08, 0.8, t);
  vec3 col = pal * (0.06 + 0.85 * shade);
  col += uAccent * smoothstep(0.6, 1.0, length(q)) * 0.12 * shade;

  // thin ridge highlights, flash on the kick
  float ridge = smoothstep(0.72, 0.92, t) * (1.0 - smoothstep(0.92, 1.0, t) * 0.5);
  col += mix(pal, vec3(1.0), 0.3) * ridge * (0.08 + uBass * 0.1 + uBeat * 0.6);
  col *= 0.9 + uBeat * 0.2;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uFlow', 'uPalPhase', 'uBass', 'uBeat', 'uPrimary', 'uAccent',
] as const;

export function createQuilezPaletteFbmField(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let flow = 0; // field flow phase (only ever increases)
  let palPhase = 0; // palette drift (only ever increases)

  return {
    id: 'quilez-palette-fbm-field',
    name: 'Cosine Palette Noise Field',
    init(context: VisualizerContext) {
      ctx = context;
      gl = context.gl;
      program = context.compileFragment(FRAG);
      for (const name of NAMES) u[name] = gl.getUniformLocation(program, name);
    },
    resize() {},
    render(frame: RenderFrame) {
      const a = frame.audio;
      flow += (0.06 + a.level * 0.08 + a.mid * 0.04 + a.beat * 0.45) * frame.dt;
      palPhase += (0.012 + a.level * 0.02) * frame.dt;

      gl.useProgram(program);
      ctx.quad.bind(program);
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uFlow, flow);
      gl.uniform1f(u.uPalPhase, palPhase);
      gl.uniform1f(u.uBass, a.bass);
      gl.uniform1f(u.uBeat, a.beat);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
    },
  };
}
