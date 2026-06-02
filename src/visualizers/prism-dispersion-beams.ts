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

// Convert hue to RGB (spectral rainbow)
vec3 hueToRgb(float h) {
  float r = abs(h * 6.0 - 3.0) - 1.0;
  float g = 2.0 - abs(h * 6.0 - 2.0);
  float b = 2.0 - abs(h * 6.0 - 4.0);
  return clamp(vec3(r, g, b), 0.0, 1.0);
}

// Distance from point p to a line defined by origin o and direction d
float distToRay(vec2 p, vec2 o, vec2 d) {
  vec2 op = p - o;
  float t = dot(op, d);
  return length(op - t * d);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  // Animate slow base motion even at zero audio
  float t = uTime * 0.3;

  // Prism apex sits at center-left; incoming beam travels right
  vec2 prismPos = vec2(-0.35, 0.0);

  // uMid rotates the prism, changing dispersion spread
  float spread = 0.45 + uMid * 0.35;
  float prismAngle = t * 0.15 + uMid * 0.6;

  // Incoming white beam: horizontal ray from the left
  float incomingAngle = prismAngle * 0.25;
  vec2 inDir = vec2(cos(incomingAngle), sin(incomingAngle));

  // Pulse from beat
  float pulse = 1.0 + uBeat * 1.2;

  // Accumulated color from all spectral beams
  vec3 col = vec3(0.0);
  const int RAYS = 24;

  for (int i = 0; i < RAYS; i++) {
    float fi = float(i) / float(RAYS - 1);  // 0..1 across spectrum

    // Dispersion: each wavelength exits at a slightly different angle
    float dispAngle = (fi - 0.5) * spread + t * 0.08;
    vec2 rayDir = vec2(cos(dispAngle), sin(dispAngle));

    // Distance from current pixel to this dispersed ray
    float d = distToRay(uv, prismPos, rayDir);

    // Beam width modulated by bass and beat pulse
    float width = (0.012 + uBass * 0.018) * pulse;
    float beam = exp(-d * d / (width * width));

    // Spectral color blended toward uPrimary/uAccent endpoints
    vec3 spectral = hueToRgb(fi * 0.75 + 0.0);
    vec3 tinted = mix(mix(spectral, uPrimary, 0.35), uAccent, fi * 0.45);

    col += tinted * beam * (0.7 + 0.3 * uBass);
  }

  // Incoming beam glow (white/primary tinted)
  float inDist = distToRay(uv, prismPos - inDir * 0.6, inDir);
  float inWidth = (0.008 + uBass * 0.012) * pulse;
  float inBeam = exp(-inDist * inDist / (inWidth * inWidth));
  // Only show incoming beam to the left of prism
  float inMask = step(uv.x, prismPos.x + 0.05);
  col += mix(vec3(1.0), uPrimary, 0.3) * inBeam * inMask * 0.9;

  // Prism triangle highlight (subtle)
  float prismDist = length(uv - prismPos) - 0.06;
  float prismGlow = exp(-max(prismDist, 0.0) * 18.0) * 0.4;
  col += mix(uPrimary, uAccent, 0.5) * prismGlow;

  // uTreble sparkle: dust motes along dispersed beams
  if (uTreble > 0.01) {
    vec2 sparkUv = uv * 12.0 + vec2(t * 0.7, t * 0.4);
    float sparkNoise = fract(sin(dot(floor(sparkUv), vec2(127.1, 311.7))) * 43758.5);
    float sparkle = step(0.92, sparkNoise) * uTreble * 0.6;
    // Only sparkle where there is beam energy
    float beamPresence = clamp(length(col) * 1.5, 0.0, 1.0);
    col += sparkle * beamPresence * mix(uAccent, vec3(1.0), 0.5);
  }

  // Vignette for dark surround
  float vignette = 1.0 - smoothstep(0.55, 1.2, length(uv));
  col *= vignette;

  // Tone-map to keep bright beams from blowing out
  col = col / (col + vec3(1.0));

  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uBass', 'uMid', 'uTreble', 'uBeat', 'uPrimary', 'uAccent',
] as const;

export function createPrismDispersionBeams(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'prism-dispersion-beams',
    name: 'Prism Dispersion Beams',
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
