import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uTravel; // CPU-accumulated flight distance in depth units (wrapped, only increases)
uniform float uStreak; // streak length in depth units, follows the current flight speed
uniform float uSpin; // CPU-accumulated slow roll, in turns
uniform float uLevel;
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

const float TAU = 6.2831853;
const float R0 = 0.2; // screen radius of a star at depth 1 (perspective: r = R0 / z)
const float ZMAX = 9.0; // stars fade in at this depth
const int LAYERS = 4;

// integer hash (stable for large cell indices, unlike sin-based hashes)
uint ihash(uint x) {
  x ^= x >> 16; x *= 0x7feb352du;
  x ^= x >> 15; x *= 0x846ca68bu;
  x ^= x >> 16;
  return x;
}
vec4 hash4(int sector, int cell, int layer) {
  uint h = ihash(uint(sector) * 0x9E3779B9u + uint(cell) * 0x85EBCA6Bu + uint(layer) * 0xC2B2AE35u);
  uint h2 = (h ^ (h >> 15)) * 0x2C1B3C6Du; // cheap remix for 32 more bits
  h2 ^= h2 >> 12;
  return vec4(float(h & 0xffffu), float(h >> 16), float(h2 & 0xffffu), float(h2 >> 16)) / 65535.0;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  float r = max(length(uv), 1e-3);
  float a01 = atan(uv.y, uv.x) / TAU + 0.5 + uSpin;
  float px = 1.0 / min(uResolution.x, uResolution.y);

  // Polar star grid: each layer splits the circle into N sectors and the depth axis into
  // unit cells; every (sector, cell) may hold one star. The star at depth z sits at screen
  // radius R0/z, so as uTravel grows the stars stream outward and accelerate (hyperspace).
  // A pixel at radius r looks at depth zp = R0/r; its streak can only come from the depth
  // cell under it or the one before it (uStreak < 1), so 2 lookups per layer suffice.
  float zp = R0 / r;
  float W = zp + uTravel;
  float k = floor(W);
  vec3 col = vec3(0.0);

  for (int l = 0; l < LAYERS; l++) {
    float fl = float(l);
    float N = 34.0 + fl * 13.0; // differing sector counts break up the angular pattern
    float sa = a01 * N + fl * 0.618;
    int s = int(mod(floor(sa), N));
    float f = fract(sa);
    float cellW = r * TAU / N; // sector width in screen units at this radius
    for (int j = 0; j < 2; j++) {
      float kk = k - float(j);
      vec4 h = hash4(s, int(kk) & 4095, l); // travel wraps at 4096 on the CPU -> seamless
      if (h.x > 0.6) continue; // empty cell
      float z = kk + h.y - uTravel; // star depth in front of the camera
      if (z < 0.02 || z > ZMAX) continue;
      // star width grows as it approaches; clamp to its sector so it never gets cut off
      float w = min((0.0012 + 0.0017 / z) * (1.0 + uBass * 0.5), cellW * 0.22) + px * 0.6;
      float off = (f - (0.22 + 0.56 * h.z)) * cellW;
      if (abs(off) > 3.0 * w) continue; // early out: most pixels miss the streak sideways
      float rHead = R0 / z;
      if (r > rHead + 3.0 * w) continue; // in front of the head
      float rTail = R0 / (z + uStreak);
      if (r < rTail) continue; // behind the tail
      // 0 at the head, 1 at the end of the tail (tail points back toward the center)
      float along = (rHead - r) / max(rHead - rTail, 1e-4);
      float across = exp(-off * off / (w * w));
      float trail;
      if (along < 0.0) {
        float dh = (r - rHead) / w;
        trail = exp(-dh * dh); // round cap in front of the head
      } else {
        float tl = max(1.0 - along, 0.0);
        trail = tl * tl + 0.8 * exp(-along * 10.0);
      }
      // brighter as it approaches, fade in from far away
      float bright = min(0.32 / z, 3.0) * smoothstep(ZMAX, ZMAX * 0.45, z);
      // treble twinkle (time-only phase; treble only scales the amplitude)
      bright *= 1.0 + uTreble * 0.45 * sin(uTime * (5.0 + h.w * 9.0) + h.z * 40.0);
      vec3 starCol = mix(uPrimary, uAccent, h.w);
      // near, bright heads burn toward white; tails keep the palette hue
      float hot = clamp(bright * 0.6, 0.0, 1.0) * exp(-max(along, 0.0) * 3.0);
      starCol = mix(starCol, vec3(1.0), hot * 0.4);
      col += starCol * across * trail * bright;
    }
  }

  // vanishing-point glow: the light at the end of the tunnel, flares on every kick
  vec3 coreCol = mix(uPrimary, uAccent, 0.35);
  col += coreCol * exp(-r * r * 18.0) * (0.08 + uLevel * 0.08 + uBeat * 0.55 + uBass * 0.12);
  col += mix(uPrimary, vec3(1.0), 0.5) * exp(-r * r * 160.0) * (0.15 + uBeat * 0.6);
  // faint radial tunnel haze so the frame is not pure black between stars
  col += uPrimary * 0.025 * smoothstep(1.3, 0.1, r) * (0.6 + uLevel * 0.6);

  // kick flash: brief exposure lift of the whole field
  col *= 1.0 + uBeat * 0.5;
  // soft tone map keeps bright heads from clipping into flat white
  col = 1.0 - exp(-col * 1.3);
  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uTravel', 'uStreak', 'uSpin', 'uLevel', 'uBass', 'uTreble', 'uBeat',
  'uPrimary', 'uAccent',
] as const;

export function createStarfieldWarp(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let travel = 0; // accumulated flight distance (speed*dt), wrapped at 4096 to keep float precision
  let spin = 0; // accumulated roll in turns

  return {
    id: 'starfield-warp',
    name: 'Hyperspace Starfield',
    init(context: VisualizerContext) {
      ctx = context;
      gl = context.gl;
      program = context.compileFragment(FRAG);
      for (const name of NAMES) u[name] = gl.getUniformLocation(program, name);
    },
    resize() {},
    render(frame: RenderFrame) {
      const a = frame.audio;
      // Flight speed in depth units per second: slow cruise in silence, faster with the music,
      // and each kick (beat -> 1.0) surges forward. Only the RATE is audio driven; the
      // distance is integrated here, so the field never jumps back.
      const speed = 0.3 + a.level * 0.9 + a.bass * 1.0 + a.beat * 4.5;
      travel = (travel + speed * frame.dt) % 4096;
      // streaks stretch with the current speed (instant on a kick, relaxing as the beat decays)
      const streak = Math.min(0.03 + speed * 0.085, 0.9);
      spin = (spin + (0.004 + a.mid * 0.006) * frame.dt) % 1;
      gl.useProgram(program);
      ctx.quad.bind(program);
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uTime, frame.time);
      gl.uniform1f(u.uTravel, travel);
      gl.uniform1f(u.uStreak, streak);
      gl.uniform1f(u.uSpin, spin);
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
