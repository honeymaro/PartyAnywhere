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

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

float hash1(float n) {
  return fract(sin(n) * 43758.5453);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  vec2 shift = vec2(100.0);
  for (int i = 0; i < 4; i++) {
    v += a * (0.5 + 0.5 * sin(p.x * 3.14159 + uTime * 0.3) * sin(p.y * 3.14159 - uTime * 0.2));
    p = p * 2.1 + shift;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;

  // Block quantization driven by uBass
  float blockSize = max(0.01, 0.04 + uBass * 0.08);
  vec2 blockUV = floor(uv / blockSize) * blockSize;
  float blockHash = hash(blockUV + floor(uTime * 8.0) * 0.01);

  // Swap block UV when beat hits and block hash is below beat probability
  vec2 glitchUV = uv;
  float glitchProb = 0.15 + uBeat * 0.6;
  if (blockHash < glitchProb) {
    // Displace block to a random other block
    float bh2 = hash(blockUV + vec2(7.3, 2.9));
    float bh3 = hash(blockUV + vec2(3.1, 8.7));
    vec2 displacement = vec2(bh2 - 0.5, bh3 - 0.5) * blockSize * (2.0 + uBeat * 6.0);
    glitchUV = blockUV + fract(uv / blockSize) * blockSize + displacement;
  }

  // Scanline slice displacement driven by uBeat
  float rowHeight = 1.0 / (uResolution.y * 0.05);
  float row = floor(uv.y / rowHeight);
  float rowHash = hash1(row * 17.3 + floor(uTime * 12.0));
  float sliceAmt = sin(rowHash * 6.2831 + uTime * 2.0) * uBeat * 0.08;
  glitchUV.x += sliceAmt;
  glitchUV = fract(glitchUV);

  // Chromatic aberration: R, G, B sampled at offset UVs by uTreble
  float aberration = uTreble * 0.02 + 0.003;
  vec2 uvR = fract(glitchUV + vec2( aberration, 0.0));
  vec2 uvG = glitchUV;
  vec2 uvB = fract(glitchUV + vec2(-aberration, 0.0));

  // Base scene: drifting fbm gradient between uPrimary and uAccent
  float fieldR = fbm(uvR * 2.5 + vec2(uTime * 0.07, 0.0));
  float fieldG = fbm(uvG * 2.5 + vec2(0.0, uTime * 0.05));
  float fieldB = fbm(uvB * 2.5 + vec2(-uTime * 0.06, uTime * 0.03));

  vec3 colR = mix(uPrimary, uAccent, fieldR);
  vec3 colG = mix(uPrimary, uAccent, fieldG);
  vec3 colB = mix(uPrimary, uAccent, fieldB);
  vec3 col = vec3(colR.r, colG.g, colB.b);

  // Corrupted blocks invert/shift toward uAccent
  if (blockHash < glitchProb * 0.4) {
    col = uAccent - col + uAccent * 0.3;
  }

  // Scanline flicker
  float scanline = 0.85 + 0.15 * sin(gl_FragCoord.y * 3.14159 * 2.0);
  col *= scanline;

  // Film grain
  float grain = hash(gl_FragCoord.xy + fract(uTime * 57.3)) * 0.06 - 0.03;
  col += grain;

  // Energy boost from uLevel
  col *= 0.8 + uLevel * 0.5;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uLevel', 'uBass', 'uTreble', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createGlitchDatamosh(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'glitch-datamosh',
    name: 'Datamosh Glitch',
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
