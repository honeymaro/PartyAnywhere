import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uLevel;
uniform float uMid;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.1 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;

  vec3 color = vec3(0.0);

  float curtainHeight = 0.4 + uMid * 0.5;
  float curtainDensity = 1.0 + uMid * 2.0;

  for (int layer = 0; layer < 6; layer++) {
    float fi = float(layer);
    float xOff = fi * 0.31 + sin(uTime * 0.07 + fi * 1.2) * 0.18;
    float timeOff = fi * 0.47;

    float cx = uv.x * 3.0 + xOff + sin(uTime * 0.2 + fi * 0.8) * 0.3;
    float cy = uTime * 0.1 + timeOff;
    float density = fbm(vec2(cx, cy)) * curtainDensity;

    float curtainWidth = 0.08 + uBeat * 0.06;
    float stripX = fract(uv.x * 4.0 + xOff * 0.5 + sin(uTime * 0.15 + fi) * 0.1);
    float stripMask = smoothstep(curtainWidth, 0.0, abs(stripX - 0.5));

    float topFade = smoothstep(curtainHeight, curtainHeight * 0.5, uv.y);
    float bottomFade = smoothstep(0.0, 0.15, uv.y);
    float curtainMask = topFade * bottomFade * density * stripMask;

    float colorMix = fbm(vec2(cx * 0.7, cy * 0.5 + fi * 0.2));
    float heightTint = uv.y / max(curtainHeight, 0.01);

    vec3 baseColor = mix(uPrimary, uAccent, colorMix);
    vec3 tinted = mix(baseColor, uAccent * 1.2, clamp(heightTint * 0.6, 0.0, 1.0));

    float shimmer = 1.0 + uTreble * noise(vec2(uv.x * 20.0 + uTime * 3.0, fi * 5.0)) * 2.5;
    color += tinted * curtainMask * shimmer * (0.5 + fi * 0.1);
  }

  float sparkle = uTreble * noise(vec2(uv.x * 40.0 + uTime * 5.0, uv.y * 40.0)) * 0.3;
  color += vec3(sparkle);

  color *= 0.8 + uLevel * 0.6;

  color = 1.0 - exp(-color);

  fragColor = vec4(color, 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uLevel', 'uMid', 'uTreble', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createAuroraCurtains(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'aurora-curtains',
    name: 'Aurora Curtains',
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
