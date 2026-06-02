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

vec3 cosPalette(float t, vec3 a, vec3 b) {
  return a + b * cos(6.28318 * t + vec3(0.0, 0.33, 0.67));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  // Attractor parameters animated by time and audio
  float beatShift = uBeat * 0.8;
  float midMorph  = uMid * 1.2;
  float a = 1.7 + 0.5 * sin(uTime * 0.17 + midMorph)       + beatShift;
  float b = 1.8 + 0.4 * cos(uTime * 0.23 - midMorph * 0.7) - beatShift;
  float c = 0.9 + 0.3 * sin(uTime * 0.13 + midMorph * 0.5);
  float d = 0.9 + 0.3 * cos(uTime * 0.19 + midMorph * 0.3) + beatShift * 0.5;

  // Seed the orbit from the current pixel's UV
  // Scale UV to attractor coordinate range (~[-2.5,2.5])
  vec2 p = uv * 2.8;

  float density = 0.0;
  float eps = 0.004;

  // Iterate the Clifford map and accumulate density near this pixel
  for (int i = 0; i < 32; i++) {
    float nx = sin(a * p.y) + c * cos(a * p.x);
    float ny = sin(b * p.x) + d * cos(b * p.y);
    p = vec2(nx, ny);

    // Proximity of orbit point to current fragment
    vec2 diff = p - uv * 2.8;
    float distSq = dot(diff, diff);
    density += eps / (distSq + eps);
  }

  // Normalise and apply bass brightness
  density = density / 32.0;
  density = pow(density, 0.55);
  float brightness = density * (0.7 + uBass * 1.8);

  // Cosine palette hue cycling with uTreble
  float hueShift = uTime * 0.08 + uTreble * 0.5;
  vec3 col = cosPalette(brightness + hueShift, uPrimary * 0.5, uAccent * 0.5 + 0.25);

  // Additive glow on dark background
  col = col * brightness * 2.2;

  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uBass', 'uMid', 'uTreble', 'uBeat', 'uPrimary', 'uAccent',
] as const;

export function createCliffordAttractor(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'clifford-attractor',
    name: 'Clifford Attractor Field',
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
