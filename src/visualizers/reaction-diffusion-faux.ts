import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Faux Turing pattern. Real reaction-diffusion settles into a single characteristic
// wavelength, so this thresholds band-limited noise: two gradient-noise layers of the same
// frequency at different orientations. As the layers drift against each other (accumulated
// phase, audio sets the rate) the labyrinth slowly reconnects like a living culture. A slow
// "feed rate" field makes some regions spotty and others striped (stripes follow the zero
// set of the field, so they keep an even width). Kicks send a growth front
// outward that swells the cells it passes and lights their membranes.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uFlow;    // accumulated morph phase (audio modulates the rate on the CPU)
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec4 uRing[4];  // kick growth fronts: center.xy, age in seconds, strength
uniform vec3 uPrimary;
uniform vec3 uAccent;

vec2 hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// gradient noise (roughly -0.7..0.7, isotropic enough to read as organic) with its
// analytic gradient in .yz
vec3 gnoised(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec2 ga = hash2(i) * 2.0 - 1.0;
  vec2 gb = hash2(i + vec2(1.0, 0.0)) * 2.0 - 1.0;
  vec2 gc = hash2(i + vec2(0.0, 1.0)) * 2.0 - 1.0;
  vec2 gd = hash2(i + vec2(1.0, 1.0)) * 2.0 - 1.0;
  float va = dot(ga, f);
  float vb = dot(gb, f - vec2(1.0, 0.0));
  float vc = dot(gc, f - vec2(0.0, 1.0));
  float vd = dot(gd, f - vec2(1.0, 1.0));
  float k4 = va - vb - vc + vd;
  return vec3(va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * k4,
              ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd)
                 + du * (u.yx * k4 + vec2(vb, vc) - va));
}

const mat2 ROT = mat2(0.8, 0.6, -0.6, 0.8);

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  float f = uFlow;

  // band-limited field: two same-frequency layers drifting against each other
  // (gradients pulled back to uv units: d/duv of g(ROT * uv * s) == s * (grad * ROT))
  vec2 p = uv * 13.0;
  vec3 l1 = gnoised(p + vec2(f * 0.35, f * 0.12));
  vec3 l2 = gnoised(ROT * p * 0.93 + vec2(17.0 - f * 0.14, 5.0 + f * 0.3));
  float n = l1.x * 0.62 + l2.x * 0.48;
  vec2 gn = (l1.yz * 0.62 + (l2.yz * ROT) * (0.93 * 0.48)) * 13.0;

  // slow "feed rate" field blends two regimes: uniform-width labyrinth stripes along the
  // zero set of n, and isolated spots on its peaks
  float region = gnoised(uv * 1.2 + vec2(f * 0.015, 3.0)).x;
  float spotty = smoothstep(-0.12, 0.22, region);

  // kick growth fronts fatten the cells they pass: stripes thicken, spots swell
  float front = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 rg = uRing[i];
    float age = rg.z;
    if (age > 2.2) continue;
    float x = length(uv - rg.xy) - (0.03 + age * 0.6);
    front += rg.w * exp(-age * 1.3) * (1.0 - smoothstep(1.6, 2.2, age)) * exp(-x * x / 0.008);
  }
  float grow = front * 0.12 + uBass * 0.02;

  // One band function for both regimes (blending two functions would flatten v in the
  // transition): cells are where |n - c| < w. c = 0 gives thin stripes on the zero set;
  // c = 0.45 with w = 0.23 keeps only the peaks (n > 0.22), i.e. spots. Smooth abs
  // avoids a crease.
  float c = spotty * 0.45;
  float wdt = mix(0.11, 0.23, spotty);
  float dn = n - c;
  float sa = sqrt(dn * dn + 0.0006);
  float v = wdt - sa + grow;
  // Exact per-pixel slope of v (no fwidth: its 2x2-quad steps break thin outlines into
  // dashes at low resolution). Edges are drawn by their distance in pixels.
  float slopeUv = length(gn) * abs(dn) / sa;
  float slopePx = max(slopeUv / min(uResolution.x, uResolution.y), 1e-6);
  float dpx = v / slopePx; // signed distance to the cell edge in pixels
  // Near a local extremum (a cell that is just nucleating or about to vanish) the slope
  // drops to ~0 and the blob is sub-pixel; fade those instead of flashing pixel specks.
  float solid = smoothstep(0.15, 0.45, slopeUv / 13.0);
  float cell = smoothstep(-0.7, 0.7, dpx) * mix(smoothstep(0.0, 0.03, v), 1.0, solid);
  // raised gel shading: brighter toward each ridge's spine
  float ridge = smoothstep(0.0, 0.12, v);
  // membrane: an outline of constant pixel width (scaled up on 4K buffers) around cells
  float px = max(1.0, uResolution.y / 1080.0);
  float membrane = (1.0 - smoothstep(1.2 * px, 1.2 * px + 1.2, abs(dpx))) * solid;

  vec3 bg = mix(uPrimary * 0.05, uAccent * 0.045, smoothstep(-0.4, 0.4, region)) + 0.008;
  vec3 cellCol = mix(uPrimary, uAccent, smoothstep(-0.35, 0.35, region + n * 0.25));
  vec3 col = bg;
  col = mix(col, cellCol * (0.3 + 0.55 * ridge), cell);
  float pulse = 0.28 + uBeat * 0.7 + front * 1.3 + uTreble * 0.12;
  col += mix(cellCol, vec3(1.0), 0.3) * membrane * pulse;

  // soft vignette, petri-dish feel
  col *= 1.0 - smoothstep(0.6, 1.3, length(uv)) * 0.45;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = ['uResolution', 'uFlow', 'uBass', 'uTreble', 'uBeat', 'uRing', 'uPrimary', 'uAccent'] as const;

