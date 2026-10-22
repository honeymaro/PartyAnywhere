import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// A sheet of rippling glass in front of a backdrop of bokeh lights and fine pinstripes.
// The backdrop has crisp structure on purpose: refraction is only visible when it bends
// something. Each bokeh light glows with the live spectrum at its screen column (bass on
// the left, treble on the right). The glass is a smooth height field (analytic gradient,
// no extra noise calls for the normal) and kicks send ring ripples across it.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uFlow;   // accumulated glass flow phase (audio modulates the rate on the CPU)
uniform float uTreble;
uniform float uBeat;
uniform vec4 uRip[4];  // kick ripples: center.xy, age in seconds, strength
uniform vec3 uPrimary;
uniform vec3 uAccent;
uniform sampler2D uSpectrum;

const float CELLS = 5.5; // bokeh grid density (cells per screen height)

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

// value noise + analytic gradient, quintic fade so the glass stays optically smooth
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

// Backdrop seen through the glass: dark gradient, pinstripes, one bokeh disc per cell.
vec3 backdrop(vec2 q) {
  vec3 c = mix(uPrimary * 0.12, uAccent * 0.1, smoothstep(-0.7, 0.7, q.y + q.x * 0.35)) + 0.01;

  // fine diagonal pinstripes (anti-aliased against the screen-space footprint)
  float sc = dot(q, vec2(0.6, 0.8)) * 22.0;
  float st = abs(fract(sc) - 0.5);
  float fw = fwidth(sc);
  c += mix(uPrimary, uAccent, 0.5) * (1.0 - smoothstep(0.06, 0.06 + fw, st)) * 0.1;

  // bokeh lights: one jittered disc per cell, bright rim like a lens highlight
  vec2 gq = q * CELLS;
  vec2 id = floor(gq);
  vec2 f = fract(gq) - 0.5;
  float h1 = hash(id);
  float h2 = hash(id + 17.3);
  float h3 = hash(id + 3.7);
  vec2 off = (vec2(h1, h2) - 0.5) * 0.28;
  float r = 0.16 + 0.17 * h3;
  float d = length(f - off);
  float aa = fwidth(d) + 0.01;
  float disc = 1.0 - smoothstep(r - aa, r + aa, d);
  float rim = smoothstep(r - 0.09, r - 0.01, d) * disc;
  // the light's screen column picks its spectrum bin (left = bass, right = treble)
  float sx = clamp((id.x + 0.5 + off.x) / CELLS / (uResolution.x / uResolution.y) + 0.5, 0.0, 1.0);
  float spec = texture(uSpectrum, vec2(sx * 0.92 + 0.02, 0.5)).r;
  float b = (0.55 + 1.0 * spec * spec) * (0.55 + 0.45 * h1);
  vec3 dc = mix(uPrimary, uAccent, smoothstep(0.25, 0.75, h2));
  c += dc * (disc * 0.45 + rim * 0.65) * b;
  return c;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  // Glass relief: 2 octaves drifting different ways (gradient in uv units)
  vec3 n1 = noised(uv * 1.7 + vec2(uFlow * 0.3, -uFlow * 0.12));
  vec3 n2 = noised(uv * 3.6 + vec2(4.1 - uFlow * 0.2, 7.7 + uFlow * 0.26));
  vec2 g = n1.yz * 1.7 * 0.65 + n2.yz * 3.6 * 0.3;
  g *= 0.09;

  // Kick ripples: traveling ring wave packets
  for (int i = 0; i < 4; i++) {
    vec4 rp = uRip[i];
    float age = rp.z;
    if (age > 2.0) continue;
    vec2 dv = uv - rp.xy;
    float d = length(dv) + 1e-4;
    float x = d - (0.05 + age * 0.6);
    float w = 0.06 + age * 0.08;
    float e = exp(-x * x / (w * w)) * exp(-age * 1.4) * (1.0 - smoothstep(1.4, 2.0, age));
    float k = 38.0;
    float ph = k * x;
    g += 0.014 * rp.w * e * (k * cos(ph) - 2.0 * x / (w * w) * sin(ph)) * dv / d;
  }

  // Refraction: the backdrop is displaced along the slope, with chromatic split
  vec2 disp = -g * 0.12;
  float ca = 0.12 + uTreble * 0.2;
  vec3 col;
  col.r = backdrop(uv + disp * (1.0 + ca)).r;
  col.g = backdrop(uv + disp).g;
  col.b = backdrop(uv + disp * (1.0 - ca)).b;

  // Glass surface: soft sheen on slopes + a sharp specular streak
  vec3 N = normalize(vec3(-g * 1.4, 1.0));
  vec3 V = normalize(vec3(uv * 0.4, -1.0));
  vec3 R = reflect(V, N);
  float sp = pow(max(dot(R, normalize(vec3(-0.35, 0.5, 0.8))), 0.0), 300.0);
  float slope = length(g);
  col += mix(vec3(1.0), uAccent, 0.3) * sp * 0.25;
  col += mix(uPrimary, uAccent, 0.5) * smoothstep(0.05, 0.4, slope) * 0.12;

  // kick: the lights behind the glass flare
  col *= 1.0 + uBeat * 0.45;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = ['uResolution', 'uFlow', 'uTreble', 'uBeat', 'uRip', 'uPrimary', 'uAccent', 'uSpectrum'] as const;

const RIPPLES = 4;

// deterministic 0..1 pseudo-random for ripple placement
function rand(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function createLiquidGlassRefract(): Visualizer {
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
  let flow = 0; // glass flow phase (audio modulates the rate; only ever increases)

  return {
    id: 'liquid-glass-refract',
    name: 'Liquid Glass Refraction',
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
      flow += (0.1 + a.mid * 0.12 + a.beat * 0.3) * dt;
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
        rip[o] = (rand(hits) - 0.5) * 1.1;
        rip[o + 1] = (rand(hits + 0.5) - 0.5) * 0.6;
        rip[o + 2] = 0;
        rip[o + 3] = Math.max(a.beat, a.bass);
        slot = (slot + 1) % RIPPLES;
      }
      prevBass = a.bass;
      prevBeat = a.beat;

      gl.useProgram(program);
      ctx.quad.bind(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, ctx.spectrumTex);
      gl.uniform1i(u.uSpectrum, 0);
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uFlow, flow);
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
