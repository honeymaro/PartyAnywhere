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
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.1 + vec2(1.7, 3.3);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;

  // Rise speed driven by uLevel, always moving
  float riseSpeed = 0.3 + uLevel * 0.5;
  float t = uTime * riseSpeed;

  // Source mask: narrow vertical plume, widens at base, narrows toward top
  float cx = 0.5;
  float spread = 0.08 + uBass * 0.08 + (1.0 - uv.y) * 0.12;
  float sourceMask = exp(-pow((uv.x - cx) / spread, 2.0));

  // Curl warp driven by uMid for swirling turbulence
  float curlX = fbm(vec2(uv.x * 2.0, uv.y * 2.0 - t * 0.5)) - 0.5;
  float curlY = fbm(vec2(uv.x * 2.0 + 5.3, uv.y * 2.0 - t * 0.5)) - 0.5;
  float curlStrength = 0.3 + uMid * 0.6;
  vec2 warpedUv = vec2(
    uv.x * 3.0 + curlX * curlStrength,
    uv.y * 2.0 - t + curlY * curlStrength * 0.4
  );

  // Base density via domain-warped fbm
  float density = fbm(warpedUv);

  // uBass increases base injection density
  density += uBass * 0.3 * sourceMask;

  // uBeat injects a puff burst — extra density pulse near base
  float beatPuff = uBeat * 0.5 * exp(-uv.y * 6.0) * sourceMask;
  density += beatPuff;

  // Shape density by source mask and fade toward top
  density *= sourceMask;
  density *= smoothstep(1.0, 0.0, uv.y * 0.9);

  // uTreble adds thin high-frequency wisps on top
  float wisps = fbm(vec2(uv.x * 8.0 + curlX * 0.5, uv.y * 6.0 - t * 1.4));
  density += uTreble * 0.15 * wisps * sourceMask * smoothstep(0.7, 0.3, uv.y);

  density = clamp(density, 0.0, 1.0);

  // Vertical glow: brighter and warmer near the base heat source
  float vertGlow = exp(-uv.y * 3.5);

  // Color: blend uPrimary (cool smoke) with uAccent (hot base glow)
  float colorMix = clamp(density * 1.2 + vertGlow * 0.6, 0.0, 1.0);
  vec3 col = mix(uPrimary, uAccent, colorMix);

  // Soft additive brightness, denser smoke = more visible
  col *= density * 1.8;

  // Slight emission boost at the base
  col += uAccent * vertGlow * 0.25 * sourceMask;

  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uLevel', 'uBass', 'uMid', 'uTreble', 'uBeat',
  'uPrimary', 'uAccent',
] as const;

export function createSmokePlumeRise(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'smoke-plume-rise',
    name: 'Rising Smoke Plume',
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
