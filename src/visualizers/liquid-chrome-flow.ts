import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Liquid chrome: a domain-warped height field rendered as a perfect mirror of a simple
// sky / horizon / ground studio, which gives the classic black-and-white chrome bands.
// All fbm passes return analytic gradients, and the warp's Jacobian is applied with the
// chain rule, so the exact surface normal costs no extra evaluations (3 vec2 + 4 scalar
// noise lookups per pixel instead of the previous 75). Kicks send ring ripples through
// the metal.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uFlow;   // accumulated flow phase (audio modulates the rate on the CPU)
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec4 uRip[4];  // kick ripples: center.xy, age in seconds, strength
uniform vec3 uPrimary;
uniform vec3 uAccent;

// integer lattice hash (only ever called on floor() lattice points): the flow phase grows
// without bound and feeds the lattice, and a float hash like fract(p * 311.7) loses its
// precision after an hour or two (the chrome normals turn faceted); integer math stays exact
float hash(vec2 p) {
  uvec2 q = uvec2(ivec2(p));
  q = q * 1664525u + 1013904223u;
  q.x += q.y * 1664525u;
  q.y += q.x * 1664525u;
  q ^= q >> 16u;
  q.x += q.y * 1664525u;
  q.y += q.x * 1664525u;
  q ^= q >> 16u;
  return float(q.x ^ q.y) * (1.0 / 4294967295.0);
}

// value noise + analytic gradient, quintic fade (C2) so the mirror bands stay smooth
vec3 noised(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  float k1 = b - a;
  float k2 = c - a;
  float k4 = a - b - c + d;
  return vec3(a + k1 * u.x + k2 * u.y + k4 * u.x * u.y,
              du * vec2(k1 + k4 * u.y, k2 + k4 * u.x));
}

vec2 hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// two independent noises + gradients from one set of lattice lookups (the warp layer)
void noised2(vec2 p, out vec3 na, out vec3 nb) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec2 a = hash2(i);
  vec2 b = hash2(i + vec2(1.0, 0.0));
  vec2 c = hash2(i + vec2(0.0, 1.0));
  vec2 d = hash2(i + vec2(1.0, 1.0));
  vec2 k1 = b - a;
  vec2 k2 = c - a;
  vec2 k4 = a - b - c + d;
  vec2 v = a + k1 * u.x + k2 * u.y + k4 * u.x * u.y;
  vec2 gx = du.x * (k1 + k4 * u.y);
  vec2 gy = du.y * (k2 + k4 * u.x);
  na = vec3(v.x, gx.x, gy.x);
  nb = vec3(v.y, gx.y, gy.y);
}

const mat2 M2 = mat2(1.6, 1.2, -1.2, 1.6); // 2x scale + rotation between octaves

// 3-octave vec2 fbm with gradients (see fbmd for the J pull-back)
void fbmd2(vec2 p, out vec3 qa, out vec3 qb) {
  qa = vec3(0.0);
  qb = vec3(0.0);
  float a = 0.5;
  mat2 J = mat2(1.0);
  for (int i = 0; i < 3; i++) {
    vec3 na;
    vec3 nb;
    noised2(p, na, nb);
    qa += a * vec3(na.x, na.yz * J);
    qb += a * vec3(nb.x, nb.yz * J);
    a *= 0.5;
    p = M2 * p + vec2(1.7, 9.2);
    J = M2 * J;
  }
}

// fbm returning vec3(value, d/dp): each octave's gradient is pulled back through the
// accumulated octave transform J (row-vector * J == transpose(J) * grad).
vec3 fbmd(vec2 p) {
  float v = 0.0;
  vec2 d = vec2(0.0);
  float a = 0.5;
  mat2 J = mat2(1.0);
  for (int i = 0; i < 4; i++) {
    vec3 n = noised(p);
    v += a * n.x;
    d += a * (n.yz * J);
    a *= 0.5;
    p = M2 * p + vec2(1.7, 9.2);
    J = M2 * J;
  }
  return vec3(v, d);
}

