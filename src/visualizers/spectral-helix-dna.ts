import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;
uniform sampler2D uSpectrum;

float glowTube(float dist, float radius) {
  float core = smoothstep(radius, 0.0, dist);
  float halo = exp(-dist * 18.0) * 0.5;
  return core + halo;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  // Slow vertical scroll
  float scrollY = uv.y + uTime * 0.08;

  float helix_freq = 7.0;
  float radius = 0.28 + uBass * 0.18;
  float speed = uTime * (0.22 + uMid * 0.5);

  // Two strand x-positions along the helix
  float strand1x = sin(scrollY * helix_freq + speed) * radius;
  float strand2x = sin(scrollY * helix_freq + speed + 3.14159265) * radius;

  // Depth: strands in front/behind based on cos phase
  float depth1 = 0.5 + 0.5 * cos(scrollY * helix_freq + speed);
  float depth2 = 0.5 + 0.5 * cos(scrollY * helix_freq + speed + 3.14159265);

  // Distance from pixel to each strand centerline
  float dist1 = length(vec2(uv.x - strand1x, 0.0));
  float dist2 = length(vec2(uv.x - strand2x, 0.0));

  float tubeR = 0.022;
  float g1 = glowTube(dist1, tubeR) * (0.55 + 0.45 * depth1);
  float g2 = glowTube(dist2, tubeR) * (0.55 + 0.45 * depth2);

  vec3 col = vec3(0.0);
  col += uPrimary * g1;
  col += uAccent  * g2;

  // Rungs: horizontal connectors at regular y intervals
  float rungSpacing = 0.22;
  float rungPhase = mod(scrollY + rungSpacing * 0.5, rungSpacing);
  float rungFrac  = rungPhase / rungSpacing;   // 0..1 within the segment
  float toRung    = abs(rungPhase - rungSpacing * 0.5);  // distance to nearest rung center

  // Spectrum brightness for this rung segment
  float segCoord  = mod(scrollY / rungSpacing, 1.0);
  float specBright = texture(uSpectrum, vec2(fract(segCoord), 0.5)).r;

  if (toRung < 0.012) {
    float xMin = min(strand1x, strand2x);
    float xMax = max(strand1x, strand2x);
    float inRung = step(xMin - 0.01, uv.x) * step(uv.x, xMax + 0.01);
    float rungDist = abs(uv.y - (floor((scrollY + rungSpacing * 0.5) / rungSpacing) * rungSpacing - uTime * 0.08 + 0.0));

    // t along rung 0..1 for color gradient
    float span = xMax - xMin + 0.0001;
    float t = clamp((uv.x - xMin) / span, 0.0, 1.0);
    vec3 rungCol = mix(uPrimary, uAccent, t);

    float rungGlow = inRung * (specBright * 0.8 + 0.2) * exp(-toRung * 60.0);
    col += rungCol * rungGlow * (0.7 + 0.3 * uBeat);
  }

  // Node flash on beat at strand endpoints near rungs
  float nodePulse = uBeat * 0.5;
  float nodeSize  = 0.038 + nodePulse * 0.025;
  float nd1 = length(uv - vec2(strand1x, floor((scrollY + rungSpacing * 0.5) / rungSpacing) * rungSpacing - uTime * 0.08));
  float nd2 = length(uv - vec2(strand2x, floor((scrollY + rungSpacing * 0.5) / rungSpacing) * rungSpacing - uTime * 0.08));
  col += uPrimary * exp(-nd1 / nodeSize) * (specBright + nodePulse);
  col += uAccent  * exp(-nd2 / nodeSize) * (specBright + nodePulse);

  // Dark background, additive result
  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uBass', 'uMid', 'uBeat',
  'uPrimary', 'uAccent', 'uSpectrum',
] as const;

export function createSpectralHelixDna(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'spectral-helix-dna',
    name: 'Spectral Helix DNA',
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
