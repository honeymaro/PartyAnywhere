import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Five smooth-unioned chrome metaballs reflecting a palette-tinted studio environment. Ball paths
// are bounded Lissajous orbits driven by a CPU-accumulated phase (audio changes the RATE only), so
// they never swing off-screen. Bass swells the radii and the blend, a kick adds a quick size jump
// plus a light flash; treble sharpens the highlights.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

uniform vec3 uC0;       // ball centers (CPU, bounded orbits)
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uC4;
uniform vec4 uRadA;     // radii of balls 0..3
uniform vec2 uRadB;     // radius of ball 4, blend k

const float BOUND = 2.6;

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float map(vec3 p) {
  float k = uRadB.y;
  float d = length(p - uC0) - uRadA.x;
  d = smin(d, length(p - uC1) - uRadA.y, k);
  d = smin(d, length(p - uC2) - uRadA.z, k);
  d = smin(d, length(p - uC3) - uRadA.w, k);
  d = smin(d, length(p - uC4) - uRadB.x, k);
  return d;
}

vec3 calcNormal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.001;
  return normalize(
    k.xyy * map(p + k.xyy * h) +
    k.yyx * map(p + k.yyx * h) +
    k.yxy * map(p + k.yxy * h) +
    k.xxx * map(p + k.xxx * h));
}

// studio environment: dark floor, bright horizon band, palette sky, two softbox strips
vec3 env(vec3 r, vec3 P, vec3 A, float flash) {
  float y = r.y;
  vec3 sky = mix(A * 0.55, P * 1.1, smoothstep(0.0, 0.7, y));
  vec3 floorC = mix(mix(P, A, 0.3) * 0.22, vec3(0.03), smoothstep(-0.02, -0.7, y));
  vec3 c = mix(floorC, sky, smoothstep(-0.03, 0.03, y));
  c += mix(P, A, 0.5) * exp(-abs(y) * 14.0) * 0.9;
  c += vec3(1.0) * smoothstep(0.93, 0.985, dot(r, normalize(vec3(-0.7, 0.55, 0.45)))) * 2.0;
  c += A * smoothstep(0.90, 0.98, dot(r, normalize(vec3(0.8, 0.2, 0.55)))) * 1.6;
  return c * flash;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  vec3 ro = vec3(0.0, 0.0, 5.0);
  vec3 rd = normalize(vec3(uv, -1.6));

  vec3 P = uPrimary * uPrimary;
  vec3 A = uAccent * uAccent;
  float flash = 1.0 + 0.2 * uBass + 0.9 * uBeat;

  // backdrop: deep vignette, soft palette spotlight behind the sculpture, faint floor glow
  float r = length(uv * vec2(0.8, 1.0));
  vec3 col = mix(P * 0.10, vec3(0.006, 0.006, 0.012), smoothstep(0.05, 0.85, r));
  col += A * 0.05 * smoothstep(-0.1, -0.5, uv.y);
  col *= 0.9 + 0.5 * uBeat;

  float b = dot(ro, rd);
  float disc = b * b - (dot(ro, ro) - BOUND * BOUND);
  if (disc > 0.0) {
    float sq = sqrt(disc);
    float t = -b - sq;
    float tFar = -b + sq;
    bool hit = false;
    for (int i = 0; i < 56; i++) {
      float d = map(ro + rd * t);
      if (d < 0.0006 * t) { hit = true; break; }
      t += d;
      if (t > tFar) break;
    }

    if (hit) {
      vec3 p = ro + rd * t;
      vec3 N = calcNormal(p);
      vec3 V = -rd;
      vec3 R = reflect(rd, N);
      float ndv = clamp(dot(N, V), 0.0, 1.0);
      float fre = 0.55 + 0.45 * pow(1.0 - ndv, 4.0);

      col = env(R, P, A, flash) * fre;
      vec3 L = normalize(vec3(1.5, 2.0, 2.5));
      float spec = pow(max(0.0, dot(R, L)), 60.0 + uTreble * 120.0);
      col += vec3(1.0, 0.98, 0.95) * spec * (1.0 + uTreble * 1.2) * flash;
      // accent rim lifts the silhouette off the backdrop
      col += A * pow(1.0 - ndv, 5.0) * (0.3 + 0.5 * uBass + 0.8 * uBeat);
    }
  }

  col = col / (1.0 + col * 0.45);
  col = pow(col, vec3(0.4545));
  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uBass', 'uTreble', 'uBeat', 'uPrimary', 'uAccent',
  'uC0', 'uC1', 'uC2', 'uC3', 'uC4', 'uRadA', 'uRadB',
] as const;

export function createSdfMetaballChrome(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let phase = 0; // orbit phase (rate rides level + beat; only ever increases)

  return {
    id: 'sdf-metaball-chrome',
    name: 'Chrome Metaball Sculpture',
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
      phase += (0.3 + a.level * 0.25 + a.beat * 0.8) * frame.dt;
      const t = phase;
      const S = Math.sin, C = Math.cos;

      // bounded orbits (|x| <= 1.15, |y| <= 0.75): the sculpture always stays in frame
      gl.uniform3f(u.uC0, S(t) * 1.1, C(t * 0.7) * 0.55, C(t * 0.9) * 0.5);
      gl.uniform3f(u.uC1, C(t * 1.3 + 1.0) * 0.9, S(t * 1.1) * 0.7, S(t * 0.8) * 0.6);
      gl.uniform3f(u.uC2, S(t * 0.6 + 2.0) * 0.75, C(t * 1.4 + 0.5) * 0.65, C(t) * 0.7);
      gl.uniform3f(u.uC3, C(t * 1.2 + 3.0) * 1.0, S(t * 0.5 + 1.5) * 0.6, S(t * 1.3) * 0.6);
      gl.uniform3f(u.uC4, S(t * 0.9 + 4.0) * 0.8, C(t * 1.6 + 2.0) * 0.5, C(t * 0.7 + 1.0) * 0.7);

      // radii: bass swells, kick jumps (the max combined growth stays around +0.17)
      const grow = a.bass * 0.09 + a.beat * 0.08;
      gl.uniform4f(u.uRadA, 0.5 + grow, 0.4 + grow * 0.9, 0.4 + grow * 0.9, 0.36 + grow * 0.8);
      gl.uniform2f(u.uRadB, 0.42 + grow * 0.8, 0.38 + a.bass * 0.2);

      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
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
