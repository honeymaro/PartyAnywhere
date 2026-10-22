import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uSpin;
uniform float uLevel;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

// O(1) hash helpers (no loops, cheap).
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

mat2 rot(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

// Procedural starfield sampled once in warped (final) coordinates.
// Cell-hashed points so stars get smeared/arced by the lensing warp.
vec3 stars(vec2 dir, float twinkle) {
  vec3 acc = vec3(0.0);
  // 2 "scales" of stars, unrolled (no loop) to keep cost flat.
  for (int i = 0; i < 2; i++) {
    float sc = (i == 0) ? 12.0 : 26.0;
    vec2 g = dir * sc;
    vec2 cell = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = hash21(cell + float(i) * 37.0);
    // only some cells host a star
    float present = step(0.91, h);
    vec2 jitter = vec2(hash21(cell + 5.1), hash21(cell + 9.7)) - 0.5;
    float d = length(f - jitter * 0.6);
    float star = present * exp(-d * d * 90.0);
    float tw = 0.6 + 0.4 * sin(uTime * (3.0 + h * 6.0) + h * 30.0);
    star *= mix(1.0, tw, twinkle);
    vec3 tint = mix(vec3(0.8, 0.85, 1.0), vec3(1.0, 0.9, 0.75), hash21(cell + 2.3));
    acc += star * tint * 0.7;
  }
  return acc;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  vec3 col = vec3(0.0);

  const float EPS = 1e-4;

  // Lensing strength is CONSTANT. Letting audio warp the geometry made the entire star
  // field swim around every frame — the main source of the "busy" feel. Audio reactivity
  // now lives in brightness and the rotation RATE instead.
  float beat = clamp(uBeat, 0.0, 1.0);
  float strength = 0.11;

  // Rotation via accumulated uSpin: audio modulates the RATE in one direction (no wobble).
  float spin = uSpin;

  // --- Approximate iterative ray-bend toward the throat ---
  // March a position outward from uv; at each step pull it toward center by an
  // inverse-square-ish amount and accumulate the swing (angle) it picks up.
  vec2 p = uv;
  vec2 dir = normalize(uv + vec2(EPS));
  float r0len = length(uv);
  float angAccum = 0.0;
  float captured = 0.0; // how strongly this ray fell into the throat

  float rr = dot(p, p) + EPS;            // squared radius (+eps guard), carried across steps
  // 18 steps of 1.44x the old length (was 26): same total path and bend, ~30% cheaper
  const float K = 26.0 / 18.0;
  for (int i = 0; i < 18; i++) {
    float pull = strength / rr;          // inverse-square-ish pull
    // rotate the marching direction by the accumulated bend
    float bend = pull * 0.5 * K;
    angAccum += bend;
    dir = rot(bend) * dir;
    // step inward-biased: advance along dir but also drift toward center
    p += (dir * 0.06 - p * inversesqrt(rr) * pull * 0.04) * K;
    rr = dot(p, p) + EPS;
    // photons that swing too tight get captured by the photon sphere
    captured += exp(-rr * 40.0) * 0.04 * K;
    if (rr > 4.84) break; // escaped to background (r > 2.2)
  }
  captured = clamp(captured, 0.0, 1.0);

  // Final warped lookup direction (angle + radius) after the bend.
  float warpAng = atan(dir.y, dir.x) + angAccum * 1.5 + spin;
  vec2 warpDir = vec2(cos(warpAng), sin(warpAng));
  // radial coordinate keeps a memory of the original distance, compressed near the hole.
  float radial = log(length(p) + 1.0 + EPS);
  vec2 lensedField = warpDir * (0.5 + radial) + warpDir.yx * 0.15;

  // Lensed starfield in warped coords -> stars arc around the hole.
  float twinkle = clamp(0.2 + 0.3 * uTreble, 0.0, 1.0);
  vec3 sky = stars(lensedField, twinkle);
  // dim faint background nebula gradient from palette
  sky += mix(uPrimary, uAccent, 0.5 + 0.5 * warpDir.y) * 0.04;

  col += sky;

  // --- Einstein / photon ring ---
  float r = r0len;
  float ringBase = 0.34 - 0.018 * uBass;         // ring radius, small inward pulse on bass
  float w = 0.022 + 0.01 * beat;                 // ring width, flares on beat
  // chromatic aberration: per-channel ring radius split by treble.
  float split = 0.008 + 0.01 * uTreble;
  float rR = exp(-pow((r - (ringBase + split)) / w, 2.0));
  float rG = exp(-pow((r - ringBase) / w, 2.0));
  float rB = exp(-pow((r - (ringBase - split)) / w, 2.0));
  // split samples tinted with the palette (raw R/G/B channels ignored the palette)
  vec3 ring = rR * uAccent + rG * mix(uAccent, vec3(1.0), 0.45) + rB * uPrimary;
  float ringGain = 0.75 + 0.4 * uBass + 0.9 * beat; // ring still pulses on the beat (rhythm)
  col += ring * ringGain;

  // Secondary thin outer halo ring (Einstein ring echo) — kept faint to avoid clutter.
  float halo = exp(-pow((r - (ringBase + 0.12)) / (w * 2.2), 2.0));
  col += halo * uPrimary * (0.22 + 0.3 * uLevel);

  // Accretion swirl just outside the throat — calmer: lower angular frequency and spin.
  float swirlAng = atan(uv.y, uv.x) * 2.0 + spin * 1.5;
  float swirl = (0.5 + 0.5 * sin(swirlAng)) * exp(-pow((r - 0.27) / 0.06, 2.0));
  col += swirl * mix(uPrimary, uAccent, 0.5) * (0.3 + 0.3 * uMid);

  // --- Dark throat ---
  // inside the photon ring, light is swallowed: darken hard toward center.
  float throat = smoothstep(ringBase - 0.02, ringBase - 0.12, r);
  col *= 1.0 - throat;
  // captured photons add a faint inner glow rim (lensed light piling at the edge).
  float rim = exp(-pow((r - (ringBase - 0.06)) / 0.05, 2.0));
  col += rim * captured * uAccent * (0.6 + 1.0 * beat);

  // Gentle vignette so the hole reads against the frame.
  col *= 1.0 - 0.25 * smoothstep(0.7, 1.3, length(uv));

  col = 1.0 - exp(-col * 1.4);
  fragColor = vec4(col, 1.0);
}
`;

const NAMES = ['uResolution','uTime','uSpin','uLevel','uBass','uMid','uTreble','uBeat','uPrimary','uAccent'] as const;

export function createWormholeLensing(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let spin = 0; // accumulated rotation angle (audio modulates the RATE, never the direction)
  return {
    id: 'wormhole-lensing',
    name: 'Lensing Wormhole',
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
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uTime, frame.time);
      spin += (0.08 + frame.audio.mid * 0.4 + frame.audio.beat * 0.6) * frame.dt;
      gl.uniform1f(u.uSpin, spin);
      gl.uniform1f(u.uLevel, frame.audio.level);
      gl.uniform1f(u.uBass, frame.audio.bass);
      gl.uniform1f(u.uMid, frame.audio.mid);
      gl.uniform1f(u.uTreble, frame.audio.treble);
      gl.uniform1f(u.uBeat, frame.audio.beat);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() { gl.deleteProgram(program); },
  };
}
