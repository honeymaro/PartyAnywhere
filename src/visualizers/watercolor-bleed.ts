import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uLevel;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform vec3 uPrimary;
uniform vec3 uAccent;

// Hash for pseudo-random values
float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 17.5);
  return fract(p.x * p.y);
}

// 2D value noise
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

// Low-octave fbm for warp domain
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p = p * 2.1 + vec2(1.7, 9.2);
    amp *= 0.5;
  }
  return v;
}

// Paper grain: high-frequency fbm
float grain(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    v += amp * noise(p);
    p = p * 2.7 + vec2(3.1, 7.4);
    amp *= 0.4;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  // Aspect-correct UV centered
  vec2 asp = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 p = (uv - 0.5) * asp;

  float t = uTime * 0.12;

  // Domain warp amount driven by uMid
  float warpAmt = 0.35 + uMid * 0.55;

  // Warp offset for each wash using fbm
  vec2 warp1 = vec2(fbm(p * 2.3 + vec2(t, t * 0.7)), fbm(p * 2.3 + vec2(t * 0.5 + 4.1, -t + 2.3)));
  vec2 warp2 = vec2(fbm(p * 1.8 + vec2(-t * 0.6 + 1.5, t * 0.9)), fbm(p * 1.8 + vec2(t + 3.7, t * 0.4 + 5.1)));
  vec2 warp3 = vec2(fbm(p * 2.7 + vec2(t * 0.8 + 7.3, -t * 0.3)), fbm(p * 2.7 + vec2(-t * 0.4, t * 0.6 + 1.9)));

  // Sample fbm in warped space to get wash masks
  float mask1 = fbm(p * 1.4 + warp1 * warpAmt + vec2(t * 0.3));
  float mask2 = fbm(p * 1.1 + warp2 * warpAmt + vec2(-t * 0.2, t * 0.4));
  float mask3 = fbm(p * 1.6 + warp3 * warpAmt + vec2(t * 0.15, -t * 0.35));

  // Threshold to soft blotch shape
  float bassBoost = 0.1 + uBass * 0.25;
  float w1 = smoothstep(0.42 - bassBoost, 0.62 - bassBoost, mask1);
  float w2 = smoothstep(0.45 - bassBoost, 0.65 - bassBoost, mask2);
  float w3 = smoothstep(0.40 - bassBoost, 0.60 - bassBoost, mask3);

  // Edge darkening: approximate gradient magnitude via finite differences
  float eps = 0.012;
  float gx1 = fbm((p + vec2(eps, 0.0)) * 1.4 + warp1 * warpAmt + vec2(t * 0.3)) - fbm((p - vec2(eps, 0.0)) * 1.4 + warp1 * warpAmt + vec2(t * 0.3));
  float gy1 = fbm((p + vec2(0.0, eps)) * 1.4 + warp1 * warpAmt + vec2(t * 0.3)) - fbm((p - vec2(0.0, eps)) * 1.4 + warp1 * warpAmt + vec2(t * 0.3));
  float edge1 = length(vec2(gx1, gy1)) / (2.0 * eps);

  float gx2 = fbm((p + vec2(eps, 0.0)) * 1.1 + warp2 * warpAmt + vec2(-t * 0.2, t * 0.4)) - fbm((p - vec2(eps, 0.0)) * 1.1 + warp2 * warpAmt + vec2(-t * 0.2, t * 0.4));
  float gy2 = fbm((p + vec2(0.0, eps)) * 1.1 + warp2 * warpAmt + vec2(-t * 0.2, t * 0.4)) - fbm((p - vec2(0.0, eps)) * 1.1 + warp2 * warpAmt + vec2(-t * 0.2, t * 0.4));
  float edge2 = length(vec2(gx2, gy2)) / (2.0 * eps);

  // Off-white background with slight warm tint, drifted by uLevel
  vec3 bg = vec3(0.97, 0.95, 0.91) + uLevel * 0.04 * (uPrimary - 0.5);

  // Pigment colors: primary for wash1+3, accent for wash2
  // Darken by edge gradient to pool pigment at edges
  float pool1 = clamp(edge1 * 1.8, 0.0, 1.0);
  float pool2 = clamp(edge2 * 1.8, 0.0, 1.0);

  vec3 pigment1 = uPrimary * (1.0 - pool1 * 0.45);
  vec3 pigment2 = uAccent  * (1.0 - pool2 * 0.45);
  vec3 pigment3 = mix(uPrimary, uAccent, 0.6);

  // Composite washes with soft multiply-like blend onto background
  // multiply: result = base * layer (both in [0,1])
  vec3 col = bg;
  col = mix(col, col * mix(vec3(1.0), pigment1, 0.78), w1);
  col = mix(col, col * mix(vec3(1.0), pigment2, 0.72), w2);
  col = mix(col, col * mix(vec3(1.0), pigment3, 0.65), w3 * 0.7);

  // Paper texture grain overlay driven by uTreble
  float paperGrain = grain(uv * vec2(uResolution.x, uResolution.y) * 0.004);
  float grainAmt = 0.025 + uTreble * 0.06;
  col += (paperGrain - 0.5) * grainAmt;

  // Vignette for paper edge effect
  float vig = 1.0 - smoothstep(0.5, 1.2, length(p * 0.9));
  col *= 0.88 + 0.12 * vig;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uLevel', 'uBass', 'uMid', 'uTreble', 'uPrimary', 'uAccent'] as const;

export function createWatercolorBleed(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'watercolor-bleed',
    name: 'Watercolor Bleed',
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
      gl.uniform1f(u.uLevel, frame.audio.level);
      gl.uniform1f(u.uBass, frame.audio.bass);
      gl.uniform1f(u.uMid, frame.audio.mid);
      gl.uniform1f(u.uTreble, frame.audio.treble);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
    },
  };
}
