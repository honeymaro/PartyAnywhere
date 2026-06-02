import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float sceneDe(vec3 p, float bass, float mid, float beat) {
  float scale = 1.0 + beat * 0.18;
  p /= scale;
  float k = 0.35 + bass * 0.55;
  float r0 = 0.52 + bass * 0.22;
  float r1 = 0.42 + bass * 0.15;
  float t = uTime * 0.55;
  float m = mid * 1.4;
  vec3 c0 = vec3(sin(t) * (1.1 + m), cos(t * 0.7) * 0.6, cos(t * 0.9) * 0.5);
  vec3 c1 = vec3(cos(t * 1.3 + 1.0) * 0.9, sin(t * 1.1) * (1.0 + m * 0.5), sin(t * 0.8) * 0.7);
  vec3 c2 = vec3(sin(t * 0.6 + 2.0) * 0.7, cos(t * 1.4 + 0.5) * 0.9, cos(t) * (1.0 + m));
  vec3 c3 = vec3(cos(t * 1.2 + 3.0) * 1.0, sin(t * 0.5 + 1.5) * 0.8, sin(t * 1.3) * 0.6);
  vec3 c4 = vec3(sin(t * 0.9 + 4.0) * 0.8, cos(t * 1.6 + 2.0) * 0.7, cos(t * 0.7 + 1.0) * (0.9 + m * 0.4));
  float d = length(p - c0) - r0;
  d = smin(d, length(p - c1) - r1, k);
  d = smin(d, length(p - c2) - r1, k);
  d = smin(d, length(p - c3) - (0.38 + bass * 0.12), k);
  d = smin(d, length(p - c4) - (0.44 + bass * 0.10), k);
  return d * scale;
}

vec3 calcNormal(vec3 p, float bass, float mid, float beat) {
  float e = 0.001;
  return normalize(vec3(
    sceneDe(p + vec3(e, 0.0, 0.0), bass, mid, beat) - sceneDe(p - vec3(e, 0.0, 0.0), bass, mid, beat),
    sceneDe(p + vec3(0.0, e, 0.0), bass, mid, beat) - sceneDe(p - vec3(0.0, e, 0.0), bass, mid, beat),
    sceneDe(p + vec3(0.0, 0.0, e), bass, mid, beat) - sceneDe(p - vec3(0.0, 0.0, e), bass, mid, beat)
  ));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  vec3 ro = vec3(0.0, 0.0, 4.5);
  vec3 rd = normalize(vec3(uv, -1.6));

  float t = 0.0;
  float hit = 0.0;
  for (int i = 0; i < 72; i++) {
    vec3 p = ro + rd * t;
    float d = sceneDe(p, uBass, uMid, uBeat);
    if (d < 0.001) { hit = 1.0; break; }
    if (t > 12.0) break;
    t += d * 0.85;
  }

  vec3 col = vec3(0.04, 0.04, 0.06);

  if (hit > 0.5) {
    vec3 p = ro + rd * t;
    vec3 N = calcNormal(p, uBass, uMid, uBeat);
    vec3 V = -rd;

    vec3 R = reflect(rd, N);
    float envT = R.y * 0.5 + 0.5;
    vec3 envCol = mix(uPrimary, uAccent, envT);

    float glintFreq = 8.0 + uTreble * 18.0;
    float glint = pow(max(0.0, sin(R.x * glintFreq) * sin(R.z * glintFreq + uTime)), 6.0);
    envCol += uAccent * glint * (0.4 + uTreble * 1.2);

    vec3 keyLight = normalize(vec3(1.5, 2.0, 2.5));
    float diff = max(0.0, dot(N, keyLight));
    float spec = pow(max(0.0, dot(R, keyLight)), 48.0 + uTreble * 80.0);

    float fresnel = pow(1.0 - max(0.0, dot(N, V)), 3.5);

    col = envCol * (0.55 + 0.35 * diff);
    col += vec3(1.0) * spec * (0.6 + uTreble * 0.6);
    col += uAccent * fresnel * (0.5 + uBass * 0.3);
    col = mix(col, uPrimary * 0.12 + col, 0.5);
  }

  col = pow(clamp(col, 0.0, 1.0), vec3(0.4545));
  fragColor = vec4(col, 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uBass', 'uMid', 'uTreble', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createSdfMetaballChrome(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

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
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uTime, frame.time);
      gl.uniform1f(u.uBass, frame.audio.bass);
      gl.uniform1f(u.uMid, frame.audio.mid);
      gl.uniform1f(u.uTreble, frame.audio.treble);
      gl.uniform1f(u.uBeat, frame.audio.beat);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
    },
  };
}
