import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Power-8-ish Mandelbulb seen from a slowly orbiting camera. The fractal power morphs on a slow
// time-only cycle (never with audio, so the shape does not jitter); the camera orbit angle is
// accumulated on the CPU (audio only changes its RATE). Kicks flash the rim / crevice glow, lift
// the halo behind the bulb and give a small (< 5 %) size pulse.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform vec3 uCamPos;   // orbit camera (CPU)
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform float uPower;   // fractal power, slow time-only morph
uniform float uPulse;   // kick size pulse (1.0 .. 1.04)
uniform float uPixel;   // ray-cone footprint per unit distance (hit epsilon)
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

const float FOCAL = 1.6;
const float BOUND = 1.2;

// Trigonometric Mandelbulb DE (4 iterations, bailout 256 for a smooth field).
// tr.x = final |z|^2 (cheap occlusion term), tr.yzw = orbit traps used for soft coloring.
float mapBulb(vec3 p, out vec4 tr) {
  vec3 w = p;
  float m = dot(w, w);
  vec4 trap = vec4(abs(w), m);
  float dz = 1.0;
  for (int i = 0; i < 4; i++) {
    float r = sqrt(m);
    float rp = pow(r, uPower - 1.0);
    dz = uPower * rp * dz + 1.0;
    float b = uPower * acos(clamp(w.y / r, -1.0, 1.0));
    float a = uPower * atan(w.x, w.z);
    float sb = sin(b);
    w = p + rp * r * vec3(sb * sin(a), cos(b), sb * cos(a));
    trap = min(trap, vec4(abs(w), m));
    m = dot(w, w);
    if (m > 256.0) break;
  }
  tr = vec4(m, trap.yzw);
  return 0.25 * log(m) * sqrt(m) / dz;
}

float map(vec3 p, out vec4 tr) {
  return mapBulb(p / uPulse, tr) * uPulse;
}

