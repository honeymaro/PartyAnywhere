import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Glossy black ferrofluid blob. Spikes stand on 62 fixed directions (icosahedral set: 12 vertices,
// 20 faces, 30 edges) found with a polyhedral fold, so the spike layout never morphs. Each spike is
// an exact cone smooth-unioned with the sphere (meniscus at the base), so the field stays a near
// true distance and the march needs no artifact-prone overshoot. Bass raises the spikes, a kick
// jolts them and flashes the studio lights; heights are clamped on the CPU so the blob stays framed.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform mat3 uRot;      // blob orientation (CPU, audio-rate accumulated)
uniform vec3 uSpike;    // spike heights: vertex / face / edge class (CPU, bounded)
uniform float uWobble;  // slow time-only phase of the surface wobble
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

const float RAD = 0.68;     // blob radius
const float BOUND = 1.34;   // bounding sphere (RAD + max spike + wobble)
const float FOCAL = 1.7;
// icosahedral fold (Knighty): mirrors x=0, y=0 and NC generate the full H3 group
const vec3 NC = vec3(-0.5, -0.809017, 0.309017);
const vec3 DIR_V = vec3(0.525731, 0.0, 0.850651);   // nearest icosahedron vertex
const vec3 DIR_F = vec3(0.0, 0.356822, 0.934172);   // nearest face center
const vec3 DIR_E = vec3(0.0, 0.0, 1.0);             // nearest edge midpoint
const vec2 CONE = vec2(0.94, 0.342);                // (cos, sin) of the spike half-angle (20 deg)

vec3 icoFold(vec3 p) {
  for (int i = 0; i < 5; i++) {
    p.xy = abs(p.xy);
    p -= 2.0 * min(0.0, dot(p, NC)) * NC;
  }
  return p;
}

// exact distance to an infinite cone with apex at height h along axis a, opening downward
float spikeD(vec3 p, vec3 a, float h) {
  float y = dot(p, a);
  float q = sqrt(max(dot(p, p) - y * y, 0.0));
  vec2 w = vec2(q, y - h);
  return dot(w, vec2(CONE.y, -CONE.x)) < 0.0 ? length(w) : dot(w, CONE);
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float map(vec3 p) {
  p = uRot * p;
  // slow organic wobble (small, keeps the field Lipschitz close to 1)
  p += 0.025 * sin(p.yzx * 3.1 + vec3(uWobble, uWobble * 1.3, uWobble * 0.7));
  float sph = length(p) - RAD;
  vec3 f = icoFold(p);
  float sp = min(spikeD(f, DIR_V, RAD + uSpike.x),
             min(spikeD(f, DIR_F, RAD + uSpike.y), spikeD(f, DIR_E, RAD + uSpike.z)));
  return smin(sph, sp, 0.09);
}

vec3 calcNormal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.0015;
  return normalize(
    k.xyy * map(p + k.xyy * h) +
    k.yyx * map(p + k.yyx * h) +
    k.yxy * map(p + k.yxy * h) +
    k.xxx * map(p + k.xxx * h));
}

// studio environment: overhead softbox (primary), side strip (accent), faint floor bounce
vec3 env(vec3 r, vec3 P, vec3 A, float boost) {
  vec3 c = mix(vec3(0.004), P * 0.03, 0.5 + 0.5 * r.y);
  c += P * smoothstep(0.55, 0.85, r.y) * 2.2 * boost;
  c += A * smoothstep(0.80, 0.95, dot(r, normalize(vec3(-0.85, 0.15, 0.5)))) * 2.6 * boost;
  c += mix(P, A, 0.5) * smoothstep(0.86, 0.97, dot(r, normalize(vec3(0.9, -0.1, 0.4)))) * 1.4 * boost;
  return c;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  vec3 ro = vec3(0.0, 0.0, 4.6);
  vec3 rd = normalize(vec3(uv, -FOCAL));

  vec3 P = uPrimary * uPrimary;
  vec3 A = uAccent * uAccent;

  // backdrop: dark gradient and an accent underglow behind the blob that blooms on kicks
  float r = length(uv);
  vec3 col = mix(P * 0.025, vec3(0.003, 0.003, 0.006), smoothstep(0.0, 0.9, r));
  col += mix(A, P, 0.4) * exp(-max(r - 0.2, 0.0) * 5.0) * (0.04 + 0.12 * uBass + 0.5 * uBeat);

  float b = dot(ro, rd);
  float disc = b * b - (dot(ro, ro) - BOUND * BOUND);
  if (disc > 0.0) {
    float sq = sqrt(disc);
    float t = -b - sq;
    float tFar = -b + sq;
    bool hit = false;
    for (int i = 0; i < 72; i++) {
      float d = map(ro + rd * t);
      if (d < 0.0008 * t) { hit = true; break; }
      t += d * 0.85;
      if (t > tFar) break;
    }

    if (hit) {
      vec3 pos = ro + rd * t;
      vec3 n = calcNormal(pos);
      vec3 v = -rd;
      float ndv = clamp(dot(n, v), 0.0, 1.0);
      vec3 R = reflect(rd, n);
      float fre = 0.12 + 0.88 * pow(1.0 - ndv, 4.0);
      float boost = 1.0 + 0.25 * uBass + 1.2 * uBeat;

      // near-black glossy body: almost everything we see is reflection
      col = vec3(0.006, 0.006, 0.008) * (0.5 + 0.5 * n.y);
      col += env(R, P, A, boost) * fre;
      // sharp key highlights on spike flanks and tips; treble adds sparkle
      vec3 L = normalize(vec3(0.5, 0.8, 0.6));
      float spe = pow(clamp(dot(R, L), 0.0, 1.0), 90.0);
      col += vec3(1.0, 0.97, 0.94) * spe * (0.9 + 1.2 * uTreble) * boost;
      // thin accent rim so the silhouette always reads against the dark backdrop
      col += A * pow(1.0 - ndv, 6.0) * (0.25 + 0.8 * uBeat);
    }
  }

  col = col / (1.0 + col * 0.6);
  col = pow(col, vec3(0.4545));
  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uRot', 'uSpike', 'uWobble', 'uBass', 'uTreble', 'uBeat', 'uPrimary', 'uAccent',
] as const;

/** Column-major mat3: yaw around Y, then a fixed tilt around X. */
function yawTilt(out: Float32Array, yaw: number, tilt: number): Float32Array {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  // M = Rx(tilt) * Ry(yaw)
  out[0] = cy;       out[1] = st * sy;  out[2] = -ct * sy;
  out[3] = 0;        out[4] = ct;       out[5] = st;
  out[6] = sy;       out[7] = -st * cy; out[8] = ct * cy;
  return out;
}

export function createFerrofluidSpikes(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  const rot = new Float32Array(9);
  let yaw = 0; // blob rotation (rate rides level + beat; only ever increases)

  return {
    id: 'ferrofluid-spikes',
    name: 'Ferrofluid Spikes',
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
      yaw += (0.1 + a.level * 0.12 + a.beat * 0.35) * frame.dt;
      yawTilt(rot, yaw, 0.45 + 0.2 * Math.sin(frame.time * 0.07));

      // spike heights: small breathing bumps at rest, bass raises, kicks jolt. Bounded to 0.58.
      const idle = 0.05 + 0.025 * Math.sin(frame.time * 0.8);
      const drive = a.bass * 0.38 + a.beat * 0.16;
      const hv = Math.min(idle + drive, 0.58);
      const hf = Math.min(idle * 0.9 + drive * 0.85 + a.mid * 0.03, 0.52);
      const he = Math.min(idle * 0.8 + drive * 0.62 + a.treble * 0.04, 0.45);

      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniformMatrix3fv(u.uRot, false, rot);
      gl.uniform3f(u.uSpike, hv, hf, he);
      gl.uniform1f(u.uWobble, (frame.time * 0.6) % (Math.PI * 2000));
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
