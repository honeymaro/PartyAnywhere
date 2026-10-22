import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Sierpinski-octahedron KIFS: octahedral fold (abs + sort), a small per-level rotation and a
// scale-2 contraction toward a vertex offset. Every rotation is a CPU-built mat3 uniform, so the
// fold loop has no trig. Shape parameters morph on slow time-only cycles (scale is fixed, so the
// DE and the framing stay valid); audio drives the spin RATE, the glow bloom and a small pulse.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform mat3 uObjRot;   // whole-object rotation (CPU, audio-rate accumulated)
uniform mat3 uFoldRot;  // per-level fold rotation (CPU, slow time-only morph)
uniform vec3 uOffset;   // contraction target (slow time-only morph)
uniform float uPulse;   // kick size pulse (1.0 .. 1.05)
uniform float uPixel;   // ray-cone footprint per unit distance
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

const int ITER = 7;
const float SCALE = 2.0;
const float FOCAL = 1.8;
const float BOUND = 1.25;

float map(vec3 p, out float trap) {
  p = uObjRot * p / uPulse;
  trap = 1e9;
  float s = 1.0;
  for (int i = 0; i < ITER; i++) {
    p = abs(p);
    if (p.x < p.y) p.xy = p.yx;
    if (p.x < p.z) p.xz = p.zx;
    if (p.y < p.z) p.yz = p.zy;
    p = uFoldRot * p;
    p = p * SCALE - uOffset * (SCALE - 1.0);
    s *= SCALE;
    trap = min(trap, dot(p, p));
  }
  // octahedron primitive at the finest level
  vec3 q = abs(p);
  return (q.x + q.y + q.z - 1.0) * 0.57735 / s * uPulse;
}

vec3 calcNormal(vec3 p, float h) {
  const vec2 k = vec2(1.0, -1.0);
  float tr;
  return normalize(
    k.xyy * map(p + k.xyy * h, tr) +
    k.yyx * map(p + k.yyx * h, tr) +
    k.yxy * map(p + k.yxy * h, tr) +
    k.xxx * map(p + k.xxx * h, tr));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  vec3 ro = vec3(0.0, 0.0, 4.3);
  vec3 rd = normalize(vec3(uv, -FOCAL));

  vec3 P = uPrimary * uPrimary;
  vec3 A = uAccent * uAccent;

  // backdrop: dark vignette with a soft palette core glow
  float r2 = dot(uv, uv);
  vec3 col = mix(P * 0.05, vec3(0.004, 0.004, 0.01), smoothstep(0.0, 0.6, r2));
  // bloom behind the crystal that flares on kicks
  col += mix(A, P, 0.4) * exp(-r2 * 7.0) * (0.03 + 0.08 * uBass + 0.45 * uBeat);

  float glow = 0.0;
  float b = dot(ro, rd);
  float rb = BOUND * uPulse;
  float disc = b * b - (dot(ro, ro) - rb * rb);
  if (disc > 0.0) {
    float sq = sqrt(disc);
    float t = max(-b - sq, 0.0);
    float tFar = -b + sq;
    float trap = 1e9;
    bool hit = false;
    for (int i = 0; i < 90; i++) {
      float d = map(ro + rd * t, trap);
      // near misses accumulate into a tight bloom along crystal edges and through the holes
      glow += exp(-d * 90.0);
      if (d < uPixel * t) { hit = true; break; }
      t += d * 0.9;
      if (t > tFar) break;
    }
    glow *= hit ? 0.004 : 0.03;

    if (hit) {
      vec3 pos = ro + rd * t;
      vec3 n = calcNormal(pos, uPixel * t * 0.5);
      // cheap 2-tap occlusion along the normal
      float tt;
      float occ = clamp(1.0 - 7.0 * ((0.03 - map(pos + n * 0.03, tt)) + 0.5 * (0.08 - map(pos + n * 0.08, tt))), 0.0, 1.0);

      // facet tint from the object-space normal: each crystal plane gets its own palette blend
      vec3 no = uObjRot * n;
      float facet = smoothstep(-0.6, 0.6, sin(dot(no, vec3(2.1, 1.3, 2.7)) * 1.7 + sqrt(trap) * 0.3));
      vec3 tint = mix(P, A, facet);

      vec3 L = normalize(vec3(0.6, 0.8, 0.6));
      vec3 R = reflect(rd, n);
      float dif = clamp(dot(n, L), 0.0, 1.0);
      float fre = pow(clamp(1.0 + dot(rd, n), 0.0, 1.0), 3.0);
      float spe = pow(clamp(dot(R, L), 0.0, 1.0), 48.0);

      // dark glassy body, sharp key highlights, palette sky reflection
      col = tint * (0.02 + 0.8 * dif) * (0.25 + 0.75 * occ);
      col += mix(P, A, 0.2) * smoothstep(0.1, 0.9, R.y) * 0.35 * occ;
      col += vec3(1.0, 0.97, 0.92) * spe * (0.8 + 1.2 * uTreble) * occ;
      col += mix(A, P, facet) * fre * (0.3 + 1.4 * uBeat) * occ;
      // light leaking out of the crevices: the crystal glows from within, flaring on kicks
      col += mix(A, P, facet) * (1.0 - occ) * (0.03 + 0.3 * uBass + 2.6 * uBeat);
      col *= exp(-max(t - 3.3, 0.0) * 0.35);
    }
  }

  // edge bloom (brighter on bass and kicks)
  col += mix(A, P, 0.35) * glow * (1.0 + 1.0 * uBass + 6.0 * uBeat);

  col = col / (1.0 + col * 0.5);
  col = pow(col, vec3(0.4545));
  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uObjRot', 'uFoldRot', 'uOffset', 'uPulse', 'uPixel',
  'uBass', 'uTreble', 'uBeat', 'uPrimary', 'uAccent',
] as const;

