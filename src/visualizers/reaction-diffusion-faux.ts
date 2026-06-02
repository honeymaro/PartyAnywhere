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

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  // uBeat shifts noise seed for sudden reorganization
  vec2 beatOffset = vec2(floor(uBeat * 4.0) * 3.7, floor(uBeat * 4.0) * 2.3);

  // scaleA/B ratio modulated by uMid (1.0 baseline, grows with mid energy)
  float midScale = 1.0 + uMid * 2.0;
  float scaleA = 2.5 * midScale;
  float scaleB = 4.1 * midScale;

  vec2 pA = uv * scaleA + beatOffset + vec2(uTime * 0.1, uTime * 0.07);
  vec2 pB = uv * scaleB + beatOffset - vec2(uTime * 0.07, uTime * 0.05);

  float a = fbm(pA);
  float b = fbm(pB);

  // uBass shifts the threshold so spots grow/shrink with bass hits
  float diff = a - b + uBass * 0.2;

  // uTreble sharpens the edge — small w = crisp borders
  float w = 0.04 + (1.0 - uTreble) * 0.12;

  float pattern = smoothstep(-w, w, diff);

  // Thin reactive border: derivative of pattern mapped to [0,1]
  float border = 1.0 - abs(pattern * 2.0 - 1.0);
  border = pow(border, 2.0 + uTreble * 4.0);

  // Base color: spots = uAccent, gaps = uPrimary
  vec3 col = mix(uPrimary, uAccent, pattern);

  // Highlight border with a brightened blend
  vec3 borderColor = mix(uAccent, vec3(1.0), 0.5);
  col = mix(col, borderColor, border * 0.7);

  fragColor = vec4(col, 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uBass', 'uMid', 'uTreble', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createReactionDiffusionFaux(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'reaction-diffusion-faux',
    name: 'Faux Reaction Diffusion',
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