const RINGS = 4;

// deterministic 0..1 pseudo-random for front placement
function rand(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function createReactionDiffusionFaux(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  const rings = new Float32Array(RINGS * 4); // x, y, age, strength
  let slot = 0;
  let hits = 0;
  let prevBass = 0;
  let prevBeat = 0;
  let sinceHit = 1;
  let flow = 0; // morph phase (audio modulates the rate; only ever increases)

  return {
    id: 'reaction-diffusion-faux',
    name: 'Faux Reaction Diffusion',
    init(context: VisualizerContext) {
      ctx = context;
      gl = context.gl;
      program = context.compileFragment(FRAG);
      for (const name of NAMES) u[name] = gl.getUniformLocation(program, name);
      for (let i = 0; i < RINGS; i++) rings[i * 4 + 2] = 99;
    },
    resize() {},
    render(frame: RenderFrame) {
      const dt = Math.min(frame.dt, 0.1);
      const a = frame.audio;
      flow += (0.12 + a.mid * 0.15 + a.beat * 0.5) * dt;
      for (let i = 0; i < RINGS; i++) rings[i * 4 + 2] += dt;
      sinceHit += dt;
      // Kick detector: the bass snaps up fast on a kick (> 11/s, i.e. +0.18 in one 60 fps
      // frame; slower bassline swells do not), or the onset pulse jumps to ~1.0 (kicks only;
      // snares, bass notes and hats pulse lower).
      const bassRise = (a.bass - prevBass) / Math.max(frame.dt, 1e-3);
      const kick = (a.bass > 0.6 && bassRise > 11) || (a.beat > 0.95 && a.beat > prevBeat + 0.2);
      if (kick && sinceHit > 0.2) {
        hits++;
        sinceHit = 0;
        const o = slot * 4;
        rings[o] = (rand(hits) - 0.5) * 0.8;
        rings[o + 1] = (rand(hits + 0.5) - 0.5) * 0.45;
        rings[o + 2] = 0;
        rings[o + 3] = Math.max(a.beat, a.bass);
        slot = (slot + 1) % RINGS;
      }
      prevBass = a.bass;
      prevBeat = a.beat;

      gl.useProgram(program);
      ctx.quad.bind(program);
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uFlow, flow);
      gl.uniform1f(u.uBass, a.bass);
      gl.uniform1f(u.uTreble, a.treble);
      gl.uniform1f(u.uBeat, a.beat);
      gl.uniform4fv(u.uRing, rings);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
    },
  };
}
