import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { AudioFrame, RenderFrame } from '../core/types';

// Vogel's sunflower spiral: seed n sits at radius C*sqrt(n), angle n * golden angle.
// The nearest seed is found exactly and cheaply: in (u, v) = (r^2/C^2, angle/2pi) the
// seeds form the lattice {(n, n*g mod 1)}, and two consecutive Fibonacci index steps
// (the visible parastichy counts at that radius) give a reduced local basis, so the
// nearest seed is one of the 4 corners of the pixel's lattice cell.
// Dot size follows the spectrum band at its radius (inner = bass, outer = treble); each
// detected onset sends a swelling, brightening wave through the seeds from the center.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uRotCS;    // cos/sin of the accumulated rotation (audio sets the rate)
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec4 uKickAge;  // seconds since the last 4 onsets (newest first)
uniform vec4 uKickAmp;  // their strengths 0..1
uniform vec3 uPrimary;
uniform vec3 uAccent;
uniform sampler2D uSpectrum;

const float TWO_PI = 6.28318530718;
const float G = 0.38196601125;  // golden angle / 2pi
const float GOLD = 1.61803398875;
const float N = 320.0;          // total seeds
const float C = 0.055;          // radial scale factor
const float R_MAX = 0.98;       // C * sqrt(N - 1)

float fib(float k) { return floor(pow(GOLD, k) / 2.2360679775 + 0.5); }

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  vec2 p = vec2(uv.x * uRotCS.x + uv.y * uRotCS.y, -uv.x * uRotCS.y + uv.y * uRotCS.x);
  float r = length(p);

  // lattice coordinates of the pixel
  float u = (r / C) * (r / C);
  float v = atan(p.y, p.x) / TWO_PI;
  float k = max(2.0, floor(0.5 * log(max(28.1 * u, 1.0)) / log(GOLD)));
  float F0 = fib(k);
  float F1 = fib(k + 1.0);
  float e0 = F0 * G - floor(F0 * G + 0.5);
  float e1 = F1 * G - floor(F1 * G + 0.5);
  float det = F0 * e1 - F1 * e0;
  float b0 = floor((e1 * u - F1 * v) / det);
  float b1 = floor((F0 * v - e0 * u) / det);

  float minDist = 1e9;
  float bestN = 0.0;
  for (int i = 0; i < 2; i++) {
    for (int j = 0; j < 2; j++) {
      float n = (b0 + float(i)) * F0 + (b1 + float(j)) * F1;
      if (n < 0.0 || n >= N) continue;
      float ang = TWO_PI * fract(n * G);
      vec2 seedPos = C * sqrt(n) * vec2(cos(ang), sin(ang));
      float d = length(p - seedPos);
      if (d < minDist) {
        minDist = d;
        bestN = n;
      }
    }
  }

  float rs = C * sqrt(bestN) / R_MAX; // seed radius 0..1
  float s = texture(uSpectrum, vec2(0.02 + rs * 0.88, 0.5)).r;

  // onset waves rolling outward through the seeds
  float wave = 0.0;
  for (int i = 0; i < 4; i++) {
    float age = uKickAge[i];
    float x = (rs - age * 1.25) / 0.09;
    wave += uKickAmp[i] * exp(-x * x) * exp(-age * 1.3);
  }

  float dotSize = 0.013 + s * 0.012 + uBass * 0.005 + wave * 0.012;
  float aa = 1.5 / min(uResolution.x, uResolution.y);
  float dotMask = smoothstep(dotSize + aa, dotSize - aa, minDist);

  vec3 c = mix(uPrimary, uAccent, smoothstep(0.1, 0.95, rs));
  c *= 0.7 + s * 0.6;
  // treble shimmer on a scattered subset of seeds
  float hs = fract(sin(bestN * 12.9898) * 43758.5453);
  float sparkle = step(0.8, hs) * uTreble * (0.5 + 0.5 * sin(bestN * 17.3 + uTime * 6.0));
  c += vec3(0.6) * sparkle * 0.5;
  c = mix(c, vec3(1.0), clamp(wave * 0.55, 0.0, 0.7));
  c *= 1.0 + uBeat * 0.25;

  // background: deep dark tint, soft halos around the dots
  vec3 col = mix(uPrimary, vec3(0.0), 0.94) * 0.6;
  col += mix(uPrimary, uAccent, rs) * exp(-max(minDist - dotSize, 0.0) * 60.0) * (0.12 + wave * 0.35);
  col = mix(col, c, dotMask);
  // soft center glow with the bass
  col += mix(uPrimary, uAccent, 0.3) * exp(-r * r * 30.0) * (0.06 + uBass * 0.12);

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uRotCS', 'uBass', 'uTreble', 'uBeat', 'uKickAge', 'uKickAmp',
  'uPrimary', 'uAccent', 'uSpectrum',
] as const;

export function createPhyllotaxisSpiral(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let rotation = 0; // pattern rotation (audio sets the rate; only ever increases)
  // Onset events detected on the CPU (rising edge), newest first.
  const kickAge = new Float32Array(4).fill(99);
  const kickAmp = new Float32Array(4);
  let prevBeat = 0;
  let prevBass = 0;

  function trackKicks(a: AudioFrame, dt: number): void {
    for (let i = 0; i < 4; i++) kickAge[i] += dt;
    const onset = (a.beat - prevBeat > 0.25 && a.beat > 0.6) || (a.bass - prevBass > 0.18 && a.bass > 0.7);
    const amp = Math.min(1, 0.3 + 0.7 * a.bass);
    if (onset && kickAge[0] > 0.1) {
      kickAge.copyWithin(1, 0);
      kickAmp.copyWithin(1, 0);
      kickAge[0] = 0;
      kickAmp[0] = amp;
    } else if (onset) {
      kickAmp[0] = Math.max(kickAmp[0], amp); // bass landed a frame after the onset
    }
    prevBeat = a.beat;
    prevBass = a.bass;
  }

  return {
    id: 'phyllotaxis-spiral',
    name: 'Phyllotaxis Spiral Dots',
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
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, ctx.spectrumTex);
      gl.uniform1i(u.uSpectrum, 0);
      const a = frame.audio;
      trackKicks(a, frame.dt);
      rotation = (rotation + (0.1 + a.mid * 0.1 + a.beat * 0.45) * frame.dt) % (Math.PI * 2);
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uTime, frame.time);
      gl.uniform2f(u.uRotCS, Math.cos(rotation), Math.sin(rotation));
      gl.uniform1f(u.uBass, a.bass);
      gl.uniform1f(u.uTreble, a.treble);
      gl.uniform1f(u.uBeat, a.beat);
      gl.uniform4fv(u.uKickAge, kickAge);
      gl.uniform4fv(u.uKickAmp, kickAmp);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
    },
  };
}
