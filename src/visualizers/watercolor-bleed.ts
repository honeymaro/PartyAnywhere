import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Light watercolor washes on warm paper. Two slowly drifting washes come from one warped
// vec2 fbm (both masks share the lattice lookups); pigment pools along each wash edge,
// which needs only the mask value (no gradient, so no extra fbm evaluations). Pigments are
// multiplied onto the paper like real transparent glazes. Every kick drops a new bloom of
// wet paint that spreads with a ragged edge, starts dark and dries lighter.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uFlow;      // accumulated drift phase (audio modulates the rate on the CPU)
uniform float uLevel;
uniform float uTreble;
uniform float uBeat;
uniform vec4 uBloom[8];   // kick blooms: center.xy, age in seconds, strength
uniform vec3 uPrimary;
uniform vec3 uAccent;

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 17.5);
  return fract(p.x * p.y);
}

vec2 hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
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

// two independent value noises from one set of lattice lookups
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

const mat2 M2 = mat2(1.6, 1.2, -1.2, 1.6); // 2x scale + rotation between octaves

vec2 fbm2(vec2 p, int oct) {
  vec2 v = vec2(0.0);
  float a = 0.5;
  float n = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= oct) break;
    v += a * noise2(p);
    n += a;
    p = M2 * p + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v / n;
}

// pigment density of a wash: a light body plus pigment pooled just inside the edge
float wash(float m, float t) {
  float inside = smoothstep(t, t + 0.012, m);
  float rim = inside * (1.0 - smoothstep(t + 0.008, t + 0.07, m));
  return inside * 0.3 + rim * 0.36;
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  float f = uFlow;

  // shared warp, then two wash masks from one vec2 fbm
  vec2 w = fbm2(p * 1.3 + vec2(f * 0.05, -f * 0.03), 2) - 0.5;
  vec2 m = fbm2(p * 1.05 + w * 0.9 + vec2(3.1 - f * 0.02, 1.7 + f * 0.035), 4);

  // paper tooth: pigment settles in the grain (granulation)
  float grain = noise(p * 230.0);
  float gran = 0.82 + 0.36 * grain;

  float sat = 1.0 + uLevel * 0.15;
  vec3 trans = vec3(1.0); // accumulated transmittance of all glazes
  trans *= mix(vec3(1.0), uPrimary, clamp(wash(m.x, 0.54) * gran * sat, 0.0, 1.0));
  trans *= mix(vec3(1.0), uAccent, clamp(wash(m.y, 0.57) * gran * sat, 0.0, 1.0));

  // ragged edge offset for the blooms: one finer vec2 lookup (two channels) plus the wash field
  vec2 e1 = noise2(p * 7.0 + 11.3);
  float ragged = (e1.x - 0.5) * 0.07 + (e1.y - 0.5) * 0.035 + (m.x - 0.5) * 0.12;

  // Kick blooms: wet paint spreading fast then slowing
  for (int i = 0; i < 8; i++) {
    vec4 b = uBloom[i];
    float age = b.z;
    if (age > 3.2) continue;
    float R = 0.07 + 0.19 * (1.0 - exp(-age * 2.6)) * (0.6 + 0.4 * b.w);
    float dd = length(p - b.xy) + ragged * (0.4 + R * 2.5);
    float inside = 1.0 - smoothstep(R - 0.005, R + 0.005, dd);
    float rim = inside * smoothstep(R - 0.045, R - 0.003, dd);
    float wet = 1.0 + 0.9 * exp(-age * 2.5);           // fresh paint is darker, dries lighter
    float fade = 1.0 - smoothstep(2.2, 3.2, age);
    float dens = (inside * 0.28 + rim * 0.36) * wet * fade * (0.6 + 0.4 * b.w) * gran;
    float pick = fract(b.x * 3.7 + b.y * 5.3 + 0.37);
    vec3 pc = pick < 0.4 ? uPrimary : (pick < 0.8 ? uAccent : mix(uPrimary, uAccent, 0.5));
    trans *= mix(vec3(1.0), pc, clamp(dens, 0.0, 1.0));
  }

  // warm paper with fiber tone; treble lifts the tooth a touch
  vec3 paper = vec3(0.95, 0.93, 0.885) * (0.955 + 0.045 * grain * (1.0 + uTreble * 0.6));
  vec3 col = paper * trans;

  // the sheet catches a little more light on the kick
  col *= 1.0 + uBeat * 0.04;
  // gentle vignette like a sheet under a lamp
  col *= 1.0 - smoothstep(0.55, 1.2, length(p)) * 0.12;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = ['uResolution', 'uFlow', 'uLevel', 'uTreble', 'uBeat', 'uBloom', 'uPrimary', 'uAccent'] as const;

const BLOOMS = 8;

// deterministic 0..1 pseudo-random for bloom placement
function rand(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function createWatercolorBleed(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  const blooms = new Float32Array(BLOOMS * 4); // x, y, age, strength
  let slot = 0;
  let hits = 0;
  let prevBass = 0;
  let prevBeat = 0;
  let sinceHit = 1;
  let flow = 0; // drift phase (audio modulates the rate; only ever increases)

  return {
    id: 'watercolor-bleed',
    name: 'Watercolor Bleed',
    init(context: VisualizerContext) {
      ctx = context;
      gl = context.gl;
      program = context.compileFragment(FRAG);
      for (const name of NAMES) u[name] = gl.getUniformLocation(program, name);
      for (let i = 0; i < BLOOMS; i++) blooms[i * 4 + 2] = 99;
    },
    resize() {},
    render(frame: RenderFrame) {
      const dt = Math.min(frame.dt, 0.1);
      const a = frame.audio;
      flow += (0.1 + a.level * 0.12 + a.beat * 0.2) * dt;
      for (let i = 0; i < BLOOMS; i++) blooms[i * 4 + 2] += dt;
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
        blooms[o] = (rand(hits) - 0.5) * 1.5;
        blooms[o + 1] = (rand(hits + 0.5) - 0.5) * 0.8;
        blooms[o + 2] = 0;
        blooms[o + 3] = Math.max(a.beat, a.bass);
        slot = (slot + 1) % BLOOMS;
      }
      prevBass = a.bass;
      prevBeat = a.beat;

      gl.useProgram(program);
      ctx.quad.bind(program);
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uFlow, flow);
      gl.uniform1f(u.uLevel, a.level);
      gl.uniform1f(u.uTreble, a.treble);
      gl.uniform1f(u.uBeat, a.beat);
      gl.uniform4fv(u.uBloom, blooms);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
    },
  };
}
