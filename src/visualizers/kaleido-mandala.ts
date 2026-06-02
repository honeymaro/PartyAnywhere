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

const float PI = 3.14159265358979;
const float TWO_PI = 6.28318530717959;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
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

vec3 cosPalette(float t, vec3 a, vec3 b) {
  return a + b * cos(TWO_PI * (t + vec3(0.0, 0.33, 0.67)));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  float t = uTime * 0.25;

  // Polar coordinates
  float r = length(uv);
  float a = atan(uv.y, uv.x);

  // Beat-snapped N-fold symmetry: N ranges 6..12
  float N = 6.0 + floor(uBeat * 6.0);
  float sector = TWO_PI / N;

  // Rotate the fold angle slowly with uMid
  a += t * 0.3 + uMid * PI;

  // Fold into a single wedge
  a = mod(a, sector);
  a = abs(a - sector * 0.5);

  // uBass radial breathing
  float breathR = r * (1.0 + uBass * 0.35 * sin(uTime * 2.1));

  // Reconstruct folded Cartesian UV for fbm
  vec2 foldedUV = vec2(cos(a), sin(a)) * breathR;

  // FBM layer
  float f = fbm(foldedUV * 3.0 + vec2(t * 0.4, t * 0.3));

  // Concentric sin rings based on r
  float rings = 0.5 + 0.5 * sin(breathR * 8.0 - uTime * 1.8);

  // Combine fbm and rings
  float pattern = mix(f, rings, 0.5);

  // uTreble petal sparkle near edges (high r)
  float edgeMask = smoothstep(0.3, 0.8, breathR);
  float sparkle = hash(foldedUV * 47.3 + vec2(floor(uTime * 12.0)));
  pattern += uTreble * 0.4 * edgeMask * sparkle;

  // Cosine palette coloring using r and pattern
  float colorT = fract(pattern + breathR * 0.5 + t * 0.15);
  vec3 col = cosPalette(colorT, uPrimary * 0.5 + 0.3, uAccent * 0.5 + 0.3);

  // Vignette
  float vignette = 1.0 - smoothstep(0.6, 1.1, r);
  col *= vignette;

  // Bright center glow
  col += uPrimary * 0.3 * exp(-breathR * 5.0);

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uBass', 'uMid', 'uTreble', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createKaleidoMandala(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'kaleido-mandala',
    name: 'Kaleidoscope Mandala',
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
