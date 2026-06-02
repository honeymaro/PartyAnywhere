import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uLevel;
uniform float uBass;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.31);
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

vec3 cosPalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.28318 * (c * t + d));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  float flowSpeed = 0.18 + uLevel * 0.4;
  float beatSwell = uBeat * exp(-uBeat * 3.0) * 2.5;
  float warpAmp = 0.55 + uBass * 1.2 + beatSwell;

  // Domain warp: two layers of fbm used to distort uvs
  float t = uTime * flowSpeed;
  vec2 q = vec2(fbm(uv + vec2(0.0, t)), fbm(uv + vec2(1.7, 9.2) + t * 0.8));
  vec2 r = vec2(fbm(uv + warpAmp * q + vec2(1.7, 9.2) + t * 0.6),
                fbm(uv + warpAmp * q + vec2(8.3, 2.8) - t * 0.5));
  float h = fbm(uv + warpAmp * r);

  // Finite-difference surface normal from heightfield
  float eps = 0.004;
  vec2 uvR = uv + vec2(eps, 0.0);
  vec2 uvU = uv + vec2(0.0, eps);
  vec2 qR = vec2(fbm(uvR + vec2(0.0, t)), fbm(uvR + vec2(1.7, 9.2) + t * 0.8));
  vec2 rR = vec2(fbm(uvR + warpAmp * qR + vec2(1.7, 9.2) + t * 0.6),
                 fbm(uvR + warpAmp * qR + vec2(8.3, 2.8) - t * 0.5));
  float hR = fbm(uvR + warpAmp * rR);

  vec2 qU = vec2(fbm(uvU + vec2(0.0, t)), fbm(uvU + vec2(1.7, 9.2) + t * 0.8));
  vec2 rU = vec2(fbm(uvU + warpAmp * qU + vec2(1.7, 9.2) + t * 0.6),
                 fbm(uvU + warpAmp * qU + vec2(8.3, 2.8) - t * 0.5));
  float hU = fbm(uvU + warpAmp * rU);

  vec3 N = normalize(vec3((hR - h) / eps, (hU - h) / eps, 0.12));

  // View vector (orthographic-ish, slight angle for depth)
  vec3 V = normalize(vec3(uv * 0.3, 1.0));
  float NdotV = clamp(dot(N, V), 0.0, 1.0);

  // Fresnel rim
  float fresnel = pow(1.0 - NdotV, 3.0);

  // Iridescent cosine palette indexed by NdotV and uBass for oil-slick tint
  float palIdx = NdotV * 1.4 + uBass * 0.6 + h * 0.5 + t * 0.12;
  vec3 iridescence = cosPalette(palIdx,
    vec3(0.5, 0.5, 0.5),
    vec3(0.5, 0.5, 0.5),
    vec3(1.0, 1.0, 0.8),
    vec3(0.00, 0.15, 0.40)
  );

  // Base gunmetal from uPrimary, blended with iridescent specular
  float specBlend = NdotV * NdotV;
  vec3 col = mix(uPrimary * (0.3 + 0.7 * h), iridescence, specBlend * 0.65);

  // Fresnel rim with uAccent glow
  col += fresnel * uAccent * (0.8 + 0.4 * uBass);

  // Wet sheen: pow tonemap
  col = pow(clamp(col, 0.0, 1.0), vec3(0.75));

  fragColor = vec4(col, 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uLevel', 'uBass', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createLiquidChromeFlow(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'liquid-chrome-flow',
    name: 'Liquid Chrome Flow',
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
