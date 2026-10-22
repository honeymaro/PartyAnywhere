import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Topographic map of a slowly morphing terrain. The terrain is a smooth 3-octave fbm with
// analytic gradient (hillshade for free); contour lines are anti-aliased with fwidth, so
// they stay crisp 1-2 px lines at any resolution, with a thicker index line every 5th level.
// Each contour level glows with one band of the live spectrum (low ground = bass, peaks =
// treble). Kicks raise a swell ring that runs outward and bends the contour lines.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uDrift;   // accumulated drift / morph phase (audio modulates the rate on the CPU)
uniform float uBass;
uniform float uBeat;
uniform vec4 uRing[4];  // kick swells: center.xy, age in seconds, strength
uniform vec3 uPrimary;
uniform vec3 uAccent;
uniform sampler2D uSpectrum;

const float LEVELS = 16.0;

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

// value noise + analytic gradient, quintic fade (smooth contours and shading)
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

const mat2 M2 = mat2(1.6, 1.2, -1.2, 1.6); // 2x scale + rotation between octaves

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  float t = uDrift;

  // smooth terrain: 3 octaves, each drifting a little differently so the land morphs
  vec2 p = uv * 1.4 + vec2(t * 0.06, t * 0.025);
  float h = 0.0;
  vec2 g = vec2(0.0);
  float amp = 0.55;
  mat2 J = mat2(1.4);
  vec2 q = p;
  for (int i = 0; i < 3; i++) {
    vec3 n = noised(q + vec2(t * 0.05, -t * 0.04) * float(i));
    h += amp * n.x;
    g += amp * (n.yz * J);
    q = M2 * q + vec2(1.7, 9.2);
    J = M2 * J;
    amp *= 0.42;
  }
  h = h / 0.882; // 0..1 range

  // kick swells: a ring of raised ground running outward
  float ringGlow = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 rg = uRing[i];
    float age = rg.z;
    if (age > 2.0) continue;
    vec2 dv = uv - rg.xy;
    float d = length(dv) + 1e-4;
    float x = d - (0.04 + age * 0.55);
    float e = rg.w * exp(-age * 1.1) * (1.0 - smoothstep(1.4, 2.0, age)) * exp(-x * x / 0.02);
    h += e * 0.14;
    g += e * 0.14 * (-2.0 * x / 0.02) * dv / d;
    ringGlow += e;
  }

  // contour lines, anti-aliased against the screen-space footprint; the line half-width
  // (in pixels) grows with the buffer height so lines do not turn into hairlines at 4K
  float c = h * LEVELS;
  float fw = max(fwidth(c), 1e-4);
  float px = max(1.0, uResolution.y / 1080.0);
  float dl = abs(fract(c + 0.5) - 0.5);
  float minor = 1.0 - smoothstep(fw * 0.6 * px, fw * (0.6 * px + 0.9), dl);
  float dli = abs(fract(c / 5.0 + 0.5) - 0.5) * 5.0;
  float major = 1.0 - smoothstep(fw * 1.2 * px, fw * (1.2 * px + 1.0), dli);

  // each level listens to one spectrum band: low ground = bass, peaks = treble
  float level = floor(c + 0.5);
  float spec = texture(uSpectrum, vec2(clamp((level - 3.0) / 11.0, 0.0, 1.0) * 0.9 + 0.03, 0.5)).r;

  // hypsometric fill with hillshade
  vec3 low = uPrimary * 0.08 + 0.012;
  vec3 mid = mix(uPrimary, uAccent, 0.3) * 0.26;
  vec3 high = mix(uAccent, vec3(1.0), 0.2) * 0.42;
  vec3 fill = mix(low, mid, smoothstep(0.2, 0.5, h));
  fill = mix(fill, high, smoothstep(0.55, 0.85, h));
  vec3 N = normalize(vec3(-g * 0.22, 1.0));
  float shade = 0.45 + 0.75 * max(dot(N, normalize(vec3(-0.5, 0.6, 0.62))), 0.0);
  vec3 col = fill * shade;

  // lines: brightness from their spectrum band, bass, beat and the passing swell
  vec3 lineCol = mix(mix(uPrimary, uAccent, smoothstep(0.3, 0.75, h)), vec3(1.0), 0.35);
  // (the steady part stays well under the cap so the beat term is still visible when loud)
  float bright = 0.36 + spec * spec * 0.55 + uBass * 0.1 + uBeat * 0.75 + ringGlow * 2.0;
  col *= 1.0 + uBeat * 0.3; // the whole terrain lifts on the kick
  col = mix(col, lineCol * min(bright, 1.6), clamp(minor * 0.55 + major * 0.9, 0.0, 1.0) * min(bright + 0.25, 1.0));
  col += mix(uAccent, vec3(1.0), 0.3) * ringGlow * 0.6;

  // cartographic vignette
  col *= 1.0 - smoothstep(0.6, 1.25, length(uv)) * 0.5;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uDrift', 'uBass', 'uBeat', 'uRing', 'uPrimary', 'uAccent', 'uSpectrum',
] as const;

const RINGS = 4;

// deterministic 0..1 pseudo-random for swell placement
function rand(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function createNoiseContourTopo(): Visualizer {
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
  let drift = 0; // drift / morph phase (audio modulates the rate; only ever increases)

  return {
    id: 'noise-contour-topo',
    name: 'Topographic Contour Lines',
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
      drift += (0.3 + a.level * 0.35 + a.beat * 0.6) * dt;
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
        rings[o] = (rand(hits) - 0.5) * 0.6;
        rings[o + 1] = (rand(hits + 0.5) - 0.5) * 0.35;
        rings[o + 2] = 0;
        rings[o + 3] = Math.max(a.beat, a.bass);
        slot = (slot + 1) % RINGS;
      }
      prevBass = a.bass;
      prevBeat = a.beat;

      gl.useProgram(program);
      ctx.quad.bind(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, ctx.spectrumTex);
      gl.uniform1i(u.uSpectrum, 0);
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uDrift, drift);
      gl.uniform1f(u.uBass, a.bass);
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
