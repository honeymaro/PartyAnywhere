import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// A column of smoke rising from a glowing source. The smoke texture scrolls upward with an
// accumulated rise phase (audio sets the rate, kicks surge it), billows through a domain
// warp, and is shaped by a swaying, widening plume mask. Every kick puffs a hot, bright
// cloud out of the source that rides up the plume with the smoke (its height is computed
// on the CPU from the same rise phase), cooling and spreading as it climbs.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uRise;    // accumulated rise phase (audio modulates the rate on the CPU)
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec4 uPuff[5];  // kick puffs: height, age in seconds, strength, unused
uniform vec3 uPrimary;
uniform vec3 uAccent;

// integer lattice hash: the rise phase grows without bound and feeds the lattice coordinates,
// and a float hash like fract(p * 311.7) runs out of precision within minutes (the noise turns
// blocky, the embers into vertical lines); integer math stays exact for any realistic uptime
float hash(vec2 p) {
  uvec2 q = uvec2(ivec2(floor(p)));
  q = q * 1664525u + 1013904223u;
  q.x += q.y * 1664525u;
  q.y += q.x * 1664525u;
  q ^= q >> 16u;
  q.x += q.y * 1664525u;
  q.y += q.x * 1664525u;
  q ^= q >> 16u;
  return float(q.x ^ q.y) * (1.0 / 4294967295.0);
}

vec2 hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

// two independent value noises from one set of lattice lookups
vec2 noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 a = hash2(i);
  vec2 b = hash2(i + vec2(1.0, 0.0));
  vec2 c = hash2(i + vec2(0.0, 1.0));
  vec2 d = hash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

const mat2 M2 = mat2(1.6, 1.2, -1.2, 1.6); // 2x scale + rotation between octaves

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = M2 * p + vec2(1.7, 3.3);
    a *= 0.5;
  }
  return v / 0.9375;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution.y;          // y: 0 bottom .. 1 top
  float x = uv.x - 0.5 * uResolution.x / uResolution.y;
  float y = uv.y;
  float r = uRise;

  // plume centerline sways, the sway pattern rising with the smoke
  float sway = (noise(vec2(y * 1.6 - r * 0.8, 3.7)) - 0.5) * 0.45 * y;
  float cx = x - sway;
  float width = 0.07 + y * 0.42;

  // smoke texture scrolls up with the rise phase; a 2-octave warp makes it billow
  vec2 sp = vec2(cx * 2.4, y * 2.0 - r);
  vec2 wv = noise2(sp * 0.9) * 0.67 + noise2(M2 * sp * 0.9 + 5.0) * 0.33 - 0.5;
  float n = fbm(sp * 2.2 + wv * 1.5);

  // plume mask with a ragged edge, dissipating near the top
  float m = exp(-pow(cx / (width * (0.75 + 0.6 * n)), 2.0));
  float dens = m * smoothstep(0.3, 0.62, n + 0.3 * m - 0.08 * y);
  dens *= smoothstep(1.1, 0.55, y) * smoothstep(0.0, 0.05, y);
  float heat = exp(-y * 3.2); // hot near the source

  // Kick puffs riding up the plume: hot when born, cooling and spreading as they climb
  float puff = 0.0;
  float puffHeat = 0.0;
  for (int i = 0; i < 5; i++) {
    vec4 pf = uPuff[i];
    float age = pf.y;
    if (age > 3.0) continue;
    float rp = 0.07 + pf.x * 0.26;
    float dy = y - pf.x;
    // billowy ball: its edge is roughened by the smoke texture
    float dd = sqrt(cx * cx * 0.8 + dy * dy) / rp + (0.5 - n) * 0.6;
    float g = 1.0 - smoothstep(0.3, 1.0, dd);
    float k = pf.z * exp(-age * 0.6) * (1.0 - smoothstep(2.2, 3.0, age)) * g * (0.6 + 0.6 * n);
    puff += k;
    puffHeat += k * exp(-age * 1.5);
  }
  dens = clamp(dens + puff, 0.0, 1.0);
  heat = clamp(heat + puffHeat * 1.4, 0.0, 1.0);

  // dark room with a faint glow pooling around the source
  vec3 col = vec3(0.022, 0.024, 0.034) + uPrimary * 0.05 * (1.0 - y);
  col += uAccent * 0.3 * exp(-y * 9.0) * exp(-x * x * 10.0) * (1.0 + uBass * 0.8 + uBeat * 1.2);

  // smoke lit from the hot source below: cool palette smoke high up, hot accent low
  vec3 cool = mix(uPrimary, vec3(0.75), 0.3);
  vec3 hot = mix(uAccent, vec3(1.0), 0.25);
  vec3 smoke = mix(cool * 0.7, hot * 1.25, heat);
  // light falls off into the thick of the smoke, picking out billow tops
  float lit = 0.6 + 0.6 * smoothstep(0.35, 0.85, n);
  col = mix(col, smoke * lit, dens);
  // a freshly born puff glows like a flare
  col += hot * puffHeat * 0.6;
  // treble: soft round sparks rising with the smoke in the hot core (one jittered spark
  // in some of the square cells, Gaussian falloff so they never read as pixel blocks)
  vec2 eq = vec2(cx, y - r * 0.5) * 26.0;
  vec2 ei = floor(eq);
  float eh = hash(ei);
  vec2 eo = fract(eq) - 0.5 - (vec2(hash(ei + 7.3), hash(ei + 3.1)) - 0.5) * 0.5;
  float ember = step(0.86, eh) * exp(-dot(eo, eo) / 0.012);
  col += hot * ember * heat * m * uTreble * 0.9;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uRise', 'uBass', 'uTreble', 'uBeat', 'uPuff',
  'uPrimary', 'uAccent',
] as const;

