import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// A night city whose buildings are equalizer bars: each front building samples the log
// spectrum at its position (bass left, treble right) for its height, with varied widths,
// a neon roof line, a lit window grid and the odd blinking antenna. A darker back row
// adds depth, stars twinkle with the treble, and everything mirrors into rippling water.
// Kicks flash the windows, roof lines and horizon glow.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;
uniform sampler2D uSpectrum;

const float HY = 0.3; // horizon height (fraction of screen height)

float hash11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float spec(float x) { return texture(uSpectrum, vec2(x, 0.5)).r; }

void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 p = gl_FragCoord.xy / uResolution.y;
  float px = 1.0 / uResolution.y;

  bool water = p.y < HY;
  float ly = abs(p.y - HY); // height above the horizon (mirrored below it)
  float x = p.x;
  if (water) {
    // ripples: small local displacement, a touch stronger with the bass
    float rip = sin(ly * 140.0 + uTime * 2.3) * 0.6 + sin(ly * 63.0 - uTime * 1.4 + x * 9.0) * 0.4;
    x += rip * (0.0025 + uBass * 0.004) * (0.4 + ly * 6.0);
  }
  float u01 = clamp(x / aspect, 0.0, 1.0);

  // ---- sky ----
  vec3 glowCol = mix(uPrimary, uAccent, 0.55);
  vec3 col = mix(vec3(0.012, 0.012, 0.03), vec3(0.02, 0.018, 0.05), smoothstep(0.7, 0.0, ly));
  col += glowCol * exp(-ly * 9.0) * (0.12 + uBass * 0.22 + uBeat * 0.2);
  if (!water && ly > 0.18) {
    vec2 sc = floor(p * 70.0);
    float sh = hash21(sc);
    if (sh < 0.06) {
      vec2 sp = (fract(p * 70.0) - 0.5);
      float tw = 0.5 + 0.5 * sin(uTime * (1.0 + sh * 30.0) + sh * 60.0);
      col += vec3(0.8, 0.85, 1.0) * smoothstep(0.18, 0.0, length(sp)) * tw * (0.35 + uTreble * 0.65);
    }
  }

  // ---- back row: darker, wider silhouettes for depth ----
  float cwB = aspect / 21.0;
  float ciB = floor((x + 0.37 * cwB) / cwB);
  float hB = hash11(ciB + 41.0);
  float xB = (ciB + 0.5) * cwB - 0.37 * cwB;
  float HB = 0.08 + 0.11 * hB + spec(clamp(xB / aspect, 0.0, 1.0) * 0.92) * 0.24;
  if (ly < HB) {
    col = mix(vec3(0.02, 0.02, 0.045), uPrimary * 0.22, 0.5);
    // a few dim windows
    vec2 wc = vec2(floor(x / 0.011), floor(ly / 0.016));
    vec2 wf = fract(vec2(x / 0.011, ly / 0.016));
    float lit = step(hash21(wc + ciB * 3.7), 0.14) * step(0.3, wf.x) * step(wf.x, 0.7) * step(0.35, wf.y) * step(wf.y, 0.75);
    col += mix(uAccent, vec3(1.0, 0.85, 0.6), 0.4) * lit * 0.22;
  }
  col += glowCol * exp(-abs(ly - HB) / (2.0 * px)) * 0.18;

  // ---- front row: the equalizer buildings ----
  float cw = aspect / 44.0;
  float ci = floor(x / cw);
  float h1 = hash11(ci);
  float h2 = hash11(ci + 17.3);
  float h3 = hash11(ci + 5.9);
  float bw = cw * (0.62 + 0.3 * h1);
  float bx0 = ci * cw + (cw - bw) * h2;
  float lx = x - bx0;
  float xc = bx0 + bw * 0.5;
  float s = spec(clamp(xc / aspect, 0.0, 1.0) * 0.92);
  float idle = 0.008 * sin(uTime * 0.9 + ci * 0.7);
  float H = 0.03 + 0.05 * h3 + s * 0.46 + idle;
  bool inX = lx >= 0.0 && lx <= bw;

  if (inX && ly < H) {
    // body: dark, palette tinted, lit a little more when its band is loud
    float vy = ly / max(H, 0.001);
    col = mix(vec3(0.03, 0.03, 0.06), uPrimary * 0.45, 0.2 + 0.45 * vy * (0.4 + s));
    // edge highlight on the left side
    col += uPrimary * 0.12 * smoothstep(3.0 * px, 0.0, lx);
    // window grid
    float wsx = bw / max(floor(bw / 0.011), 1.0);
    vec2 wg = vec2(lx / wsx, ly / 0.016);
    vec2 wc = floor(wg);
    vec2 wf = fract(wg);
    float inWin = step(0.28, wf.x) * step(wf.x, 0.72) * step(0.3, wf.y) * step(wf.y, 0.78)
                * step(ly, H - 0.014);
    // windows switch on/off slowly (staggered per window, time only)
    float wh = hash21(wc + vec2(ci * 7.13, floor(uTime * 0.15 + hash21(wc + ci) * 8.0)));
    float lit = step(wh, 0.14 + 0.36 * s);
    vec3 winCol = mix(uAccent, vec3(1.0, 0.88, 0.62), 0.35);
    col += winCol * inWin * lit * (0.45 + 0.4 * s + uBeat * 0.9);
  }

  // neon roof line + glow above the roof (the equalizer trace)
  if (inX) {
    float dRoof = ly - H;
    float rw = max(2.0 * px, 0.0022);
    float rim = smoothstep(rw, rw * 0.3, abs(dRoof));
    float halo = exp(-max(dRoof, 0.0) * 70.0) * step(0.0, dRoof);
    vec3 neon = mix(uAccent, vec3(1.0), 0.25 + uBeat * 0.4);
    col += neon * rim * (0.6 + uTreble * 0.3 + uBeat * 0.8);
    col += uAccent * halo * (0.12 + uBeat * 0.35);

    // antenna with a blinking light on some rooftops
    if (h2 > 0.62) {
      float ah = 0.02 + 0.03 * h1;
      float ax = abs(lx - bw * 0.5);
      float mast = smoothstep(1.5 * px, 0.0, ax) * step(H, ly) * step(ly, H + ah);
      col += vec3(0.35) * mast;
      float blink = pow(0.5 + 0.5 * sin(uTime * 2.2 + h3 * 20.0), 6.0);
      float lamp = exp(-length(vec2(ax, ly - H - ah)) / (2.5 * px));
      col += vec3(1.0, 0.25, 0.2) * lamp * (0.3 + blink * 0.9 + uBeat * 0.8);
    }
  }

  // horizon line
  col += glowCol * exp(-ly / (1.5 * px)) * (0.4 + uBass * 0.5);

  if (water) {
    // reflection: darker, cooler, fading with depth
    col *= (0.42 - ly * 0.9) * vec3(0.85, 0.9, 1.05);
    col += glowCol * 0.02;
  }

  // vignette
  vec2 q = gl_FragCoord.xy / uResolution - 0.5;
  col *= 1.0 - dot(q, q) * 0.9;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uBass', 'uTreble', 'uBeat',
  'uPrimary', 'uAccent', 'uSpectrum',
] as const;

export function createAudioEqualizerSkyline(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'audio-equalizer-skyline',
    name: 'Equalizer Skyline',
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
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uTime, frame.time);
      gl.uniform1f(u.uBass, frame.audio.bass);
      gl.uniform1f(u.uTreble, frame.audio.treble);
      gl.uniform1f(u.uBeat, frame.audio.beat);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
    },
  };
}
