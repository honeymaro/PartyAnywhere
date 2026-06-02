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

// Cosine palette (Iñigo Quílez form: a = base, b = amplitude, fixed phase offset)
vec3 palette(float t, vec3 a, vec3 b) {
  return a + b * cos(6.28318 * t + vec3(0.0, 0.33, 0.67));
}

// Swirl variation: rotate point by angle proportional to radius
vec2 varSwirl(vec2 p, float strength) {
  float r2 = dot(p, p);
  float theta = atan(p.y, p.x) + strength * r2;
  float r = sqrt(r2);
  return vec2(r * cos(theta), r * sin(theta));
}

// Spherical variation: p / r^2
vec2 varSpherical(vec2 p) {
  float r2 = max(dot(p, p), 0.0001);
  return p / r2;
}

// Affine transform
vec2 affine(vec2 p, vec2 a, vec2 b, float angle) {
  float c = cos(angle), s = sin(angle);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y) * 0.55 + a * 0.4 + b * p * 0.15;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  float t = uTime * 0.25;
  float swirlStr = 1.8 + uMid * 3.5;
  float beatBlend = 0.4 + uBeat * 0.6;

  // Seed point from UV, slightly perturbed by time for motion
  vec2 p = uv * 1.4 + vec2(sin(t * 0.31), cos(t * 0.27)) * 0.08;

  float density = 0.0;
  float orbitTrap = 1e6;

  // Iterate 14 affine+nonlinear steps
  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    float phase = fi * 0.7123 + t;

    // Affine coefficients driven by time + beat
    vec2 offset = vec2(sin(phase + beatBlend), cos(phase * 1.3 + beatBlend)) * 0.5;
    vec2 scale  = vec2(sin(phase * 0.9), cos(phase * 1.1)) * 0.2;
    float angle = phase * 0.4 + t * 0.15;

    p = affine(p, offset, scale, angle);

    // Blend swirl and spherical variations
    float w = 0.5 + 0.5 * sin(fi * 1.618 + t * 0.5);
    vec2 ps = varSwirl(p, swirlStr);
    vec2 ph = varSpherical(p * 0.6);
    p = mix(ps, ph, w * beatBlend);

    // Clamp to avoid explosion
    p = clamp(p, -3.0, 3.0);

    // Accumulate inverse-distance density from origin
    float r = length(p);
    density += 1.0 / (1.0 + r * r * 2.5);

    // Orbit trap: distance to a reference lemniscate-like curve
    float trap = length(p - vec2(sin(fi * 0.9), 0.0) * 0.4);
    orbitTrap = min(orbitTrap, trap);
  }

  // Log-scale density for flame glow
  float glow = log(1.0 + density * 0.9) * (0.6 + uBass * 1.4);

  // Color via cosine palette mixing primary->accent, shifted by treble and orbit trap
  float colorT = fract(orbitTrap * 0.55 + uTreble * 0.35 + t * 0.12);
  vec3 col = palette(colorT, uPrimary * 0.5 + 0.5, uAccent * 0.5 + 0.5);

  // Additive glow: ramp up with density
  float bloom = pow(glow, 1.6);
  col = col * bloom + uPrimary * pow(glow, 3.0) * 0.4;

  // Dark background, tone-map
  col = col / (1.0 + col);
  fragColor = vec4(col, 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uBass', 'uMid', 'uTreble', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createFractalFlameSwirl(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'fractal-flame-swirl',
    name: 'Fractal Flame Swirl',
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
