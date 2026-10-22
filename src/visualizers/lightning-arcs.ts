import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uSeed; // strike counter (CPU, incremented on each kick rising edge)
uniform float uSince; // seconds since the current strike
uniform float uStrength; // strike strength 0..1 (kick = 1, idle flicker strikes are faint)
// per-strike random layout, rolled on the CPU when the strike fires (uniform per frame, so
// hashing it per pixel was wasted work)
uniform vec4 uBolt; // x0 (0..1), lean, second-bolt flag, second-bolt x offset
uniform vec4 uFork; // fork heights of the 3 branches, second-bolt end height
uniform vec3 uBranchLen; // branch lengths
uniform vec3 uBranchDir; // signed sideways spread per unit fall
uniform float uLevel;
uniform float uBass;
uniform float uTreble;
uniform vec3 uPrimary;
uniform vec3 uAccent;

// integer hash -> [0,1)
uint ihash(uint x) {
  x ^= x >> 16; x *= 0x7feb352du;
  x ^= x >> 15; x *= 0x846ca68bu;
  x ^= x >> 16;
  return x;
}
float hs(int i, uint sh) {
  return float(ihash(uint(i) * 0x9E3779B9u + sh)) * (1.0 / 4294967296.0);
}

// 1D noise in [-0.5, 0.5] plus its slope. Low octaves use smooth interpolation (continuous
// slope for the big shape), high octaves are piecewise linear: straight segments with sharp
// kinks read as lightning (smooth noise alone looks like a wavy rope).
vec2 jag(float x, int s, bool smoothed) {
  float i = floor(x);
  float f = x - i;
  int ii = int(i);
  uint sh = ihash(uint(s)); // seed hash shared by both knots
  float a = hs(ii, sh);
  float b = hs(ii + 1, sh);
  float w = smoothed ? f * f * (3.0 - 2.0 * f) : f;
  float dw = smoothed ? 6.0 * f * (1.0 - f) : 1.0;
  return vec2(mix(a, b, w) - 0.5, (b - a) * dw);
}

// Bolt offset x(y) and a slope dx/dy for the distance correction. The kinked high octaves
// only count partly in the slope: their jumps would otherwise smear the glow sideways.
vec2 boltPath(float y, int s, int octaves, float freq) {
  vec2 acc = vec2(0.0);
  float amp = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    bool low = i < 2;
    vec2 n = jag(y * freq, s * 8 + i, low);
    acc += vec2(n.x * amp, n.y * amp * freq * (low ? 1.0 : 0.3));
    amp *= 0.5;
    freq *= 2.2;
  }
  return acc;
}

// Glow of a bolt at horizontal offset dx with the given slope (slope-corrected distance).
float boltGlow(float dx, float slope, float width) {
  float d = abs(dx) * inversesqrt(1.0 + slope * slope);
  float core = exp(-d * d / (width * width));
  float halo = width * 2.5 / (d + width * 2.5);
  return core * 1.6 + halo * halo * 0.6 + exp(-d * 6.0) * 0.22;
}

// cheap 2D value noise for the cloud layer
float hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x),
             mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  vec2 uv = (gl_FragCoord.xy / uResolution) * 2.0 - 1.0;
  float aspect = uResolution.x / uResolution.y;
  uv.x *= aspect;

  int seed = int(uSeed);
  float since = uSince;
  float strength = uStrength;

  // Strike envelope: sharp flash that decays, with one re-strike flicker like real lightning.
  float env = exp(-since * 5.5) + 0.45 * exp(-max(since - 0.09, 0.0) * 9.0) * step(0.09, since);
  env *= strength;
  // leader: the bolt races down from the top within ~2 frames
  float front = 1.15 - (since + 0.03) * 50.0;
  float reveal = smoothstep(front - 0.25, front + 0.02, uv.y);

  // main bolt: random start x per strike, slight lean
  float x0 = (uBolt.x - 0.5) * aspect * 1.2;
  float lean = uBolt.y;
  float yy = 1.0 - uv.y; // 0 at the top, 2 at the bottom
  float glow = 0.0;
  // skip all bolt work once the strike has faded out (long silences cost almost nothing)
  if (env * reveal > 0.002) {
    vec2 mp = boltPath(uv.y, seed, 5, 1.4);
    float mainX = x0 + lean * yy + mp.x * 0.55;
    float mainSlope = -lean + mp.y * 0.55;
    float bw = 0.0065 * (0.7 + 0.3 * strength) * (1.0 + uBass * 0.5);
    glow = boltGlow(uv.x - mainX, mainSlope, bw);

    // branches: fork off the main channel and drift sideways as they fall
    for (int b = 0; b < 3; b++) {
      float t = uFork[b] - uv.y; // distance below the fork
      if (t < 0.0 || t > uBranchLen[b]) continue;
      float lin = mainX + uBranchDir[b] * t;
      if (abs(uv.x - lin) > 0.5) continue; // too far for any visible glow
      vec2 bp = boltPath(uv.y, seed + 101 * (b + 1), 3, 3.0);
      // the branch's own wiggle ramps in from zero, so it leaves the main channel exactly
      float ramp = min(t * 8.0, 1.0);
      float bx = lin + bp.x * 0.35 * ramp;
      float bslope = mainSlope - uBranchDir[b] + bp.y * 0.35 * ramp;
      float len = uBranchLen[b];
      // fade in just below the fork too: a hard start would cut the wide halo along a row
      float fade = (1.0 - t / len) * smoothstep(0.0, 0.08, t);
      glow += boltGlow(uv.x - bx, bslope, bw * (0.45 + 0.35 * fade)) * fade * 0.7;
    }

    // a second, thinner bolt on strong strikes
    if (uBolt.z > 0.5 && strength > 0.75) {
      float x1 = x0 + uBolt.w * aspect * 0.5;
      vec2 sp = boltPath(uv.y, seed + 977, 4, 1.8);
      float sx = x1 - lean * 0.6 * yy + sp.x * 0.5;
      float sEnd = uFork.w; // ends in mid air
      float sMask = smoothstep(sEnd - 0.05, sEnd + 0.2, uv.y);
      glow += boltGlow(uv.x - sx, lean * 0.6 + sp.y * 0.5, bw * 0.7) * 0.6 * sMask;
    }
    glow *= reveal * env;
  }

  // cloud ceiling: slow drifting value noise, lit from inside by the flash
  vec2 cp = uv * vec2(1.3, 2.2) + vec2(uTime * 0.03, uTime * 0.01);
  float cloud = vnoise(cp) * 0.6 + vnoise(cp * 2.3 + 5.1) * 0.3 + vnoise(cp * 5.1 + 2.7) * 0.1;
  float sky = smoothstep(-0.6, 1.0, uv.y);
  float skyEnv = strength * exp(-since * 7.0);
  // light spreads from where the bolt starts
  float near = exp(-abs(uv.x - x0) * 1.2);
  vec3 col = uPrimary * cloud * sky * (0.13 + 0.04 * uLevel + 1.2 * skyEnv * (0.4 + 0.6 * near));
  // faint idle shimmer: treble sparkles in the clouds (amplitude only)
  col += uAccent * cloud * cloud * sky * uTreble * 0.025 * (0.6 + 0.4 * sin(uTime * 3.0 + cloud * 20.0));
  // whole-sky flash on the strike
  col += mix(uPrimary, uAccent, 0.4) * skyEnv * 0.2;

  // bolt: white-hot core, accent-colored glow
  vec3 boltCol = mix(uAccent, mix(uPrimary, uAccent, 0.5), 0.3);
  float coreHot = clamp(glow - 0.5, 0.0, 1.0);
  col += boltCol * glow * 0.9 + vec3(1.0) * coreHot * 0.8;

  // soft tone map so overlapping glows do not clip
  col = 1.0 - exp(-col * 1.2);
  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uSeed', 'uSince', 'uStrength', 'uBolt', 'uFork', 'uBranchLen', 'uBranchDir',
  'uLevel', 'uBass', 'uTreble', 'uPrimary', 'uAccent',
] as const;

