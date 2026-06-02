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

const float TWO_PI = 6.28318530718;

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.3);
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
  float freq = 1.0;
  for (int i = 0; i < 5; i++) {
    v += amp * noise(p * freq);
    freq *= 2.1;
    amp *= 0.48;
  }
  return v;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  float t = uTime * 0.12;
  float beatKick = uBeat * exp(-uBeat * 3.0) * 1.8;

  // Double domain warp
  vec2 q = vec2(fbm(uv + t), fbm(uv + vec2(1.7, 9.2) + t * 0.8));

  float midStrength = 1.0 + uMid * 2.5 + beatKick;
  vec2 r = vec2(
    fbm(uv + 4.0 * q + vec2(1.3, 5.7) + uTime * 0.1),
    fbm(uv + 4.0 * q + vec2(8.3, 2.8) + uTime * 0.07)
  );

  float trebleMix = uTreble * 0.6;
  vec2 warpedP = uv + midStrength * 4.0 * r;
  float f = fbm(warpedP + trebleMix * vec2(fbm(uv * 3.1), fbm(uv * 3.1 + 5.4)));

  // Thin-film iridescent palette: thickness proxy from f, hue shift from bass
  float thickness = f + uBass * 0.4;
  vec3 iridescent = 0.5 + 0.5 * cos(TWO_PI * (thickness + vec3(0.0, 0.33, 0.67)));

  // Tint iridescent toward palette colors based on angle (r.x as proxy)
  float tintBlend = smoothstep(0.2, 0.8, r.x);
  vec3 tint = mix(uPrimary, uAccent, tintBlend);
  vec3 col = mix(iridescent, tint, 0.35);

  // Dark substrate: low-f regions go nearly black, oil slick darkens at base
  float darkness = smoothstep(0.0, 0.55, f);
  col *= darkness * (0.7 + 0.3 * f);

  // Subtle specular sheen from treble
  float sheen = pow(max(0.0, fbm(uv * 6.0 + uTime * 0.3) - 0.45), 2.0) * uTreble * 0.5;
  col += sheen * (iridescent * 0.5 + 0.5);

  fragColor = vec4(col, 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uBass', 'uMid', 'uTreble', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createOilSlickWarp(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'oil-slick-warp',
    name: 'Oil Slick Domain Warp',
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
