import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Aurora curtains over a starry night: three luminous ribbons, each a wavy hem line
// with fine vertical rays rising from it and fading upward. Folds of the ribbon (where
// the curtain turns toward the viewer) brighten and bunch up the rays. Everything is
// built from cheap 1D value noise along x, so a curtain costs a handful of hashes.
// Audio: level/bass raise and brighten the curtains, every kick sends a bright ripple
// running sideways along the hems, mids speed up the drift (CPU-accumulated, one-way).
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uFlow;     // accumulated curtain drift (audio = rate, one-way)
uniform float uKickAge;  // seconds since the last kick (large when none yet)
uniform float uKickX;    // where the last kick ripple started (0..aspect)
uniform float uLevel;
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// 1D value noise: one curtain only varies along x, so this is all we need
float noise1(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash11(i), hash11(i + 1.0), f);
}

void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 uv = gl_FragCoord.xy / uResolution.y; // x: 0..aspect, y: 0..1

  // --- night sky: deep blue gradient, faint palette haze near the horizon ---
  vec3 col = mix(vec3(0.010, 0.016, 0.045), vec3(0.002, 0.003, 0.012), uv.y);
  col += mix(uPrimary, uAccent, 0.25) * 0.05 * exp(-uv.y * 4.0);

  // --- stars: one jittered point per cell, gently twinkling (treble adds sparkle) ---
  vec2 sp = uv * 80.0;
  vec2 sc = floor(sp);
  float sh = hash21(sc);
  if (sh > 0.82) {
    vec2 so = vec2(hash21(sc + 7.1), hash21(sc + 3.3)) * 0.7 + 0.15;
    float sd = length(fract(sp) - so);
    float tw = 0.65 + 0.35 * sin(uTime * (1.5 + sh * 3.0) + sh * 60.0);
    float sb = (sh - 0.82) * 5.5 * tw * (0.8 + uTreble * 0.5);
    col += vec3(0.85, 0.9, 1.0) * smoothstep(0.09, 0.0, sd) * sb;
  }

  // kick ripple: a bright pulse running outward along the hems from uKickX
  float rDist = abs(uv.x - uKickX) - uKickAge * 1.3;
  float ripple = exp(-rDist * rDist * 30.0) * exp(-uKickAge * 2.4);

  // curtain height and brightness ride the music (size / glow, never position)
  float lift = 0.75 + uLevel * 0.3 + uBass * 0.45;
  float gain = 0.65 + uLevel * 0.5 + uBass * 0.4 + uBeat * 1.1 + ripple * 1.6;

  // --- three curtains: back (high, dim, fine, short) to front (low, bright, broad, tall) ---
  vec3 aur = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float sx = 2.3 - fi * 0.45;                       // horizontal scale (back is finer)
    float x = uv.x * sx + fi * 5.3;
    float t = uFlow * (0.55 + fi * 0.2) + fi * 13.0;

    // hem: the lower edge of the ribbon, a slow wandering wave
    float hem = 0.56 - fi * 0.12
              + (noise1(x * 0.8 + t * 0.3) - 0.5) * 0.2
              + sin(x * 1.7 + t * 0.45) * 0.03
              + ripple * 0.02;

    // the ribbon fades in and out along its length, leaving open sky between segments
    float seg = smoothstep(0.15, 0.65, noise1(x * 0.45 - t * 0.12 + fi * 7.0));

    // folds: a phase-warped wave; where it turns edge-on the curtain looks brighter
    float ph = x * 1.3 + t * 0.5 + noise1(x * 0.6 - t * 0.2) * 3.0;
    float fold = 0.5 + 0.8 * pow(abs(cos(ph)), 3.0);

    // fine vertical rays (x-only noise -> vertical streaks), drifting with the folds
    float ray = noise1(x * 34.0 + ph * 1.5);
    ray = 0.3 + 0.7 * ray * ray;

    float dy = uv.y - hem;
    // ray-dependent height gives the ragged top; fades upward, sharp-ish glowing hem
    float h = (0.065 + fi * 0.022) * lift * (0.45 + 1.1 * ray);
    float body = smoothstep(-0.02, 0.01, dy) * exp(-max(dy, 0.0) / h);
    float hemLine = exp(-abs(dy) * 50.0) * 0.6;
    float a = (body + hemLine) * ray * fold * seg;

    // color: palette primary at the hem, drifting into the accent toward the top
    vec3 c = mix(uPrimary, uAccent, smoothstep(0.0, h * 1.8, dy));
    c = mix(c, vec3(1.0), hemLine * 0.3);
    aur += c * a * (0.6 + fi * 0.35);
  }
  col += aur * gain;

  // soft sky glow that the curtains cast (cheap: no extra noise)
  col += mix(uPrimary, uAccent, 0.4) * 0.06 * gain * smoothstep(0.1, 0.45, uv.y) * smoothstep(1.0, 0.45, uv.y);

  // --- dark hills / treeline silhouette along the bottom ---
  float ground = 0.085 + (noise1(uv.x * 3.0 + 4.0) - 0.5) * 0.06 + (noise1(uv.x * 26.0) - 0.5) * 0.014;
  float land = smoothstep(ground + 0.002, ground - 0.002, uv.y);
  vec3 landCol = vec3(0.004, 0.006, 0.012) + mix(uPrimary, uAccent, 0.3) * 0.02 * gain;
  col = mix(col, landCol, land);

  // gentle filmic shoulder so the bright folds don't clip flat
  col = 1.0 - exp(-col * 1.25);
  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uFlow', 'uKickAge', 'uKickX', 'uLevel', 'uBass', 'uTreble', 'uBeat',
  'uPrimary', 'uAccent',
] as const;

export function createAuroraCurtains(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let flow = 0; // curtain drift phase (audio modulates the rate; only ever increases)
  let prevBeat = 0;
  let kickAge = 99; // seconds since the last kick (rising edge of the beat pulse)
  let kickCount = 0;

  return {
    id: 'aurora-curtains',
    name: 'Aurora Curtains',
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
      const a = frame.audio;
      flow += (0.08 + a.mid * 0.12 + a.level * 0.1 + a.beat * 0.35) * frame.dt;
      kickAge += frame.dt;
      if (a.beat > 0.85 && prevBeat <= 0.85 && kickAge > 0.1) {
        kickAge = 0;
        kickCount++;
      }
      prevBeat = a.beat;
      const aspect = frame.resolution[0] / frame.resolution[1];
      // golden-ratio walk: each kick starts its ripple somewhere new, deterministically
      const kickX = aspect * (0.2 + 0.6 * ((kickCount * 0.618034) % 1));
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uTime, frame.time);
      gl.uniform1f(u.uFlow, flow);
      gl.uniform1f(u.uKickAge, kickAge);
      gl.uniform1f(u.uKickX, kickX);
      gl.uniform1f(u.uLevel, a.level);
      gl.uniform1f(u.uBass, a.bass);
      gl.uniform1f(u.uTreble, a.treble);
      gl.uniform1f(u.uBeat, a.beat);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
    },
  };
}
