import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;
uniform sampler2D uSpectrum;

const float TWO_PI = 6.28318530718;

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  float r = length(uv);
  float a = atan(uv.y, uv.x);

  // Sample spectrum at this angle. Mirror the angle into [0,1] (abs(a)/PI) so the
  // mapping is seamless across the 0/360 wrap — fract(a/2PI) jumps from ~1 to 0 there.
  float specU = abs(a) / 3.14159265;
  float s = texture(uSpectrum, vec2(specU, 0.5)).r;

  // Bass expands all rings outward, beat triggers emission pulse
  float expansion = uBass * 0.18;

  // Sharpness: higher uTreble makes ring edges crisper
  float sharpness = 2.5 + uTreble * 6.0;

  // Number of rings (8 concentric), modulate radius with spectrum displacement
  float ringPhase = r * 8.0 - uTime * 0.7 + s * 0.3 + expansion;
  float ring = abs(fract(ringPhase) - 0.5) * 2.0;

  // Glow: smoothstep sharpened by treble
  float edgeWidth = 0.08 / sharpness;
  float glow = 1.0 - smoothstep(0.0, edgeWidth, ring - (0.05 + uBeat * 0.12));

  // Fade toward center (dark center) and toward edge
  float radialFade = smoothstep(0.05, 0.35, r) * smoothstep(1.1, 0.55, r);

  // Color: alternate primary/accent by ring index, modulate by radius
  float colorMix = 0.5 + 0.5 * sin(r * 6.0 + uTime * 0.3);
  vec3 col = mix(uPrimary, uAccent, colorMix);

  // Beat pulse brightens the whole field
  float emission = glow * radialFade * (1.0 + uBeat * 1.2);

  // Additive accumulation: dark background, glowing rings
  vec3 finalColor = col * emission;

  fragColor = vec4(finalColor, 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uBass', 'uTreble', 'uBeat', 'uPrimary', 'uAccent', 'uSpectrum'] as const;

export function createWaveformRings(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'waveform-rings',
    name: 'Concentric Waveform Rings',
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
