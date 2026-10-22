import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Flight down a twisting tunnel of beveled metal panels separated by glowing seams, with a neon
// rib every few meters. The wall is a relief heightfield on a cylinder. The camera sits on the
// axis, so each ray keeps a constant polar angle (one atan per pixel); the ray is clipped to the
// relief shell analytically and searched there (linear search + bisection), which stays exact for
// grazing rays where a sphere-traced march stalls. Travel and twist are accumulated on the CPU
// (audio changes their RATE) and wrapped to the pattern period, so the shader never sees large
// phases. A kick surges the speed, flashes seams and ribs and launches a ring of light down the tube.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uZ;        // travel distance wrapped to the pattern period (CPU)
uniform float uTwist;    // twist phase incl. the helix offset of the travel (CPU, wrapped)
uniform float uKickAge;  // seconds since the last kick (CPU rising edge)
uniform vec2 uSway;      // gentle time-only look sway
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

const float RAD = 1.0;       // tunnel radius
const float HMAX = 0.15;     // max relief (plates + ribs)
const float SEG = 9.0;       // panels around the circumference
const float ARC = 0.6981;    // TAU * RAD / SEG: panel width in world units
const float TWIST_K = 0.22;  // helix twist (radians per unit depth)
const float FAR = 42.0;
const float TAU = 6.2831853;

// wall at polar angle th and local depth zl.
// x: inward relief, y: seam line, z: soft seam halo, w: rib neon line
vec4 wall(float th, float zl) {
  float ang = th + TWIST_K * zl + uTwist;
  float z = zl + uZ;
  float du = (0.5 - abs(fract(ang * (SEG / TAU)) - 0.5)) * ARC; // distance to the long seam
  float dz = 0.5 - abs(fract(z) - 0.5);                          // distance to the ring seam
  float ds = min(du, dz);
  float plate = smoothstep(0.012, 0.06, ds);
  float rz = abs(fract(z * 0.125) - 0.5) * 8.0;                  // distance to the rib center
  float rib = smoothstep(0.24, 0.14, rz);
  float relief = plate * 0.06 + rib * (0.09 - 0.05 * smoothstep(0.05, 0.0, rz));
  return vec4(relief, smoothstep(0.022, 0.0, ds) * (1.0 - rib), smoothstep(0.14, 0.0, ds), smoothstep(0.05, 0.0, rz));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  vec3 rd = normalize(vec3(uv + uSway, 0.9));
  float rxy = length(rd.xy);
  float th = atan(rd.y, rd.x);

  vec3 P = uPrimary * uPrimary;
  vec3 A = uAccent * uAccent;

  // vanishing-point glow (seen down the axis and through the fog)
  vec3 fogCol = mix(P, A, 0.3) * 0.035;
  vec3 col = fogCol;
  col += mix(P, A, 0.5) * exp(-length(rd.xy / rd.z) * 9.0) * (0.35 + 0.4 * uBass + 1.2 * uBeat);

  // along the ray: radius = t * rxy, depth = t * rd.z; free space where RAD - relief - radius > 0
  float tIn = (RAD - HMAX) / max(rxy, 1e-5);
  if (tIn < FAR) {
    float tOut = min(RAD / rxy, FAR);
    // linear search through the relief shell, then bisection
    float dt = (tOut - tIn) / 16.0;
    float lo = tIn;
    float hi = tOut;
    for (int i = 1; i <= 16; i++) {
      float t = tIn + dt * float(i);
      if (RAD - wall(th, t * rd.z).x - t * rxy <= 0.0) { hi = t; break; }
      lo = t;
    }
    for (int j = 0; j < 5; j++) {
      float m = 0.5 * (lo + hi);
      if (RAD - wall(th, m * rd.z).x - m * rxy <= 0.0) hi = m; else lo = m;
    }
    float t = hi;
    float zl = t * rd.z;
    vec3 p = rd * t;
    vec4 w = wall(th, zl);

    // heightfield normal: grad(RAD - h(th, z) - r) = -e_r - (dh/dth / r) e_th - dh/dz e_z
    const float e = 0.002;
    float hth = (wall(th + e, zl).x - w.x) / e;
    float hz = (wall(th, zl + e).x - w.x) / e;
    vec2 er = rd.xy / rxy;
    vec3 n = normalize(vec3(-er - vec2(-er.y, er.x) * (hth / (RAD - w.x)), -hz));

    // headlight just above the camera; inverse-square falloff gives the depth fade
    vec3 ld = vec3(0.0, 0.3, 0.3) - p;
    float ll = length(ld);
    ld /= ll;
    float att = 1.0 / (1.0 + 0.14 * ll * ll);
    float dif = clamp(dot(n, ld), 0.0, 1.0);
    float spe = pow(clamp(dot(n, normalize(ld - rd)), 0.0, 1.0), 48.0);

    // dark brushed panels tinted by the primary; ribs a little brighter
    float z = zl + uZ;
    float rib = smoothstep(0.24, 0.14, abs(fract(z * 0.125) - 0.5) * 8.0);
    float grain = 0.88 + 0.12 * sin(z * 50.2655 + th * 7.0);
    vec3 alb = mix(P * 0.16 + 0.012, P * 0.26 + 0.04, rib) * grain;
    col = alb * (dif * att * 1.4 + 0.02);
    col += vec3(1.0, 0.96, 0.9) * spe * att * (0.45 + 0.9 * uTreble);

    // glowing seams: steady accent glow, flashed by kicks, hue alternates per panel ring
    float hue = 0.5 + 0.5 * sin(floor(z) * 1.5708); // 4-ring cycle (divides the wrap period)
    vec3 seamCol = mix(A, P * 1.4, hue * 0.7);
    // kick ring: a band of light racing away from the camera, fading as it goes
    float ring = exp(-pow((zl - uKickAge * 24.0) * 0.6, 2.0)) * exp(-uKickAge * 1.8);
    float seamI = 0.55 + 0.6 * uBass + 2.4 * uBeat + 5.0 * ring;
    col += seamCol * (w.y * seamI + w.z * w.z * 0.12 * seamI);
    // rib neon: the ring lights flash on every kick
    col += mix(A, vec3(1.0), 0.15) * w.w * (0.7 + 0.8 * uBass + 3.5 * uBeat + 6.0 * ring);
    col += A * ring * 0.25;

    // depth fog toward the palette haze
    col = mix(fogCol, col, exp(-t * 0.06));
  }

  col = col / (1.0 + col * 0.5);
  col = pow(col, vec3(0.4545));
  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uZ', 'uTwist', 'uKickAge', 'uSway', 'uBass', 'uTreble', 'uBeat', 'uPrimary', 'uAccent',
] as const;