const FOCAL = 1.8;

/** Column-major mat3 for rotation by `angle` around the unit axis (x, y, z). */
function axisAngle(out: Float32Array, x: number, y: number, z: number, angle: number): Float32Array {
  const l = Math.hypot(x, y, z) || 1;
  x /= l; y /= l; z /= l;
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  out[0] = t * x * x + c;     out[1] = t * x * y + s * z; out[2] = t * x * z - s * y;
  out[3] = t * x * y - s * z; out[4] = t * y * y + c;     out[5] = t * y * z + s * x;
  out[6] = t * x * z + s * y; out[7] = t * y * z - s * x; out[8] = t * z * z + c;
  return out;
}

export function createKifsOctahedron(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  const objRot = new Float32Array(9);
  const foldRot = new Float32Array(9);
  let spin = 0; // object rotation phase (rate rides level + beat; only ever increases)

  return {
    id: 'kifs-octahedron',
    name: 'KIFS Octahedron Bloom',
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
      const t = frame.time;
      spin += (0.12 + a.level * 0.1 + a.beat * 0.45) * frame.dt;

      // tumbling axis drifts slowly so every side of the crystal comes around
      axisAngle(objRot, Math.sin(t * 0.05), 1.0, 0.35 * Math.cos(t * 0.04), spin);
      // small per-level twist: slow time-only morph of the fractal
      axisAngle(foldRot, 1.0, 0.6 + 0.4 * Math.sin(t * 0.031), 0.3, 0.07 + 0.07 * Math.sin(t * 0.047));

      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniformMatrix3fv(u.uObjRot, false, objRot);
      gl.uniformMatrix3fv(u.uFoldRot, false, foldRot);
      gl.uniform3f(u.uOffset, 1.0, 0.04 + 0.04 * Math.sin(t * 0.037), 0.03 * Math.sin(t * 0.029 + 1.0));
      gl.uniform1f(u.uPulse, 1.0 + 0.045 * a.beat);
      gl.uniform1f(u.uPixel, 1.2 / (Math.min(frame.resolution[0], frame.resolution[1]) * FOCAL));
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