vec3 calcNormal(vec3 p, float h) {
  const vec2 k = vec2(1.0, -1.0);
  vec4 tr;
  return normalize(
    k.xyy * map(p + k.xyy * h, tr) +
    k.yyx * map(p + k.yyx * h, tr) +
    k.yxy * map(p + k.yxy * h, tr) +
    k.xxx * map(p + k.xxx * h, tr));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  vec3 ro = uCamPos;
  vec3 rd = normalize(uv.x * uCamRight + uv.y * uCamUp + FOCAL * uCamFwd);

  // palette in linear light
  vec3 P = uPrimary * uPrimary;
  vec3 A = uAccent * uAccent;

  // backdrop: deep palette-tinted gradient plus a halo around the bulb (closest approach of the ray)
  float b = dot(ro, rd);
  float c = dot(ro, ro);
  float h2 = c - b * b;
  float closest = sqrt(max(h2, 0.0));
  vec3 col = mix(vec3(0.004, 0.004, 0.010), P * 0.035, 0.5 + 0.5 * uv.y);
  float halo = exp(-max(closest - 0.75, 0.0) * 3.2);
  col += mix(P, A, 0.55) * halo * (0.05 + 0.12 * uBass + 0.7 * uBeat);

  float rb = BOUND * uPulse;
  float disc = b * b - (c - rb * rb);
  if (disc > 0.0) {
    float sq = sqrt(disc);
    float t = max(-b - sq, 0.0);
    float tFar = -b + sq;
    vec4 tr = vec4(0.0);
    bool hit = false;
    // slightly over-relaxed steps (the bulb DE underestimates) and a hit epsilon that widens
    // with the step count, so silhouette rays stop early instead of crawling along the surface
    float eps = uPixel;
    for (int i = 0; i < 56; i++) {
      float d = map(ro + rd * t, tr);
      if (d < eps * t) { hit = true; break; }
      t += d * 1.2;
      eps *= 1.04;
      if (t > tFar) break;
    }

    if (hit) {
      vec3 pos = ro + rd * t;
      vec3 n = calcNormal(pos, uPixel * t * 0.5);

      // soft orbit-trap coloring from the palette (low frequency, no speckle)
      float occ = clamp(0.06 * log(tr.x) + 0.05, 0.0, 1.0);
      vec3 alb = P * 0.04;
      alb = mix(alb, P * 0.24, clamp(tr.y, 0.0, 1.0));
      alb = mix(alb, mix(P, A, 0.35) * 0.2, clamp(tr.z * tr.z, 0.0, 1.0));
      alb = mix(alb, mix(A, P, 0.25) * 0.32, clamp(pow(tr.w, 6.0), 0.0, 1.0));

      vec3 L = normalize(uCamRight * 0.8 + uCamUp * 0.6 - uCamFwd * 0.1);
      float dif = clamp(dot(n, L), 0.0, 1.0);
      float sky = clamp(0.5 + 0.5 * dot(n, uCamUp), 0.0, 1.0);
      float bac = clamp(dot(n, -L), 0.0, 1.0);
      float fre = pow(clamp(1.0 + dot(rd, n), 0.0, 1.0), 3.0);
      float spe = pow(clamp(dot(n, normalize(L - rd)), 0.0, 1.0), 28.0) * dif;

      vec3 lin = vec3(0.0);
      lin += 5.0 * dif * vec3(1.0, 0.95, 0.88) * (0.3 + 0.7 * occ);
      lin += 1.2 * sky * mix(P, vec3(1.0), 0.3) * occ;
      lin += 0.6 * bac * A * occ;
      col = alb * lin;
      col += spe * (0.35 + 0.9 * uTreble) * occ;

      // rim and crevice glow: the visible kick response
      col += A * fre * occ * (0.2 + 0.35 * uBass + 2.2 * uBeat);
      col += mix(P, A, 0.3) * (1.0 - occ) * (1.0 - occ) * (0.03 + 0.3 * uBass + 1.6 * uBeat);
    }
  }

  // gentle tone map and gamma
  col = col / (1.0 + col * 0.6);
  col = pow(col, vec3(0.4545));
  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uCamPos', 'uCamRight', 'uCamUp', 'uCamFwd', 'uPower', 'uPulse', 'uPixel',
  'uBass', 'uTreble', 'uBeat', 'uPrimary', 'uAccent',
] as const;

const FOCAL = 1.6;
const CAM_DIST = 4.2;

export function createMandelbulbOrbit(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let orbit = 0.6; // camera orbit angle (rate rides level + beat; only ever increases)

  return {
    id: 'mandelbulb-orbit',
    name: 'Mandelbulb Alien Orbit',
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
      orbit += (0.08 + a.level * 0.08 + a.beat * 0.3) * frame.dt;

      // orbit camera (elevation drifts on a slow time-only cycle)
      const elev = 0.25 + 0.3 * Math.sin(frame.time * 0.09);
      const ce = Math.cos(elev);
      const px = CAM_DIST * ce * Math.cos(orbit);
      const py = CAM_DIST * Math.sin(elev);
      const pz = CAM_DIST * ce * Math.sin(orbit);
      const fx = -px / CAM_DIST, fy = -py / CAM_DIST, fz = -pz / CAM_DIST;
      // right = normalize(cross(fwd, worldUp)), up = cross(right, fwd)
      let rx = -fz, rz = fx;
      const rl = Math.hypot(rx, rz) || 1;
      rx /= rl; rz /= rl;
      const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;

      const power = 8.0 + 1.2 * Math.sin(frame.time * 0.045);
      const pulse = 1.0 + 0.04 * a.beat;

      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform3f(u.uCamPos, px, py, pz);
      gl.uniform3f(u.uCamRight, rx, 0, rz);
      gl.uniform3f(u.uCamUp, ux, uy, uz);
      gl.uniform3f(u.uCamFwd, fx, fy, fz);
      gl.uniform1f(u.uPower, power);
      gl.uniform1f(u.uPulse, pulse);
      gl.uniform1f(u.uPixel, 2.0 / (Math.min(frame.resolution[0], frame.resolution[1]) * FOCAL));
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
