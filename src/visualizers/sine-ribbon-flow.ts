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
uniform sampler2D uSpectrum;

float ribbon(float uvY, float centerY, float halfThick) {
  float d = abs(uvY - centerY);
  return smoothstep(halfThick, halfThick * 0.4, d);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;

  // Base thickness grows with bass; treble adds brightness
  float thickness = 0.03 + uBass * 0.045;
  float brightness = 1.0 + uTreble * 0.6;

  // Beat kicks an extra phase offset that decays each frame via time
  float beatPhase = uBeat * 1.2;

  vec3 col = vec3(0.0);

  // 6 stacked ribbons
  for (int i = 0; i < 6; i++) {
    float fi = float(i);

    // Spread ribbon centers evenly across [0.1, 0.9]
    float baseY = 0.1 + fi * (0.8 / 5.0);

    // Each ribbon has its own frequency and phase offset
    float freq = 3.0 + fi * 1.7;
    float phase = fi * 1.047; // roughly pi/3 apart

    // Sample per-ribbon amplitude from spectrum texture
    float specU = (fi + 0.5) / 6.0;
    float specAmp = texture(uSpectrum, vec2(specU, 0.5)).r;
    float amp = (0.04 + uMid * 0.08 + specAmp * 0.12);

    // Centerline of this ribbon
    float centerY = baseY + sin(uv.x * freq + uTime * (0.6 + fi * 0.15) + phase + beatPhase) * amp;

    // Mask: smoothstep band around the centerline
    float mask = ribbon(uv.y, centerY, thickness);

    // Color: gradient along x, blending between primary and accent per ribbon
    float t = fract(fi / 6.0 + uv.x * 0.4);
    vec3 ribbonCol = mix(uPrimary, uAccent, t);

    // Soft glow falloff outside ribbon core
    float glowMask = ribbon(uv.y, centerY, thickness * 2.5) * 0.35;
    col += ribbonCol * (mask + glowMask) * brightness;
  }

  // Additive result — clamp to avoid over-exposure while keeping glow
  col = col / (col + 1.0); // reinhard tonemapping keeps it vivid
  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uBass', 'uMid', 'uTreble', 'uBeat',
  'uPrimary', 'uAccent', 'uSpectrum',
] as const;

export function createSineRibbonFlow(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'sine-ribbon-flow',
    name: 'Flowing Sine Ribbons',
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
