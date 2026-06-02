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
uniform sampler2D uSpectrum;

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  // Sample spectrum for frequency-driven modulation
  float specLo  = texture(uSpectrum, vec2(0.05, 0.5)).r;
  float specMid = texture(uSpectrum, vec2(0.35, 0.5)).r;
  float specHi  = texture(uSpectrum, vec2(0.80, 0.5)).r;

  // Global phase: uBeat injects a sharp phase jump each kick
  float t = uTime * 0.5 + uBeat * 1.2;

  // Wave frequencies driven by spectrum bands
  float f1 = 4.0 + specLo  * 6.0;
  float f2 = 3.5 + specMid * 5.0;
  float f3 = 5.0 + specHi  * 4.0;
  float f4 = 6.0 + uTreble * 3.0;

  // Base interference plasma
  float v =  sin(uv.x * f1 + t)
           + sin(uv.y * f2 + t * 1.1)
           + sin((uv.x + uv.y) * f3 + t)
           + sin(length(uv) * f4 * (1.0 + uBass) - t);

  // Per-channel phase offsets for chromatic spread
  float spread = uTreble * 0.5 + 0.25;
  float r = 0.5 + 0.5 * sin(v);
  float g = 0.5 + 0.5 * sin(v + spread);
  float b = 0.5 + 0.5 * sin(v + spread * 2.0);

  vec3 plasma = vec3(r, g, b);

  // Palette blend: mix plasma with uPrimary/uAccent gradient using luminance
  float lum = dot(plasma, vec3(0.299, 0.587, 0.114));
  vec3 palette = mix(uPrimary, uAccent, lum);

  // Combine: plasma chromatics tinted toward palette
  vec3 col = mix(plasma, palette, 0.45 + uLevel * 0.35);

  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uLevel', 'uBass', 'uTreble', 'uBeat',
  'uPrimary', 'uAccent', 'uSpectrum',
] as const;

export function createPlasmaInterferenceRgb(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'plasma-interference-rgb',
    name: 'Chromatic Plasma Interference',
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
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, ctx.spectrumTex);
      gl.uniform1i(u.uSpectrum, 0);
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
