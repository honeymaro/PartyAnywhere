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
const float INNER = 0.2;

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  float r = length(uv);
  float a = atan(uv.y, uv.x);

  // Normalise angle to [0,1] for spectrum lookup
  float normA = fract(a / TWO_PI + 0.5);

  // Add slow rotation from uTime so it animates even with no audio
  float lookupA = fract(normA + uTime * 0.04);
  float specVal = texture(uSpectrum, vec2(lookupA, 0.5)).r;

  // Bar height: spectrum drives it, bass expands the ring
  float barH = specVal * 0.6 + 0.005 * sin(uTime * 3.0 + normA * TWO_PI * 8.0);
  float outerEdge = INNER + barH + uBass * 0.1;

  // Radial bar mask: between inner radius and outer edge
  float inBar = step(INNER, r) * step(r, outerEdge);

  // Mirror: also draw opposite side (full circle already covers, but add
  // a subtle second ring at a slightly different radius for depth)
  float mirrorR = INNER * 0.55;
  float mirrorH = barH * 0.45;
  float inMirror = step(mirrorR, r) * step(r, mirrorR + mirrorH);

  // Color gradient from uPrimary at base to uAccent at tip
  float tBar = (outerEdge > INNER) ? clamp((r - INNER) / max(barH, 0.001), 0.0, 1.0) : 0.0;
  vec3 barColor = mix(uPrimary, uAccent, tBar);

  // Bright tip glow where r is near the outer edge
  float tipGlow = smoothstep(outerEdge - 0.04, outerEdge, r) * inBar;
  barColor += uTreble * tipGlow * uAccent * 1.5;

  // Beat flash: bright concentric ring at the outer rim
  float beatRing = smoothstep(0.02, 0.0, abs(r - outerEdge - 0.01)) * uBeat;
  barColor += beatRing * mix(uPrimary, uAccent, 0.7) * 2.0;

  // Bloom falloff around each bar (soft glow halo)
  float distToOuter = abs(r - outerEdge);
  float bloom = exp(-distToOuter * 18.0) * inBar * 0.35;
  barColor += bloom * uAccent;

  // Mirror ring contribution
  vec3 mirrorColor = mix(uPrimary * 0.6, uAccent * 0.6, tBar);

  // Idle pulse so there is always motion
  float idlePulse = 0.04 * sin(uTime * 1.8) * smoothstep(INNER + 0.01, INNER, r);

  vec3 col = barColor * inBar
           + mirrorColor * inMirror * (1.0 - inBar)
           + idlePulse * uPrimary;

  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uBass', 'uTreble', 'uBeat',
  'uPrimary', 'uAccent', 'uSpectrum',
] as const;

export function createSpectrumRadialBars(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'spectrum-radial-bars',
    name: 'Radial Spectrum Bars',
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
