import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Synthwave horizon: a round, striped sun with a soft glow sinking behind a mountain
// silhouette, and a dense glowing perspective grid racing toward the viewer. The grid
// travel is CPU-accumulated (audio = speed, one-way), so kicks surge it forward instead
// of jerking it back and forth. Lines are antialiased with fwidth and fade into a horizon
// haze where they get denser than a couple of pixels (no moire). Each kick flashes the
// grid and sends a bright pulse running across the floor toward the horizon.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uScroll;   // accumulated travel along the floor (audio = speed, one-way)
uniform float uKickAge;  // seconds since the last kick (large when none yet)
uniform float uLevel;
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

const float HORIZON = -0.07;

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

float noise1(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash11(i), hash11(i + 1.0), f);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y; // aspect-correct
  float px = 1.0 / uResolution.y;
  vec3 hazeCol = mix(uAccent, uPrimary, 0.35);
  float pulse = 0.75 + uLevel * 0.35 + uBass * 0.3 + uBeat * 1.1;
  vec3 col;

  // derivatives are taken here, outside the sky/floor branch (undefined in divergent flow)
  vec2 sunC = vec2(0.0, HORIZON + 0.17);
  float R = 0.23 * (1.0 + uBeat * 0.04);
  float sv = (uv.y - sunC.y) / R;                 // -1 bottom .. +1 top of the sun
  float sl = sv * 6.5 + uTime * 0.25;             // sun stripe coordinate (drifts down)
  float aa = fwidth(sl);
  float fy = max(HORIZON - uv.y, 1e-4);           // 0 at horizon .. ~0.43 at bottom
  float z = 0.32 / fy;                            // floor depth
  vec2 g = vec2(uv.x * z, z + uScroll) * 7.0;     // grid space (dense: ~12 columns at the bottom)
  vec2 fw = fwidth(g);

  if (uv.y >= HORIZON) {
    float sy = uv.y - HORIZON;
    // --- sky: warm palette glow at the horizon into deep violet night ---
    col = mix(hazeCol * 0.45, vec3(0.025, 0.012, 0.06), smoothstep(0.0, 0.32, sy));
    col = mix(col, vec3(0.008, 0.005, 0.02), smoothstep(0.3, 0.6, sy));

    // sparse stars high up
    vec2 sp = uv * 70.0;
    vec2 sc = floor(sp);
    float sh = hash21(sc);
    if (sh > 0.86) {
      vec2 so = vec2(hash21(sc + 5.1), hash21(sc + 1.3)) * 0.7 + 0.15;
      float tw = 0.6 + 0.4 * sin(uTime * (1.0 + sh * 2.0) + sh * 50.0);
      col += vec3(0.9) * smoothstep(0.1, 0.0, length(fract(sp) - so)) * tw
           * smoothstep(0.12, 0.35, sy) * (0.5 + uTreble * 0.4);
    }

    // --- round striped sun (aspect-correct: uv is in height units) ---
    float d = length(uv - sunC);
    float disc = smoothstep(R + px, R - px, d);
    // horizontal cuts in the lower half, thicker toward the bottom, drifting down
    float gapW = clamp(0.08 - sv * 0.38, 0.0, 0.6) * step(sv, 0.25);
    float cut = smoothstep(gapW - aa, gapW + aa, fract(sl));
    vec3 sunCol = mix(mix(uAccent, uPrimary, 0.25), mix(uAccent, vec3(1.0, 0.95, 0.85), 0.6),
                      smoothstep(-0.9, 0.9, sv));
    col = mix(col, sunCol * (1.0 + uBeat * 0.35), disc * cut);
    // glow halo (bass/beat swell it)
    float halo = exp(-max(d - R, 0.0) * 7.0) * (1.0 - disc * cut);
    col += uAccent * halo * (0.25 + uBass * 0.25 + uBeat * 0.55);

    // --- mountain silhouette in front of the sun, lower in the middle ---
    float mx = uv.x;
    float mh = (noise1(mx * 4.0 + 3.0) * 0.65 + noise1(mx * 11.0) * 0.25 + noise1(mx * 31.0) * 0.1)
             * 0.13 * smoothstep(0.05, 0.55, abs(mx));
    float mtn = smoothstep(mh + px, mh - px, sy);
    vec3 mtnCol = mix(vec3(0.02, 0.008, 0.04), uPrimary * 0.12, smoothstep(mh, 0.0, sy));
    float rim = exp(-abs(sy - mh) / (px * 2.5)) * step(0.004, mh);
    col = mix(col, mtnCol, mtn);
    col += mix(uPrimary, uAccent, 0.3) * rim * 0.8 * pulse;
  } else {
    // --- floor: perspective grid ---
    vec2 gd = abs(fract(g - 0.5) - 0.5);          // distance to the nearest line, grid units
    vec2 core = 1.0 - smoothstep(0.03 - fw * 0.5, 0.03 + fw, gd);
    vec2 glow = exp(-gd / (0.09 + fw));
    float detail = 1.0 - smoothstep(0.12, 0.45, max(fw.x, fw.y)); // lines too dense -> haze
    float lineV = max(core.x, core.y) + 0.35 * max(glow.x, glow.y);
    float lineA = mix(0.22, lineV, detail);       // far away: average coverage

    // kick pulse: a bright band running from the viewer toward the horizon
    float zw = 0.7 + uKickAge * 9.0;
    float wave = exp(-abs(z - zw) * 2.2) * exp(-uKickAge * 1.8);

    vec3 lineCol = mix(uAccent, uPrimary, 0.35 + 0.3 * smoothstep(0.0, 0.4, fy));
    col = vec3(0.022, 0.008, 0.045) + hazeCol * 0.03;
    col += lineCol * lineA * (pulse + wave * 2.0) * 1.1;
    // sun reflection streak on the floor
    col += uAccent * exp(-abs(uv.x) * 7.0) * exp(-fy * 9.0) * (0.2 + uBeat * 0.3);
    // distance fog into the horizon haze
    float fog = exp(-z * 0.09);
    col = mix(hazeCol * (0.4 + uBeat * 0.2), col, fog);
  }

  // horizon glow line
  float hd = abs(uv.y - HORIZON);
  col += hazeCol * (exp(-hd * 140.0) * 0.9 + exp(-hd * 18.0) * 0.18) * pulse;

  // faint scanlines
  col *= 0.93 + 0.07 * sin(gl_FragCoord.y * 3.14159);

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uScroll', 'uKickAge', 'uLevel', 'uBass', 'uTreble', 'uBeat',
  'uPrimary', 'uAccent',
] as const;

export function createRetroGridHorizon(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let scroll = 0; // distance travelled over the grid (audio modulates the speed; one-way)
  let prevBeat = 0;
  let kickAge = 99; // seconds since the last kick (rising edge of the beat pulse)

  return {
    id: 'retro-grid-horizon',
    name: 'Retro Synthwave Grid',
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
      scroll += (0.22 + a.level * 0.35 + a.bass * 0.25 + a.beat * 1.6) * frame.dt;
      kickAge += frame.dt;
      if (a.beat > 0.85 && prevBeat <= 0.85 && kickAge > 0.1) kickAge = 0;
      prevBeat = a.beat;
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uTime, frame.time);
      gl.uniform1f(u.uScroll, scroll);
      gl.uniform1f(u.uKickAge, kickAge);
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
