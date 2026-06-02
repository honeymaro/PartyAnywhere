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

vec3 cospalette(float t, vec3 a, vec3 b) {
  return a + b * cos(6.28318 * t);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  // Zoom modulated by treble
  float zoom = 2.2 - uTreble * 0.4;
  vec2 z = uv * zoom;

  // c animates on a complex-plane circle; bass widens radius, mid offsets, beat jumps angle
  float radius = 0.7 + uBass * 0.2;
  float angle  = uTime * 0.3 + uBeat * 1.5;
  float angle2 = uTime * 0.21;
  vec2 c = vec2(cos(angle), sin(angle2)) * radius + uMid * 0.1;

  // Escape-time iteration
  const int MAX_ITER = 96;
  int i = 0;
  for (int k = 0; k < MAX_ITER; k++) {
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    if (dot(z, z) > 16.0) { i = k; break; }
    i = k + 1;
  }

  vec3 col;
  if (i == MAX_ITER) {
    // Interior: near-black with faint primary tint
    col = uPrimary * 0.04;
  } else {
    // Smooth iteration count
    float len = length(z);
    float smooth_i = float(i) + 1.0 - log2(log2(max(len, 1.0001)));
    float t = smooth_i * 0.05;

    // Cosine palette blending primary -> accent
    vec3 a = (uPrimary + uAccent) * 0.5;
    vec3 b = (uAccent - uPrimary) * 0.5;
    col = cospalette(t, a, b);

    // Treble glow: brighten pixels near the boundary (low iteration count)
    float boundary = exp(-smooth_i * 0.08);
    col += uTreble * boundary * uAccent * 0.6;
  }

  fragColor = vec4(col, 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uBass', 'uMid', 'uTreble', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createJuliaMorph(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'julia-morph',
    name: 'Julia Morph Travel',
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
