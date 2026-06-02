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
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * noise(p);
    p = p * 2.1 + vec2(1.7, 9.3);
    amp *= 0.5;
  }
  return v;
}

vec2 curlDir(vec2 p) {
  float eps = 0.01;
  float n0 = fbm(p);
  float nx = fbm(p + vec2(eps, 0.0));
  float ny = fbm(p + vec2(0.0, eps));
  float dxn = (nx - n0) / eps;
  float dyn = (ny - n0) / eps;
  return vec2(dyn, -dxn);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  float speed = 0.18 + uLevel * 0.35;
  float turbulence = 1.0 + uMid * 3.5;
  float swirl = 1.0 + uBeat * 2.5;

  vec2 p = uv * 2.5 + vec2(uTime * 0.05, uTime * 0.03);

  // Advect backward along curl field via 8-step streamline integration
  vec2 traced = p;
  float stepSize = 0.065 * speed * swirl;
  for (int i = 0; i < 8; i++) {
    vec2 curl = curlDir(traced + uTime * 0.04) * turbulence;
    traced -= curl * stepSize;
  }

  // Sample dye source: sin lattice at traced position
  float lat = sin(traced.x * 6.2831) * sin(traced.y * 6.2831);
  lat = lat * 0.5 + 0.5;
  float dye = lat;

  // Add a second layer at different scale for complexity
  vec2 p2 = uv * 4.8 + vec2(-uTime * 0.07, uTime * 0.02);
  vec2 traced2 = p2;
  for (int i = 0; i < 6; i++) {
    vec2 curl = curlDir(traced2 + uTime * 0.06 + vec2(5.3, 2.7)) * turbulence * 0.7;
    traced2 -= curl * stepSize * 0.8;
  }
  float lat2 = sin(traced2.x * 6.2831 + 1.2) * sin(traced2.y * 6.2831 + 0.8);
  lat2 = lat2 * 0.5 + 0.5;
  dye = max(dye, lat2 * 0.75);

  // Boost dye brightness via bass injection
  dye = clamp(dye + uBass * 0.4, 0.0, 1.0);

  // Color: mix primary to accent by dye density, additive glow for inky smoke
  vec3 col = mix(uPrimary, uAccent, smoothstep(0.2, 0.85, dye));

  // Additive glow layer for high-density regions
  float glow = pow(dye, 2.5) * (1.0 + uBass * 1.5);
  col += uAccent * glow * 0.6;

  // Tonemap: inky accumulation (darks stay dark, brights bloom)
  col = col / (col + vec3(0.9));
  col = pow(col, vec3(0.75));

  fragColor = vec4(col, 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uLevel', 'uBass', 'uMid', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createCurlFlowInk(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'curl-flow-ink',
    name: 'Curl Noise Ink Flow',
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
