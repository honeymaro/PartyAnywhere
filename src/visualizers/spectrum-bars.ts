import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Classic equalizer: 64 discrete rounded bars over the log spectrum (bass left, treble
// right), with falling peak caps, a palette gradient from floor to top, a soft glow,
// a mirrored reflection on a glowing floor line, and a brightness kick on the beat.
// Bar heights and peak caps are computed on the CPU and passed as uniform arrays.
const BARS = 64;

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uBass;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;
uniform float uBars[${BARS}];  // bar heights 0..1
uniform float uPeaks[${BARS}]; // falling peak caps 0..1

const float NB = ${BARS}.0;
const float FLOOR_Y = 0.24;
const float MAX_H = 0.66;

// signed distance to bar i (flat bottom on the floor, round cap on top); lx is the
// horizontal offset from the bar center, y the height above the floor
float barDist(int i, float lx, float y, float halfW) {
  float h = uBars[i] * MAX_H;
  float dy = y - clamp(y, 0.0, max(h - halfW, 0.0));
  return length(vec2(lx, dy)) - halfW;
}

// bar fill + glow + peak cap color at (lx, y) for bar i
vec3 shadeBar(int i, int nb, float lx, float lxN, float y, float halfW, float aa) {
  float d = barDist(i, lx, y, halfW);
  // the neighbor bar's glow can spill across the gap
  float dN = barDist(nb, lxN, y, halfW);
  float fill = smoothstep(aa, -aa, d);
  float glow = exp(-max(d, 0.0) * 60.0) + exp(-max(dN, 0.0) * 60.0);

  float h = uBars[i] * MAX_H;
  float t = clamp(y / MAX_H, 0.0, 1.0);
  vec3 c = mix(uPrimary, uAccent, smoothstep(0.0, 0.9, t));
  // shading across the bar width gives it a rounded, lit look
  c *= 0.75 + 0.35 * (1.0 - abs(lx) / halfW);
  // hot top cap, stronger on the beat
  float top = smoothstep(halfW * 4.0, 0.0, abs(y - h + halfW));
  c += mix(uAccent, vec3(1.0), 0.6) * top * (0.25 + uBeat * 0.6);
  c *= 0.75 + uBeat * 0.45;

  vec3 col = c * fill;
  col += mix(uPrimary, uAccent, t) * glow * (1.0 - fill) * (0.12 + uBeat * 0.18);

  // peak cap: a thin pill floating above the bar
  float py = uPeaks[i] * MAX_H + halfW * 1.6;
  float capD = length(vec2(max(abs(lx) - halfW + 0.002, 0.0), y - py)) - 0.0035;
  col += mix(uAccent, vec3(1.0), 0.35) * smoothstep(aa, -aa, capD) * 0.9;
  return col;
}

void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 p = gl_FragCoord.xy / uResolution.y; // y 0..1, x 0..aspect
  float aa = 1.2 / uResolution.y;

  float x0 = 0.05 * aspect;
  float cellW = (aspect - 2.0 * x0) / NB;
  float halfW = cellW * 0.36;
  float fx = (p.x - x0) / cellW;
  float fi = floor(fx);
  float lx = (fx - fi - 0.5) * cellW;
  bool inRange = fi >= 0.0 && fi < NB;
  int i = int(clamp(fi, 0.0, NB - 1.0));
  // nearest neighbor (left or right) for glow spill
  float side = lx < 0.0 ? -1.0 : 1.0;
  int nb = int(clamp(fi + side, 0.0, NB - 1.0));
  float lxN = lx - side * cellW;

  // backdrop: dark, faint palette haze rising from the floor
  vec3 col = vec3(0.012, 0.012, 0.024);
  float haze = exp(-abs(p.y - FLOOR_Y) * 5.0);
  col += mix(uPrimary, uAccent, 0.4) * haze * (0.05 + uBass * 0.1);

  float y = p.y - FLOOR_Y;
  if (inRange) {
    if (y >= 0.0) {
      col += shadeBar(i, nb, lx, lxN, y, halfW, aa);
    } else {
      // reflection: mirrored bars, fading out below the floor, slightly dimmed
      float fade = exp(y * 7.0) * 0.4;
      col += shadeBar(i, nb, lx, lxN, -y, halfW, aa) * fade;
    }
  }

  // glowing floor line
  float line = exp(-abs(y) * uResolution.y * 0.35);
  col += mix(uPrimary, uAccent, 0.5) * line * (0.35 + uBass * 0.5 + uBeat * 0.3);

  // soft vignette
  vec2 q = gl_FragCoord.xy / uResolution - 0.5;
  col *= 1.0 - dot(q, q) * 0.6;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = ['uResolution', 'uBass', 'uBeat', 'uPrimary', 'uAccent', 'uBars', 'uPeaks'] as const;

export function createSpectrumBars(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  const bars = new Float32Array(BARS);
  const peaks = new Float32Array(BARS);
  const peakHold = new Float32Array(BARS); // seconds a peak cap waits before falling
  const peakVel = new Float32Array(BARS); // peak cap fall speed (accelerates like gravity)

  return {
    id: 'spectrum-bars',
    name: 'Spectrum Bars',
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
      const spec = frame.audio.spectrum;
      const n = spec.length;
      const dt = Math.min(frame.dt, 0.1);
      for (let i = 0; i < BARS; i++) {
        // bars cover the log spectrum up to ~12 kHz (the top bins are mostly empty)
        let v = 0;
        if (n > 0) {
          const pos = ((i + 0.5) / BARS) * n * 0.93;
          const k = Math.min(n - 2, Math.floor(pos));
          const f = pos - k;
          v = (spec[k] * (1 - f) + spec[k + 1] * f) / 255;
        }
        // idle ripple so silence still shows a calm, living floor of short bars
        const idle = 0.02 + 0.015 * (0.5 + 0.5 * Math.sin(frame.time * 1.3 - i * 0.32));
        const h = Math.max(v, idle);
        bars[i] = h;
        if (h >= peaks[i]) {
          peaks[i] = h;
          peakHold[i] = 0.35;
          peakVel[i] = 0;
        } else if (peakHold[i] > 0) {
          peakHold[i] -= dt;
        } else {
          peakVel[i] += 1.6 * dt;
          peaks[i] = Math.max(h, peaks[i] - peakVel[i] * dt);
        }
      }
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uBass, frame.audio.bass);
      gl.uniform1f(u.uBeat, frame.audio.beat);
      gl.uniform1fv(u.uBars, bars);
      gl.uniform1fv(u.uPeaks, peaks);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
    },
  };
}