// Mirror environment: hazy bright horizon fading into a deep palette sky, black ground
// right under the horizon with a lit floor further down, a hot horizon rim and a sun.
vec3 env(vec3 r) {
  float y = r.y + 0.22 * r.x; // slightly tilted horizon
  vec3 haze = mix(vec3(1.0), uAccent, 0.3);
  vec3 sky = mix(haze, uPrimary * 0.3, pow(smoothstep(0.0, 0.9, y), 0.6));
  float gy = -y;
  vec3 ground = mix(uPrimary, vec3(0.7), 0.45) * 0.42 * smoothstep(0.03, 0.35, gy);
  ground *= 1.0 - smoothstep(0.6, 1.1, gy) * 0.7;
  vec3 c = mix(ground, sky, smoothstep(-0.012, 0.012, y));
  c += mix(vec3(1.0), uAccent, 0.5) * exp(-abs(y - 0.02) * 50.0) * 0.45;
  c += pow(max(dot(r, vec3(-0.42, 0.55, 0.72)), 0.0), 90.0) * (1.4 + uTreble * 1.5);
  return c;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  vec2 p = uv * 1.25;
  float f = uFlow;

  // Domain warp with exact derivatives: h(p) = fbm(p + W q(p))
  vec3 qx;
  vec3 qy;
  fbmd2(p + vec2(f * 0.3, f * 0.16), qx, qy);
  float W = 1.3;
  vec3 hf = fbmd(p + W * vec2(qx.x, qy.x) + vec2(1.7 + f * 0.2, 9.2 - f * 0.1));
  // chain rule: grad h = grad f + W (df/dwx grad qx + df/dwy grad qy)
  vec2 g = (hf.yz + W * (hf.y * qx.yz + hf.z * qy.yz)) * 1.25;

  // bass deepens the relief a little (amplitude only, returns to rest)
  g *= 0.13 + uBass * 0.035;

  // Kick ripples: traveling ring wave packets
  for (int i = 0; i < 4; i++) {
    vec4 rp = uRip[i];
    float age = rp.z;
    if (age > 2.0) continue;
    vec2 dv = uv - rp.xy;
    float d = length(dv) + 1e-4;
    float x = d - (0.04 + age * 0.62);
    float w = 0.07 + age * 0.08;
    float e = exp(-x * x / (w * w)) * exp(-age * 1.5) * (1.0 - smoothstep(1.4, 2.0, age));
    float k = 42.0;
    float ph = k * x;
    g += 0.012 * rp.w * e * (k * cos(ph) - 2.0 * x / (w * w) * sin(ph)) * dv / d;
  }

  vec3 N = normalize(vec3(-g, 1.0));
  vec3 V = normalize(vec3(uv * 0.3, -1.0));
  vec3 R = reflect(V, N);

  vec3 col = env(R) * 0.92;
  // faint cool body color in the darks so they never read as holes
  col += vec3(0.025, 0.028, 0.035) + uPrimary * 0.02;

  // kick: the studio lights flare
  col *= 1.0 + uBeat * 0.4;

  col = col / (1.0 + col * 0.25); // soft shoulder so the sun does not clip flat
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = ['uResolution', 'uFlow', 'uBass', 'uTreble', 'uBeat', 'uRip', 'uPrimary', 'uAccent'] as const;

const RIPPLES = 4;

// deterministic 0..1 pseudo-random for ripple placement
function rand(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function createLiquidChromeFlow(): Visualizer {
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
    id: 'liquid-chrome-flow',
    name: 'Liquid Chrome Flow',
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
      flow += (0.12 + a.level * 0.16 + a.beat * 0.35) * dt;
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
        rip[o] = (rand(hits) - 0.5) * 0.9;
        rip[o + 1] = (rand(hits + 0.5) - 0.5) * 0.5;
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