export function createLightningArcs(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  // Strike state lives on the CPU: a new strike (new seed) only fires on a beat rising edge,
  // so the bolts follow the kicks instead of a fixed clock.
  let seed = 1;
  let since = 10;
  let strength = 0;
  let prevBeat = 0;
  let idleWait = 2.5; // seconds until the next faint idle strike when nothing is playing
  const bolt = new Float32Array(4);
  const fork = new Float32Array(4);
  const branchLen = new Float32Array(3);
  const branchDir = new Float32Array(3);
  // roll the random layout of a new strike (the jagged path itself comes from the seed)
  function newStrike(str: number) {
    seed = (seed + 1) % 4096;
    since = 0;
    strength = str;
    bolt[0] = Math.random();
    bolt[1] = (Math.random() - 0.5) * 0.5;
    bolt[2] = Math.random() < 0.55 ? 1 : 0; // only drawn on strong strikes
    bolt[3] = (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * 0.5);
    for (let b = 0; b < 3; b++) {
      fork[b] = 0.75 - b * 0.45 - Math.random() * 0.35;
      branchLen[b] = 0.35 + Math.random() * 0.55;
      branchDir[b] = (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * 0.6);
    }
    fork[3] = -0.2 - Math.random() * 0.8;
  }

  return {
    id: 'lightning-arcs',
    name: 'Branching Lightning',
    init(context: VisualizerContext) {
      ctx = context;
      gl = context.gl;
      program = context.compileFragment(FRAG);
      for (const name of NAMES) u[name] = gl.getUniformLocation(program, name);
    },
    resize() {},
    render(frame: RenderFrame) {
      const a = frame.audio;
      since += frame.dt;
      // rising edge of the onset pulse: kicks (beat ~1.0) strike full strength, softer
      // onsets (0.5-0.9) strike clearly weaker (squared); a short refractory time avoids
      // double triggers.
      if (a.beat > 0.5 && prevBeat <= 0.5 && since > 0.12) {
        newStrike(a.beat * a.beat);
      } else if (since < 0.05) {
        strength = Math.max(strength, a.beat * a.beat); // pulse may still be rising next frame
      } else if (since > idleWait) {
        // calm idle flicker: rare faint strikes keep silence alive
        newStrike(0.22);
        idleWait = 2.5 + Math.random() * 3;
      }
      prevBeat = a.beat;

      gl.useProgram(program);
      ctx.quad.bind(program);
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uTime, frame.time);
      gl.uniform1f(u.uSeed, seed);
      gl.uniform1f(u.uSince, since);
      gl.uniform1f(u.uStrength, strength);
      gl.uniform4fv(u.uBolt, bolt);
      gl.uniform4fv(u.uFork, fork);
      gl.uniform3fv(u.uBranchLen, branchLen);
      gl.uniform3fv(u.uBranchDir, branchDir);
      gl.uniform1f(u.uLevel, a.level);
      gl.uniform1f(u.uBass, a.bass);
      gl.uniform1f(u.uTreble, a.treble);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
    },
  };
}
