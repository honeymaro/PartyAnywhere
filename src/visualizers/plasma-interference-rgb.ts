import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Three drifting point sources emit circular waves; their sum is an interference plasma.
// Each color layer uses a slightly different wavelength (dispersion), so fringes coincide
// near the sources (white-hot) and split into primary / accent fringes further out.
// Wave travel is an accumulated phase (audio sets the rate, one-way). A kick widens the
// dispersion (chromatic split pulse) and flashes the fringes; the log spectrum feeds the
// brightness of each layer (low -> primary, mid -> accent, high -> white highlights).
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uPhase;  // accumulated wave phase
uniform vec2 uS1;      // source positions (CPU, slow drift)
uniform vec2 uS2;
uniform vec2 uS3;
uniform float uLevel;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;
uniform sampler2D uSpectrum;

const float K = 17.0; // base wave number

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  // Spectrum bands (log-spaced texture: x=0 bass, x=1 treble)
  float specLo  = texture(uSpectrum, vec2(0.05, 0.5)).r;
  float specMid = texture(uSpectrum, vec2(0.35, 0.5)).r;
  float specHi  = texture(uSpectrum, vec2(0.80, 0.5)).r;

  float d1 = length(uv - uS1);
  float d2 = length(uv - uS2);
  float d3 = length(uv - uS3);

  // per-layer wave numbers: dispersion splits the fringes with distance from the sources
  float disp = 0.025 + uTreble * 0.012 + uBeat * 0.07;
  vec3 k = K * vec3(1.0 - disp, 1.0, 1.0 + disp);

  vec3 v = sin(d1 * k - uPhase)
         + sin(d2 * k - uPhase * 1.13 + 1.7)
         + sin(d3 * k - uPhase * 0.87 + 3.1);
  vec3 I = 0.5 + v * (1.0 / 6.0); // 0..1 per layer
  I = I * I * I;                  // sharpen into bright fringes over dark troughs

  vec3 col = mix(uPrimary, uAccent, 0.5) * 0.04;
  col += uPrimary * I.x * (0.6 + specLo * 0.9);
  col += uAccent * I.z * (0.6 + specMid * 0.9);
  // where the layers coincide the fringe burns white
  col += vec3(1.0) * (I.x * I.y * I.z) * (0.4 + specHi * 0.8);

  col *= 0.85 + uLevel * 0.15 + uBeat * 0.45;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uPhase', 'uS1', 'uS2', 'uS3', 'uLevel', 'uTreble', 'uBeat',
  'uPrimary', 'uAccent', 'uSpectrum',
] as const;

export function createPlasmaInterferenceRgb(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let phase = 0; // wave travel phase (only ever increases)

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
      const a = frame.audio;
      phase += (1.2 + a.level * 1.0 + a.beat * 4.0) * frame.dt;
      const t = frame.time;

      gl.useProgram(program);
      ctx.quad.bind(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, ctx.spectrumTex);
      gl.uniform1i(u.uSpectrum, 0);
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uPhase, phase);
      // sources wander slowly on Lissajous paths (time only, no audio)
      gl.uniform2f(u.uS1, Math.sin(t * 0.13) * 0.55, Math.cos(t * 0.17) * 0.3);
      gl.uniform2f(u.uS2, Math.cos(t * 0.11 + 2.0) * 0.5, Math.sin(t * 0.07 + 1.0) * 0.35);
      gl.uniform2f(u.uS3, Math.sin(t * 0.09 + 4.0) * 0.45, Math.sin(t * 0.15 + 3.0) * 0.32);
      gl.uniform1f(u.uLevel, a.level);
      gl.uniform1f(u.uTreble, a.treble);
      gl.uniform1f(u.uBeat, a.beat);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
    },
  };
}
