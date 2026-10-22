import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Pointillism, but alive: a galaxy of paint dabs orbiting the center with differential
// rotation (inner rings spin faster; accumulated uSwirl, one-way, audio sets the rate),
// where each ring's dabs pulse with the LIVE SPECTRUM at its radius (inner dabs thump
// with bass, outer dabs shimmer with treble: a pointillist radial equalizer).
// Seurat touches: palette mix along radius, complementary sprinkles, per-dab brightness
// jitter. Dabs are large and overlapping (painterly, not pore-like); positions are pure
// cell hashes inside each rotating ring so nothing flickers or swims; rings just spin.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uSwirl;  // accumulated rotation phase (audio modulates the rate, one-way)
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;
uniform sampler2D uSpectrum;

const float TWO_PI = 6.28318530718;
const float RINGS = 11.0;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
  float h = hash21(p);
  return vec2(h, hash21(p + h + 17.17));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float aa = 1.5 / min(uResolution.x, uResolution.y); // ~1.5px edge in world units

  float pixelRing = floor(r * RINGS);

  // Search this ring and its radial neighbors; within each ring, the pixel's angular
  // cell and its two angular neighbors. Dot identity = (wrapped angular cell, ring),
  // so the 0/360 seam shares one dot and rings rotate as coherent units.
  // Only the winning dab is shaded (after the loop) to keep the search cheap.
  float best = 0.0;
  vec2 bestId = vec2(0.0);
  float bestRc = 0.0;
  float bestSpec = 0.0;
  float beatSize = 1.0 + uBeat * 0.3;
  for (int j = -1; j <= 1; j++) {
    float ring = pixelRing + float(j);
    if (ring < 0.0) continue;
    float ringR = (ring + 0.5) / RINGS;
    // differential rotation: inner rings spin faster (one-way; rate set on the CPU)
    float rot = uSwirl * 1.3 / (ringR + 0.3);
    float NA = floor(8.0 + ringR * 36.0); // cells ~proportional to circumference
    float aN = ((a - rot) / TWO_PI + 0.5) * NA;
    float baseA = floor(aN);
    // the ring's dabs breathe with the spectrum band at its radius
    float spec = texture(uSpectrum, vec2(clamp(ringR, 0.0, 1.0) * 0.9, 0.5)).r;
    float sizeK = (0.5 + spec * 0.7) * beatSize / RINGS;
    for (int i = -1; i <= 1; i++) {
      float idxA = baseA + float(i);
      vec2 cellId = vec2(mod(idxA, NA), ring); // wrapped id: seamless across 0/360
      vec2 h2 = hash22(cellId * 1.37 + 7.7);
      float ac = ((idxA + 0.5 + (h2.x - 0.5) * 0.8) / NA - 0.5) * TWO_PI + rot;
      float rc = (ring + 0.5 + (h2.y - 0.5) * 0.7) / RINGS;
      float dabR = (0.42 + 0.3 * hash21(cellId + 3.1)) * sizeK;
      float d = length(uv - rc * vec2(cos(ac), sin(ac)));
      float cov = 1.0 - smoothstep(dabR - aa, dabR + aa, d);
      if (cov > best) {
        best = cov;
        bestId = cellId;
        bestRc = rc;
        bestSpec = spec;
      }
    }
  }

  // Seurat color: palette along radius + per-dab variation
  float mixT = clamp(bestRc * 1.15 + (hash21(bestId + 9.4) - 0.5) * 0.35, 0.0, 1.0);
  vec3 c = mix(uPrimary, uAccent, mixT);
  float hSpr = hash21(bestId * 2.13 + 5.5);
  if (hSpr < 0.15) c = mix(c, uAccent, 0.8); // complementary sprinkle
  c *= 0.7 + 0.45 * hash21(bestId + 11.7);   // hand-dabbed brightness jitter
  c *= 0.45 + bestSpec * 0.6;                // its frequency band lights it up
  // beat flash on a random subset of dabs
  c = mix(c, vec3(1.0), step(0.8, hash21(bestId + 31.7)) * uBeat * 0.6);
  // treble sparkle on outer dabs
  c = mix(c, vec3(1.0), step(0.93, hSpr) * uTreble * smoothstep(0.4, 0.8, bestRc) * 0.6);

  // dark backdrop with a faint palette wash so gaps read as canvas, not voids
  vec3 col = mix(vec3(0.02, 0.02, 0.03), mix(uPrimary, uAccent, 0.5), 0.05);
  col = mix(col, c, best);

  // glowing core that thumps with the bass
  float core = pow(smoothstep(0.3, 0.0, r), 2.0);
  col += mix(uAccent, uPrimary, 0.4) * core * (0.2 + uBass * 0.45 + uBeat * 0.45);

  // gentle exposure lift on the beat
  col *= 0.92 + uBeat * 0.25;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = ['uResolution', 'uSwirl', 'uBass', 'uTreble', 'uBeat', 'uPrimary', 'uAccent', 'uSpectrum'] as const;

export function createPointillistSwirl(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let swirl = 0; // rotation phase (audio modulates the rate; only ever increases)
  return {
    id: 'pointillist-swirl',
    name: 'Pointillist Swirl',
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
      swirl += (0.05 + frame.audio.level * 0.12 + frame.audio.beat * 0.25) * frame.dt;
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uSwirl, swirl);
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
