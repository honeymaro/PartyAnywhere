import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uLevel;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform vec3 uPrimary;
uniform vec3 uAccent;

float causticLayer(vec2 uv, float speed, float freq) {
  vec2 p = uv;
  float acc = 0.0;
  for (int i = 0; i < 5; i++) {
    p += sin(p.yx * freq + uTime * speed) * 0.4;
    freq *= 1.4;
    speed *= 0.9;
  }
  float d = length(sin(p * 1.5));
  return 1.0 / (d * 6.0 + 0.3);
}

void main() {
  vec2 uv = (gl_FragCoord.xy / uResolution) * 2.0 - 1.0;
  uv.x *= uResolution.x / uResolution.y;

  float scale = 1.2 + uLevel * 0.6;
  uv *= scale;

  float baseSpeed = 0.35 + uMid * 1.2;
  float trebleFreq = 1.8 + uTreble * 2.5;

  float c1 = causticLayer(uv, baseSpeed, trebleFreq);
  float c2 = causticLayer(uv * 1.3 + vec2(0.7, 0.3), baseSpeed * 0.7, trebleFreq * 0.8);
  float c3 = causticLayer(uv * 0.8 - vec2(0.4, 0.6), baseSpeed * 1.3, trebleFreq * 1.2);

  float caustic = (c1 * 0.5 + c2 * 0.35 + c3 * 0.15);
  caustic = pow(clamp(caustic, 0.0, 1.0), 2.2);

  float shafts = caustic * (0.4 + uBass * 1.8);

  float shimmer = sin(uv.x * 18.0 + uTime * 3.0) * sin(uv.y * 14.0 - uTime * 2.5);
  shimmer = clamp(shimmer * uTreble * 0.25, 0.0, 0.3);

  float depth = 1.0 - clamp((gl_FragCoord.y / uResolution.y) * 1.2, 0.0, 1.0);
  float depthGrad = depth * depth;

  vec3 water = uPrimary * (0.08 + depthGrad * 0.25);
  vec3 light = uAccent * shafts;
  light += uAccent * shimmer;

  vec3 col = water + light;
  col = clamp(col, 0.0, 1.0);

  fragColor = vec4(col, 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uLevel', 'uBass', 'uMid', 'uTreble', 'uPrimary', 'uAccent'] as const;

export function createCausticsPool(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'caustics-pool',
    name: 'Refractive Caustics Pool',
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
      gl.uniform1f(u.uLevel, frame.audio.level);
      gl.uniform1f(u.uBass, frame.audio.bass);
      gl.uniform1f(u.uMid, frame.audio.mid);
      gl.uniform1f(u.uTreble, frame.audio.treble);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
    },
  };
}
