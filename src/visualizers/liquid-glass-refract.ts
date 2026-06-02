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
    p = p * 2.1 + vec2(1.7, 9.2);
    amp *= 0.5;
  }
  return v;
}

vec3 backdrop(vec2 uv) {
  float t = uTime * 0.15;
  float grad = 0.5 + 0.5 * dot(normalize(uv + 0.001), vec2(0.707, 0.707));
  vec3 base = mix(uPrimary, uAccent, grad);
  float grid = step(0.96, fract(uv.x * 8.0 + t * 0.1)) + step(0.96, fract(uv.y * 8.0 - t * 0.07));
  grid = clamp(grid, 0.0, 1.0);
  base += grid * 0.04 * uAccent;
  return base;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  float t = uTime * 0.2;
  float n0 = fbm(uv * 3.0 + t);
  float n1 = fbm(uv * 3.0 + t + vec2(5.2, 1.3));
  vec2 gradN = vec2(n0 - fbm(uv * 3.0 + t + vec2(0.01, 0.0)),
                    n0 - fbm(uv * 3.0 + t + vec2(0.0, 0.01))) * 100.0;

  float midAmt = 0.04 + uMid * 0.12;
  vec2 disp = gradN * midAmt;

  float bassRipple = uBass * 0.03;
  float dist = length(uv);
  float ripplePhase = dist * 12.0 - uTime * 4.0;
  disp += normalize(uv + 0.001) * sin(ripplePhase) * bassRipple;

  float beatRipple = uBeat * 0.06;
  float beatPhase = dist * 18.0 - uTime * 6.0;
  disp += normalize(uv + 0.001) * max(0.0, sin(beatPhase)) * beatRipple * exp(-dist * 2.5);

  float chromatic = 0.008 + uTreble * 0.025;
  vec2 uvB = uv + disp;
  vec2 uvR = uv + disp * (1.0 + chromatic);
  vec2 uvG = uv + disp * (1.0 + chromatic * 0.5);

  vec3 colR = backdrop(uvR);
  vec3 colG = backdrop(uvG);
  vec3 colB = backdrop(uvB);
  vec3 refracted = vec3(colR.r, colG.g, colB.b);

  float edgeStrength = clamp(length(gradN) * 0.15, 0.0, 1.0);
  float fresnel = pow(edgeStrength, 1.5);
  vec3 col = mix(refracted, uAccent * 1.4, fresnel * 0.6);

  float gloss = smoothstep(0.6, 1.0, n1) * 0.15;
  col += gloss * (uAccent * 0.5 + 0.5);

  col = pow(clamp(col, 0.0, 1.0), vec3(0.9));

  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime',
  'uBass', 'uMid', 'uTreble', 'uBeat',
  'uPrimary', 'uAccent',
] as const;

export function createLiquidGlassRefract(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'liquid-glass-refract',
    name: 'Liquid Glass Refraction',
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
