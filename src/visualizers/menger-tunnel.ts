import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Flight down the central channel of an infinite Menger-style lattice. Travel and roll are
// accumulated on the CPU (audio sets the RATE: kicks surge the speed, mids spin the roll a
// little faster), the geometry is fixed (no audio inside the DE, so it never flickers), and
// surfaces get headlight + key light + AO + fog shading, colored by lattice level from the
// palette. Rays that skim past bar edges collect a glow that flashes on the kick. Cost: no
// extra edge DE pass, a 30-step march with a distance-scaled hit threshold, and the finest
// lattice level only near the camera.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTravel; // accumulated forward distance (never reverses)
uniform vec2 uRoll;    // cos/sin of the accumulated roll angle
uniform vec2 uYaw;     // cos/sin of a slow time-only look-around
uniform float uLevel;
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

float sdCross(vec3 p) {
  vec3 d = abs(p) - 1.0;
  return min(max(d.x, d.y), min(max(d.y, d.z), max(d.x, d.z)));
}

// Fixed lattice, tiled every 3 units along z (the fold is mirror-continuous at the tile
// seam, so the DE stays a valid bound and the march can step 0.9 of it). The 4th, finest
// level is blended out with distance (lod 1 -> 0): far away it only aliased into noise, and
// skipping it there saves a quarter of the work. lvl returns the coarsest level that shapes
// the surface, used for coloring.
float map(vec3 p, float lod, out float lvl) {
  p.z = mod(p.z, 3.0) - 1.5;
  float scale = 1.0;
  float d = -1e10;
  lvl = 0.0;
  for (int i = 0; i < 3; i++) {
    p = abs(abs(p) - 1.5) - 0.5;
    p *= 3.0;
    scale *= 3.0;
    float c = sdCross(p) / scale;
    if (c > d) { d = c; lvl = float(i); }
  }
  if (lod > 0.0) {
    p = abs(abs(p) - 1.5) - 0.5;
    float c = sdCross(p * 3.0) / (scale * 3.0);
    float d4 = max(d, c);
    if (c > d) lvl = mix(lvl, 3.0, lod);
    d = mix(d, d4, lod);
  }
  return d;
}

float map(vec3 p, float lod) {
  float l;
  return map(p, lod, l);
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - uResolution) / min(uResolution.x, uResolution.y);

  vec3 ro = vec3(0.0, 0.0, uTravel);
  vec3 rd = normalize(vec3(uv, 1.7));
  rd.xz = mat2(uYaw.x, -uYaw.y, uYaw.y, uYaw.x) * rd.xz;
  rd.xy = mat2(uRoll.x, -uRoll.y, uRoll.y, uRoll.x) * rd.xy;

  const float T_MAX = 10.0;
  float t = 0.0;
  float d = 1.0;
  float glow = 0.0;
  for (int i = 0; i < 30; i++) {
    float lod = smoothstep(3.2, 2.0, t);
    d = map(ro + rd * t, lod);
    // edge glow: rays that skim past bars collect light (falls off with distance)
    glow += 0.012 / (0.012 + d * d * 900.0) / (1.0 + t * 0.3);
    if (d < 0.0025 * t + 0.0004) break;
    t += d * 0.9;
    if (t > T_MAX) break;
  }
  // Rays that run out of steps are shaded as surface in proportion to how close they got
  // (grazing a bar edge) and fade to fog when they were still in open space.
  float surf = t < T_MAX ? smoothstep(0.04, 0.004, d) : 0.0;
  bool hit = surf > 0.0;
  t = min(t, T_MAX);

  float fog = exp(-t * 0.22);
  vec3 fogCol = mix(uPrimary, uAccent, 0.3) * 0.03;
  vec3 col = fogCol;

  if (hit) {
    vec3 p = ro + rd * t;
    float lod = smoothstep(3.2, 2.0, t);
    // tetrahedral normal (4 DE evals) with an epsilon that grows with distance
    float e = 0.0008 + t * 0.0008;
    vec2 k = vec2(1.0, -1.0);
    vec3 n = normalize(k.xyy * map(p + k.xyy * e, lod) + k.yyx * map(p + k.yyx * e, lod) +
                       k.yxy * map(p + k.yxy * e, lod) + k.xxx * map(p + k.xxx * e, lod));
    // one-sample AO along the normal; it also tells which lattice level shaped this face
    float lvl;
    float ao = clamp(map(p + n * 0.05, lod, lvl) / 0.05, 0.0, 1.0);
    ao = 0.3 + 0.7 * ao;

    // big structural bars take the primary, the finer levels shade into the accent
    vec3 base = mix(uPrimary, uAccent, smoothstep(0.5, 2.0, lvl));
    // headlight fill + a fixed key light so the three face orientations read apart
    float diff = max(dot(n, -rd), 0.0);
    float key = max(dot(n, normalize(vec3(0.55, 0.75, -0.35))), 0.0);
    float rim = pow(1.0 - diff, 3.0);
    vec3 lit = base * (0.06 + 0.45 * diff + 0.8 * key) * ao;
    lit += mix(uAccent, vec3(1.0), 0.35) * rim * ao * (0.2 + uBeat * 1.0 + uTreble * 0.25);
    col = mix(fogCol, lit, fog * surf);
  }

  // Kick: the edge glow flashes (palette accent), the bass bed keeps a soft base level.
  float gk = 0.5 + uLevel * 0.3 + uBass * 0.5 + uBeat * 2.4;
  col += mix(uPrimary, uAccent, 0.65) * glow * 0.02 * gk;

  col = 1.0 - exp(-col * 1.4);
  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTravel', 'uRoll', 'uYaw', 'uLevel', 'uBass', 'uTreble', 'uBeat', 'uPrimary', 'uAccent',
] as const;

export function createMengerTunnel(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let travel = 0; // forward distance (rate rides level + bass, kicks surge it; only increases)
  let roll = 0; // roll angle (rate rides the mids; only ever increases)

  return {
    id: 'menger-tunnel',
    name: 'Menger Sponge Tunnel',
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
      travel += (0.5 + a.level * 0.5 + a.bass * 0.5 + a.beat * 2.8) * frame.dt;
      roll += (0.06 + a.mid * 0.1 + a.beat * 0.15) * frame.dt;
      const yaw = Math.sin(frame.time * 0.07) * 0.12;
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uTravel, travel % 3); // the lattice repeats every 3 units along z
      gl.uniform2f(u.uRoll, Math.cos(roll), Math.sin(roll));
      gl.uniform2f(u.uYaw, Math.cos(yaw), Math.sin(yaw));
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