const PUFFS = 5;
const SOURCE_Y = 0.06; // height where puffs are born
const RISE_TO_Y = 0.5; // screen height per unit of rise phase (matches y * 2.0 - r)

export function createSmokePlumeRise(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  const puffs = new Float32Array(PUFFS * 4); // height, age, strength, unused
  const spawnRise = new Float32Array(PUFFS); // rise phase when each puff was born
  let slot = 0;
  let prevBass = 0;
  let prevBeat = 0;
  let sinceHit = 1;
  let rise = 0; // rise phase (audio modulates the rate; only ever increases)

  return {
    id: 'smoke-plume-rise',
    name: 'Rising Smoke Plume',
    init(context: VisualizerContext) {
      ctx = context;
      gl = context.gl;
      program = context.compileFragment(FRAG);
      for (const name of NAMES) u[name] = gl.getUniformLocation(program, name);
      for (let i = 0; i < PUFFS; i++) puffs[i * 4 + 1] = 99;
    },
    resize() {},
    render(frame: RenderFrame) {
      const dt = Math.min(frame.dt, 0.1);
      const a = frame.audio;
      // kicks surge the updraft, pushing the whole column (and its puffs) upward
      rise += (0.45 + a.level * 0.35 + a.beat * 1.5) * dt;
      sinceHit += dt;
      // Kick detector: the bass snaps up fast on a kick (> 11/s, i.e. +0.18 in one 60 fps
      // frame; slower bassline swells do not), or the onset pulse jumps to ~1.0 (kicks only;
      // snares, bass notes and hats pulse lower).
      const bassRise = (a.bass - prevBass) / Math.max(frame.dt, 1e-3);
      const kick = (a.bass > 0.6 && bassRise > 11) || (a.beat > 0.95 && a.beat > prevBeat + 0.2);
      if (kick && sinceHit > 0.2) {
        sinceHit = 0;
        spawnRise[slot] = rise;
        puffs[slot * 4 + 1] = 0;
        puffs[slot * 4 + 2] = Math.max(a.beat, a.bass);
        slot = (slot + 1) % PUFFS;
      }
      prevBass = a.bass;
      prevBeat = a.beat;
      for (let i = 0; i < PUFFS; i++) {
        puffs[i * 4] = SOURCE_Y + (rise - spawnRise[i]) * RISE_TO_Y;
        puffs[i * 4 + 1] += dt;
      }

      gl.useProgram(program);
      ctx.quad.bind(program);
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uRise, rise);
      gl.uniform1f(u.uBass, a.bass);
      gl.uniform1f(u.uTreble, a.treble);
      gl.uniform1f(u.uBeat, a.beat);
      gl.uniform4fv(u.uPuff, puffs);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
    },
  };
}