const TWIST_K = 0.22;
const Z_PERIOD = 8; // all z patterns repeat every 8 units
const TAU = Math.PI * 2;

export function createRaymarchTwistTunnel(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let travel = 0; // distance flown, wrapped to Z_PERIOD (rate rides level + bass + beat)
  let helix = 0; // TWIST_K * travel, wrapped to 2PI (keeps the helix fixed in the world)
  let spin = 0; // extra twist phase (rate rides mids)
  let prevBeat = 0;
  let kickAge = 10;

  return {
    id: 'raymarch-twist-tunnel',
    name: 'Twisting SDF Tunnel',
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
      const dt = frame.dt;
      const dz = (1.6 + a.level * 1.6 + a.bass * 1.0 + a.beat * 7.0) * dt;
      travel = (travel + dz) % Z_PERIOD;
      helix = (helix + TWIST_K * dz) % TAU;
      spin = (spin + (0.12 + a.mid * 0.3) * dt) % TAU;
      // rising edge of the onset pulse launches a new light ring
      if (a.beat > 0.6 && prevBeat <= 0.6) kickAge = 0;
      else kickAge += dt;
      prevBeat = a.beat;

      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uZ, travel);
      gl.uniform1f(u.uTwist, (helix + spin) % TAU);
      gl.uniform1f(u.uKickAge, Math.min(kickAge, 10));
      gl.uniform2f(u.uSway, 0.07 * Math.sin(frame.time * 0.31), 0.05 * Math.sin(frame.time * 0.23 + 1.0));
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
