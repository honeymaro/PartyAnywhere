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

// Simple hash for fbm noise
float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 17.5);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1,0)), f.x),
    mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.1 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

// Thin-film interference for a given wavelength (nm) and optical path difference (nm)
float thinFilm(float opd, float lambda) {
  float phase = 2.0 * 3.14159265 * opd / lambda;
  return 0.5 + 0.5 * cos(phase);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  // Slow rotation driven by uLevel
  float angle = uTime * 0.15 + uLevel * 1.2;
  float ca = cos(angle); float sa = sin(angle);
  vec2 ruv = vec2(ca * uv.x - sa * uv.y, sa * uv.x + ca * uv.y);

  // Analytical sphere: camera along +Z
  float r = 0.72;
  float d = length(ruv);
  if (d >= r) {
    // Dark space background with faint glow rim
    float rim = smoothstep(r * 1.35, r * 1.0, d);
    vec3 bg = mix(uPrimary, uAccent, 0.5) * rim * 0.08;
    fragColor = vec4(bg, 1.0);
    return;
  }

  float z = sqrt(r * r - d * d);
  vec3 N = normalize(vec3(ruv, z));
  vec3 V = vec3(0.0, 0.0, 1.0);
  float cosTheta = dot(N, V);           // 0..1, 1 at centre

  // Surface ripple via fbm — treble adds high-freq detail
  vec2 surfP = ruv * 3.0 + uTime * 0.4;
  float ripple = fbm(surfP + uTreble * fbm(surfP * 2.0 + uTime * 0.7) * 2.5);

  // Film thickness in nm: base 500nm + bass modulation + beat flash
  float thickness = 500.0 + uBass * 320.0 + uBeat * 180.0 + ripple * 140.0 * (1.0 + uMid);

  // Optical path difference for thin film at this angle
  float opd = 2.0 * thickness * cosTheta;

  // Spectral interference for R/G/B wavelengths
  vec3 spec;
  spec.r = thinFilm(opd, 650.0);
  spec.g = thinFilm(opd, 550.0);
  spec.b = thinFilm(opd, 450.0);

  // Fresnel (Schlick approximation, n1=1 air, n2=1.45 soap)
  float f0 = 0.035;
  float fresnel = f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);

  // Tint interference spectrum toward palette
  vec3 tint = mix(uPrimary, uAccent, clamp(spec.g + uMid * 0.3, 0.0, 1.0));
  vec3 col = mix(spec, tint, 0.45);

  // Fresnel brightens edges; bloom highlights
  col += fresnel * 0.55;
  col = pow(max(col, vec3(0.0)), vec3(0.72));   // mild gamma/bloom

  // Dark base interior shading
  col *= 0.15 + 0.85 * (0.3 + 0.7 * cosTheta);

  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uLevel', 'uBass', 'uMid', 'uTreble', 'uBeat', 'uPrimary', 'uAccent',
] as const;

export function createThinFilmBubble(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'thin-film-bubble',
    name: 'Thin-Film Soap Bubble',
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
