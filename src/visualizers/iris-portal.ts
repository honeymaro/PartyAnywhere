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
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p *= 2.1;
    amp *= 0.5;
  }
  return v;
}

vec3 cospalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.2832 * (c * t + d));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  float r = length(uv);
  float angle = atan(uv.y, uv.x);

  float t = uTime * 0.3;
  float rotation = uMid * 1.5 + t * 0.4;
  float rotAngle = angle + rotation;

  // Iris fiber striations via fbm + sin
  vec2 fiberCoord = vec2(rotAngle * 9.549297, r * 6.0);
  float fiber = sin(rotAngle * 60.0 + fbm(fiberCoord + t) * 4.0);
  float fiberFalloff = smoothstep(1.2, 0.05, r);
  float striation = fiber * fiberFalloff;

  // Aperture / iris radius pulsed by bass (dilation)
  float apertureBase = 0.28 + 0.08 * sin(t * 1.1);
  float aperture = apertureBase + uBass * 0.18;
  // Beat triggers shutter contraction
  float shutter = aperture - uBeat * 0.12;
  shutter = max(shutter, 0.04);

  // Pupil: dark center with glowing core
  float pupil = smoothstep(shutter, shutter * 0.6, r);
  float coreGlow = exp(-r * r * 28.0) * (0.6 + uBass * 0.8);

  // Thin-film iridescence: cosine palette over radial + angular index
  float iridIndex = r * 3.5 + rotAngle * 0.15 + striation * 0.18 + t * 0.5;
  vec3 irid = cospalette(
    iridIndex,
    vec3(0.5),
    vec3(0.5),
    vec3(1.0, 0.9, 0.8),
    vec3(0.0, 0.15, 0.33)
  );

  // Mix primary/accent for oil-slick iris color
  float mixF = 0.5 + 0.5 * sin(iridIndex * 1.7 + t);
  vec3 irisColor = mix(uPrimary, uAccent, mixF) * irid;

  // Concentric ring modulation
  float rings = 0.5 + 0.5 * cos(r * 28.0 - t * 2.0 + striation * 0.5);
  irisColor *= 0.7 + 0.3 * rings;

  // Treble shimmer: sparkle on fibers
  float sparkle = hash(vec2(floor(rotAngle * 40.0), floor(r * 30.0)) + floor(t * 12.0));
  irisColor += uTreble * sparkle * fiberFalloff * 0.35;

  // Fade iris out beyond outer edge
  float irisEdge = smoothstep(1.1, 0.55, r);
  vec3 col = irisColor * irisEdge;

  // Subtract pupil (dark hole) and add glowing core
  col *= (1.0 - pupil * 0.95);
  col += uPrimary * coreGlow;
  col += uAccent * exp(-r * r * 80.0) * 0.5;

  // Ambient base so it's always visible
  col = max(col, vec3(0.0));

  fragColor = vec4(col, 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uBass', 'uMid', 'uTreble', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createIrisPortal(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'iris-portal',
    name: 'Iridescent Iris Portal',
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
