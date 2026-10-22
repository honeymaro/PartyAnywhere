import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Oil film on dark wet asphalt: a double domain warp (vec2 noise, so each warp layer costs
// one fbm instead of two) gives a swirling film thickness; thin-film interference turns the
// thickness into fringe colors built from the live palette with a little spectral shimmer.
// Between oil patches the dark substrate shows through. Kicks drop "detergent" that pushes
// an expanding interference ring through the film; the fringes flare with the beat.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uFlow;   // accumulated flow phase (audio modulates the rate on the CPU)
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec4 uRip[5];  // kick rings: center.xy, age in seconds, strength
uniform vec3 uPrimary;
uniform vec3 uAccent;

const float TWO_PI = 6.28318530718;

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.3);
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
  for (int i = 0; i < 3; i++) {
    if (i >= oct) break;
    v += a * noise2(p);
    n += a;
    p = M2 * p + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v / n;
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = M2 * p + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v / 0.9375;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  vec2 p = uv * 1.5;
  float f = uFlow;

  // double domain warp (constant strength; audio only sets the flow rate)
  vec2 q = fbm2(p + vec2(f * 0.1, f * 0.07), 2);
  vec2 r = fbm2(p + 2.6 * q + vec2(1.7 - f * 0.06, 9.2 + f * 0.09), 3);
  float h = fbm(p + 2.6 * r + vec2(8.3, 2.8));

  // film thickness: warped field plus kick rings pushing through it
  float T = h * 1.7 + r.x * 0.5;
  float ringGlow = 0.0;
  for (int i = 0; i < 5; i++) {
    vec4 rp = uRip[i];
    float age = rp.z;
    if (age > 2.5) continue;
    float d = length(uv - rp.xy);
    float x = d - (0.04 + age * 0.45);
    float e = exp(-x * x / 0.006) * exp(-age * 1.1) * (1.0 - smoothstep(1.8, 2.5, age)) * rp.w;
    T += e * 0.6;
    ringGlow += e;
  }

  // thin-film interference: fringe orders cycle through the palette, with a
  // spectral shimmer (the physical rainbow) blended in as a secondary accent
  float ph = T * 2.2;
  vec3 pal = mix(uPrimary, uAccent, 0.5 + 0.5 * cos(TWO_PI * ph));
  vec3 rainbow = 0.5 + 0.5 * cos(TWO_PI * (ph * 1.3 + vec3(0.0, 0.33, 0.67)));
  vec3 film = mix(pal, rainbow, 0.3);
  // bright fringe crests, darker troughs
  float fringe = 0.45 + 0.55 * pow(0.5 + 0.5 * cos(TWO_PI * ph * 2.0), 1.5);
  film *= fringe;

  // oil only sits in patches; dark wet asphalt shows between them
  float cover = smoothstep(0.32, 0.62, h + 0.15 * (q.y - 0.5));
  vec3 col = vec3(0.012, 0.014, 0.02) + vec3(0.02, 0.022, 0.03) * q.x;
  col += film * cover * (0.75 + uBass * 0.25 + uBeat * 0.35);

  // the kick ring itself glints
  col += mix(vec3(1.0), uAccent, 0.4) * ringGlow * 0.6;

  // wet sheen: a broad soft highlight drifting across, sparkling with treble
  float sheen = smoothstep(0.55, 0.95, r.y) * (0.06 + uTreble * 0.08);
  col += sheen * mix(vec3(1.0), film, 0.5);

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = ['uResolution', 'uFlow', 'uBass', 'uTreble', 'uBeat', 'uRip', 'uPrimary', 'uAccent'] as const;

const RIPPLES = 5;

// deterministic 0..1 pseudo-random for ring placement
function rand(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function createOilSlickWarp(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  const rip = new Float32Array(RIPPLES * 4); // x, y, age, strength
  let slot = 0;
  let hits = 0;
  let prevBass = 0;
  let prevBeat = 0;
  let sinceHit = 1;
  let flow = 0; // flow phase (audio modulates the rate; only ever increases)

  return {
    id: 'oil-slick-warp',
    name: 'Oil Slick Domain Warp',
    init(context: VisualizerContext) {
      ctx = context;
      gl = context.gl;
      program = context.compileFragment(FRAG);
      for (const name of NAMES) u[name] = gl.getUniformLocation(program, name);
      for (let i = 0; i < RIPPLES; i++) rip[i * 4 + 2] = 99;
    },
    resize() {},
    render(frame: RenderFrame) {
      const dt = Math.min(frame.dt, 0.1);
      const a = frame.audio;
      flow += (0.12 + a.mid * 0.12 + a.beat * 0.35) * dt;
      for (let i = 0; i < RIPPLES; i++) rip[i * 4 + 2] += dt;
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
        rip[o] = (rand(hits) - 0.5) * 1.0;
        rip[o + 1] = (rand(hits + 0.5) - 0.5) * 0.55;
        rip[o + 2] = 0;
        rip[o + 3] = Math.max(a.beat, a.bass);
        slot = (slot + 1) % RIPPLES;
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
      gl.uniform4fv(u.uRip, rip);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
    },
  };
}
