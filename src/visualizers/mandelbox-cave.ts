import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Flight through an endless cave built from the Mandelbox folds (box fold + sphere fold,
// without the Mandelbox scale step: the "pseudo-Kleinian" variant). Unlike the scaled
// Mandelbox, whose interior is either solid or thin slots, this fold set forms halls with
// floors, ceilings, pillars and arches, and it is exactly periodic (the reflection group of
// the box fold translates by 4x the box size), so the camera position is wrapped into one
// cell on the CPU and can travel forever. The fold set's own pillars are infinitely thin
// lines (they aliased into stray pink streaks), so they are wrapped in faceted crystal
// columns that flare into floor and ceiling: two colonnades flank the flight path and give
// the hall solid structure in the middle distance. The line y = 0.808, z = 1.0 runs through
// open space for every x (DE >= 0.6 for any inversion radius, columns 0.65 away), so the
// camera never clips a wall. Travel is accumulated on the CPU (kicks surge it), the geometry
// only morphs slowly with time, and each kick launches a pulse of light down the cave and
// lights up the crystals.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform vec3 uCamPos;   // accumulated travel along +x, wrapped into one cell (z is up)
uniform mat3 uCamRot;   // camera basis (slow time-only look-around)
uniform float uInv;     // sphere-fold radius^2 (slow time-only morph)
uniform float uPulse;   // distance of the kick light pulse ahead of the camera
uniform float uPulseAmp;
uniform float uLevel;
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

const vec3 CS = vec3(0.808, 0.808, 1.167); // box-fold half size
const vec3 CELL = 4.0 * CS;                // exact period of the fold set

// DE: wrap into one cell, 3 x (box fold, sphere fold), then the Kleinian slab/cylinder test.
// (A 4th fold only added sub-pixel detail to the floor ornaments at ~15 % more cost.)
float fractal(vec3 p) {
  p = mod(p + 2.0 * CS, CELL) - 2.0 * CS;
  float s = 1.0;
  for (int i = 0; i < 3; i++) {
    p = 2.0 * clamp(p, -CS, CS) - p;
    float k = max(uInv / dot(p, p), 1.0);
    p *= k;
    s *= k;
  }
  float rxy = length(p.xy);
  return max(rxy - 0.92784, abs(rxy * p.z) / length(p)) / s;
}

// Crystal columns: slightly rounded octagonal prisms around the pillar lines
// (x, y) = 0 mod 2 * CS, slim in the middle of the hall and flaring where they meet the
// floor/ceiling plates (z = 0 mod 2 * CS.z). The rounding keeps the facet edges from
// collapsing into 1-px highlight lines; the 0.9 factor covers the slope of the flare.
float column(vec3 p) {
  vec2 q = abs(mod(p.xy + CS.xy, 2.0 * CS.xy) - CS.xy);
  float zc = abs(mod(p.z + CS.z, 2.0 * CS.z) - CS.z);
  float r = 0.06 + 0.15 * smoothstep(0.8, 0.15, zc);
  float oct = max(max(q.x, q.y), (q.x + q.y) * 0.7071);
  return (oct * 0.65 + length(q) * 0.35 - r) * 0.9;
}

float map(vec3 p) {
  return min(fractal(p), column(p));
}

// Orbit trap at the hit point: closest approach to the fold center and to the z = 0 plane.
vec2 trap(vec3 p) {
  p = mod(p + 2.0 * CS, CELL) - 2.0 * CS;
  vec2 tr = vec2(1e9);
  for (int i = 0; i < 4; i++) {
    p = 2.0 * clamp(p, -CS, CS) - p;
    float r2 = dot(p, p);
    tr = min(tr, vec2(r2, abs(p.z)));
    p *= max(uInv / r2, 1.0);
  }
  return tr;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  vec3 ro = uCamPos;
  vec3 rd = normalize(uCamRot * vec3(uv, 0.9));

  // grazing rays along the floor/ceiling are the expensive ones; they end in the fog
  const float T_MAX = 5.5;
  float t = 0.02;
  float d = 1.0;
  int steps = 0;
  bool converged = false;
  for (int i = 0; i < 22; i++) {
    d = map(ro + rd * t);
    if (d < 0.0035 * t) { converged = true; break; }
    t += d * 0.95;
    steps = i;
    if (t > T_MAX) break;
  }
  // Rays that run out of steps are shaded as surface in proportion to how close they got
  // (grazing an edge) and fade to fog when they were still in open space.
  float surf = t < T_MAX ? smoothstep(0.06, 0.006, d) : 0.0;
  bool hit = surf > 0.0;
  t = min(t, T_MAX);

  // misty fog that glows toward the vanishing point: the far columns stand out against it
  // as silhouettes, so the hall reads as depth rather than a dark void
  vec3 fogCol = mix(uPrimary, uAccent, 0.3) * (0.09 + 0.2 * pow(max(dot(rd, uCamRot[2]), 0.0), 4.0));
  vec3 col = fogCol;
  if (hit) {
    vec3 p = ro + rd * t;
    float e = 0.0006 + t * 0.0008;
    // forward-difference normal: 3 DE evals around the last march sample (re-evaluated
    // only for the few rays that ran out of steps, whose last sample is not at p)
    float d0 = converged ? d : map(p);
    vec3 n = normalize(vec3(map(p + vec3(e, 0.0, 0.0)), map(p + vec3(0.0, e, 0.0)),
                            map(p + vec3(0.0, 0.0, e))) - d0);
    // AO: one probe along the normal plus a mild march-step term (crevices take more steps)
    float ao = clamp(map(p + n * 0.08) / 0.08, 0.0, 1.0);
    ao *= 1.0 - float(steps) / 48.0;

    // palette from the orbit trap: primary body shading into accent, thin glowing veins;
    // the crystal columns get their own darker, glassier material
    float crystal = step(column(p), 0.004 + t * 0.003); // columns are cheap to test alone
    vec2 tr = trap(p);
    vec3 base = mix(uPrimary, uAccent, smoothstep(0.25, 0.9, sqrt(tr.x)));
    float vein = smoothstep(0.035, 0.0, tr.y) * (1.0 - crystal);
    base = mix(base, mix(uPrimary, uAccent, 0.35) * 0.55, crystal);

    // headlight just above the camera, falling off with distance, plus a two-tone sky light
    vec3 lp = ro + vec3(0.05, 0.0, 0.12);
    vec3 ld = normalize(lp - p);
    float diff = max(dot(n, ld), 0.0);
    float spec = pow(max(dot(reflect(-ld, n), -rd), 0.0), 20.0);
    float atten = 1.0 / (1.0 + t * t * 0.12);
    vec3 amb = mix(uAccent, uPrimary, n.z * 0.5 + 0.5) * 0.24;
    vec3 lit = base * (amb + diff * atten * (1.0 + uBass * 0.35)) * ao;
    lit += mix(uAccent, vec3(1.0), 0.5) * spec * atten * ao * (0.35 + uTreble * 0.5 + crystal * 0.9);
    // crystals: fresnel edge glow that flares on the kick, so the colonnade pulses
    float fres = pow(1.0 - abs(dot(n, rd)), 2.0);
    lit += mix(uAccent, vec3(1.0), 0.2) * crystal * (0.12 + fres * 0.45) * (0.35 + uBeat * 1.0 + uBass * 0.2);
    // crystal veins glow by themselves and flare on the kick
    lit += mix(uAccent, vec3(1.0), 0.25) * vein * (0.25 + uBeat * 1.2 + uTreble * 0.2) * (0.4 + 0.6 * ao);

    // kick pulse: a sheet of accent light sweeping away down the cave
    float pz = t * rd.x;
    lit += uAccent * uPulseAmp * exp(-abs(pz - uPulse) * 2.5) * (0.3 + diff) * ao * 1.1;

    // lighter fog than before; it reaches the fog color smoothly at T_MAX (no seam)
    float fog = exp(-t * 0.16) * smoothstep(T_MAX, T_MAX - 1.8, t);
    col = mix(fogCol, lit, fog * surf);
  }

  // the pulse is also a thin sheet of glowing haze: rays that cross it light up, so the
  // kick reads in the open hall too, then recedes into the fog
  float sheetT = uPulse / max(rd.x, 0.1);
  if (sheetT < t) col += uAccent * uPulseAmp * 0.1 * exp(-sheetT * 0.32);

  // instant kick flash + slow level lift (brightness only)
  col *= 0.9 + uLevel * 0.2 + uBeat * 0.3;
  col = 1.0 - exp(-col * 1.8);
  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uCamPos', 'uCamRot', 'uInv', 'uPulse', 'uPulseAmp',
  'uLevel', 'uBass', 'uTreble', 'uBeat', 'uPrimary', 'uAccent',
] as const;

export function createMandelboxCave(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let travel = 0; // distance along the corridor (rate rides the music; only ever increases)
  let pulse = 0; // kick light pulse: distance ahead of the camera
  let pulseAmp = 0;
  let prevBeat = 0;
  const camRot = new Float32Array(9);
  const CELL_X = 4 * 0.808; // fold-set period along the flight axis

  return {
    id: 'mandelbox-cave',
    name: 'Mandelbox Crystal Cave',
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
      const time = frame.time;
      travel += (0.25 + a.level * 0.3 + a.bass * 0.3 + a.beat * 1.3) * frame.dt;

      // kick (rising edge; kicks reach 1.0, other onsets stay below ~0.9) launches a light
      // pulse that runs away from the camera and fades
      if (a.beat > 0.92 && prevBeat <= 0.92) {
        pulse = 0.3;
        pulseAmp = 1;
      }
      prevBeat = a.beat;
      pulse += 5.5 * frame.dt;
      pulseAmp *= Math.exp(-frame.dt / 0.35);

      // camera: flies along +x on the open line y = 0.808, z = 1.0 (z is up, slightly below
      // mid-hall so floor and ceiling both show) with a small time-only wander and a slow
      // look-around: yaw, pitch and a gentle roll of a few degrees
      const cy = 0.808 + Math.sin(time * 0.21) * 0.1;
      const cz = 1.0 + Math.cos(time * 0.17) * 0.08;
      const yaw = Math.sin(time * 0.09) * 0.3;
      const pitch = Math.sin(time * 0.11) * 0.16;
      const roll = Math.sin(time * 0.053) * 0.07;
      const fx = Math.cos(yaw) * Math.cos(pitch), fy = Math.sin(yaw) * Math.cos(pitch), fz = Math.sin(pitch);
      // right = normalize(cross(f, up)) = (fy, -fx, 0) / len; up' = cross(right, f)
      const rl = Math.hypot(fx, fy);
      const rx = fy / rl, ry = -fx / rl;
      const ux = ry * fz, uy = -rx * fz, uz = rx * fy - ry * fx;
      const cr = Math.cos(roll), sr = Math.sin(roll);
      camRot.set([
        rx * cr + ux * sr, ry * cr + uy * sr, uz * sr,
        ux * cr - rx * sr, uy * cr - ry * sr, uz * cr,
        fx, fy, fz,
      ]);

      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform3f(u.uCamPos, travel % CELL_X, cy, cz);
      gl.uniformMatrix3fv(u.uCamRot, false, camRot);
      gl.uniform1f(u.uInv, 0.71 + Math.sin(time * 0.029) * 0.05);
      gl.uniform1f(u.uPulse, pulse);
      gl.uniform1f(u.uPulseAmp, pulseAmp);
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
