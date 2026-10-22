import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// A pool of liquid mercury seen from above, reflecting a dim studio lit by large soft lights.
// The surface is a slow heavy swell (2 octaves of smooth value noise, analytic gradient)
// plus broad ring ripples spawned by kicks on the CPU (center, age, strength per ripple).
// Everything is a height-field gradient, so the normal costs no extra noise evaluations.
// All lights have soft Gaussian profiles: hard-edged thin lights alias into zigzags once
// the ripples bend them.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uFlow;    // accumulated swell phase (audio modulates the rate on the CPU)
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec4 uRip[4];   // kick ripples: center.xy, age in seconds, strength
uniform vec3 uPrimary;
uniform vec3 uAccent;

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

// value noise + analytic gradient, quintic fade (C2) so reflections stay smooth
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

// Studio environment as seen in the reflection (r points up, away from the pool).
vec3 env(vec3 r) {
  vec2 s = r.xy / max(r.z, 0.08); // where the ray hits the ceiling plane
  // broad silvery ceiling gradient with a faint palette cast
  float g = smoothstep(-0.7, 0.7, s.y + 0.3 * s.x);
  vec3 c = mix(vec3(0.11, 0.115, 0.13), vec3(0.44, 0.45, 0.48), g);
  c += mix(uPrimary, uAccent, g) * 0.07;
  // wide soft ring light, its color sweeping between the palette hues
  float rr = length(s - vec2(0.03, -0.01));
  float ring = exp(-(rr - 0.21) * (rr - 0.21) / 0.0012);
  vec3 ringCol = mix(uPrimary, uAccent, 0.5 + 0.35 * (s.x - s.y) / max(rr, 0.01));
  c += ring * mix(vec3(1.0), ringCol, 0.55) * 0.9;
  // large soft box, accent tinted (rounded, with a long falloff)
  vec2 b1 = max(abs(s - vec2(-0.27, 0.16)) - vec2(0.07, 0.035), 0.0);
  float box = exp(-dot(b1, b1) / 0.0025);
  c += box * mix(vec3(1.0), uAccent, 0.45) * 1.1;
  // soft bar light, primary tinted
  vec2 b2 = max(abs(s - vec2(0.24, -0.2)) - vec2(0.1, 0.0), 0.0);
  float bar = exp(-dot(b2, b2) / 0.0016);
  c += bar * mix(vec3(1.0), uPrimary, 0.5) * 1.0;
  // steep ripple faces catch a colored glow from the room's walls
  c += mix(uPrimary, uAccent, 0.5 + 0.5 * r.x) * smoothstep(0.8, 0.4, r.z) * 0.7;
  return c;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  // Heavy swell: two octaves, each drifting its own way so the surface slowly morphs.
  // Bass lifts the swell amplitude a little (a local displacement that returns to rest).
  vec3 n1 = noised(uv * 1.4 + vec2(uFlow * 0.31, uFlow * 0.17));
  vec3 n2 = noised(uv * 2.9 + vec2(5.3 - uFlow * 0.23, 1.7 + uFlow * 0.29));
  vec2 g = (n1.yz * 1.4 * 0.6 + n2.yz * 2.9 * 0.16) * (0.06 + uBass * 0.025);

  // Kick ripples: one broad traveling wave packet per kick (1-2 crests, wavelength
  // ~0.2 screen heights) plus a short-lived impact dome; older ripples fade fast.
  for (int i = 0; i < 4; i++) {
    vec4 rp = uRip[i];
    float age = rp.z;
    if (age > 1.6) continue;
    vec2 dv = uv - rp.xy;
    float d = length(dv) + 1e-4;
    float x = d - (0.05 + age * 0.45);  // distance behind/ahead of the front
    float w = 0.08 + age * 0.08;        // packet widens as it travels
    float e = exp(-x * x / (w * w)) * exp(-age * 2.0) * (1.0 - smoothstep(1.1, 1.6, age));
    float k = 30.0;
    float ph = k * x;
    // d/dx of A sin(kx) exp(-x^2/w^2)
    float slope = 0.0095 * rp.w * e * (k * cos(ph) - 2.0 * x / (w * w) * sin(ph));
    // impact dome that collapses within ~0.25 s
    float dome = -0.02 * rp.w * exp(-age * 6.0) * exp(-d * d / 0.012) * (2.0 * d / 0.012);
    g += (slope + dome) * dv / d;
  }

  vec3 N = normalize(vec3(-g, 1.0));
  vec3 V = normalize(vec3(uv * 0.5, -1.0));
  vec3 R = reflect(V, N);

  // mercury: high, slightly cool reflectance at every angle
  float fres = 0.8 + 0.2 * pow(1.0 - clamp(-dot(V, N), 0.0, 1.0), 5.0);
  vec3 col = env(R) * vec3(0.84, 0.86, 0.9) * fres;

  // a clean soft highlight from a point light (treble makes it glint harder)
  vec3 L = normalize(vec3(0.35, 0.45, 1.0));
  float sp = pow(max(dot(R, L), 0.0), 60.0);
  col += vec3(1.0) * sp * (0.35 + uTreble * 0.45);

  // lights flare on the kick
  col *= 1.0 + uBeat * 0.35;

  // soft vignette keeps the pool edges in shadow
  col *= 1.0 - smoothstep(0.55, 1.25, length(uv)) * 0.55;

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

export function createLiquidMercuryPool(): Visualizer {
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
  let flow = 0; // swell phase (audio modulates the rate; only ever increases)

  return {
    id: 'liquid-mercury-pool',
    name: 'Liquid Mercury Pool',
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
      flow += (0.25 + a.level * 0.3 + a.beat * 0.5) * dt;
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
        const ang = rand(hits) * Math.PI * 2;
        const rad = 0.08 + rand(hits + 0.5) * 0.35;
        rip[o] = Math.cos(ang) * rad * 1.4;
        rip[o + 1] = Math.sin(ang) * rad;
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
