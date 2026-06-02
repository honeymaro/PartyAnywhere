import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uLevel;
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

// Approximate oklab-space midmix for perceptually smooth blending
vec3 okMix(vec3 a, vec3 b, float t) {
  // Simple gamma-aware blend approximation
  vec3 la = pow(max(a, vec3(0.0)), vec3(2.2));
  vec3 lb = pow(max(b, vec3(0.0)), vec3(2.2));
  return pow(mix(la, lb, t), vec3(1.0 / 2.2));
}

void main() {
  vec2 uv = (gl_FragCoord.xy / uResolution) * 2.0 - 1.0;
  uv.x *= uResolution.x / uResolution.y;

  float t = uTime * 0.1;
  float bassR = 0.55 + uBass * 0.25;
  float beatPhase = uBeat * 0.52;

  // 5 anchor positions on slow circular paths with varied radii and speeds
  vec2 anchors[5];
  anchors[0] = vec2(cos(t * 1.00 + 0.00) * bassR,        sin(t * 1.00 + 0.00) * bassR);
  anchors[1] = vec2(cos(t * 0.73 + 1.26) * bassR * 0.80, sin(t * 0.73 + 1.26) * bassR * 0.80);
  anchors[2] = vec2(cos(t * 1.31 + 2.51) * bassR * 1.10, sin(t * 1.31 + 2.51) * bassR * 1.10);
  anchors[3] = vec2(cos(t * 0.59 + 3.77) * bassR * 0.65, sin(t * 0.59 + 3.77) * bassR * 0.65);
  anchors[4] = vec2(cos(t * 1.17 + 5.03) * bassR * 0.90, sin(t * 1.17 + 5.03) * bassR * 0.90);

  // Anchor colors: alternate primary/accent/midmix, shifted by beat
  vec3 mid = okMix(uPrimary, uAccent, 0.5);
  vec3 midLight = okMix(uPrimary, uAccent, 0.25);
  vec3 midDark  = okMix(uPrimary, uAccent, 0.75);

  // Beat rotates palette assignment by cycling index offset
  int off = int(mod(beatPhase * 5.0 + 0.5, 5.0));
  vec3 palette[5];
  palette[0] = uPrimary;
  palette[1] = uAccent;
  palette[2] = mid;
  palette[3] = midLight;
  palette[4] = midDark;

  vec3 anchorColors[5];
  anchorColors[0] = palette[int(mod(float(off + 0), 5.0))];
  anchorColors[1] = palette[int(mod(float(off + 1), 5.0))];
  anchorColors[2] = palette[int(mod(float(off + 2), 5.0))];
  anchorColors[3] = palette[int(mod(float(off + 3), 5.0))];
  anchorColors[4] = palette[int(mod(float(off + 4), 5.0))];

  // Sharpness controlled by uLevel: higher level = crisper blobs
  float sharpness = 1.0 + uLevel * 3.0;

  // Compute inverse-distance weights
  float weights[5];
  float totalW = 0.0;
  for (int i = 0; i < 5; i++) {
    float d2 = dot(uv - anchors[i], uv - anchors[i]);
    weights[i] = 1.0 / (d2 * sharpness + 0.01);
    totalW += weights[i];
  }

  // Blend colors by normalized weights
  vec3 col = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    col += (weights[i] / totalW) * anchorColors[i];
  }

  // Gentle film grain tuned by uTreble
  float grainAmt = 0.03 + uTreble * 0.06;
  float grain = fract(sin(dot(gl_FragCoord.xy + uTime * 37.3, vec2(127.1, 311.7))) * 43758.5453);
  col += (grain - 0.5) * grainAmt;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uLevel', 'uBass', 'uTreble', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createGradientMeshBlob(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'gradient-mesh-blob',
    name: 'Gradient Mesh Blobs',
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
