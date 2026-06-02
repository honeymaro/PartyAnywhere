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

// Axial hex coordinate helpers
vec2 hexAxial(vec2 p) {
  float q = (2.0 / 3.0) * p.x;
  float r = (-1.0 / 3.0) * p.x + (sqrt(3.0) / 3.0) * p.y;
  return vec2(q, r);
}

vec2 axialRound(vec2 axial) {
  float s = -axial.x - axial.y;
  float rx = round(axial.x);
  float ry = round(axial.y);
  float rs = round(s);
  float dx = abs(rx - axial.x);
  float dy = abs(ry - axial.y);
  float ds = abs(rs - s);
  if (dx > dy && dx > ds) rx = -ry - rs;
  else if (dy > ds) ry = -rx - rs;
  return vec2(rx, ry);
}

vec2 axialToCart(vec2 axial) {
  float x = (3.0 / 2.0) * axial.x;
  float y = (sqrt(3.0) / 2.0) * axial.x + sqrt(3.0) * axial.y;
  return vec2(x, y);
}

// Simple hash for cell flash
float hash2(vec2 v) {
  return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  // Normalized coords centered, aspect-corrected
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  // Level breathing: subtle scale
  float breathe = 1.0 + uLevel * 0.06;
  uv /= breathe;

  // Hex grid size
  float hexSize = 0.18;
  vec2 scaled = uv / hexSize;

  // Convert to axial coords and round to nearest hex center
  vec2 axial = hexAxial(scaled);
  vec2 cell = axialRound(axial);

  // Cartesian center of this cell (in scaled space)
  vec2 cellCartScaled = axialToCart(cell);
  // Offset within cell (in scaled space)
  vec2 localScaled = scaled - cellCartScaled;

  // Distance to nearest edge in local hex space (pointy-top hex)
  // Hex edge distance: min over 3 axes of (1 - |projection|)
  float ax = abs(localScaled.x) * (2.0 / 3.0);
  float bx = abs(dot(localScaled, vec2(1.0 / 3.0,  sqrt(3.0) / 3.0)));
  float cx = abs(dot(localScaled, vec2(1.0 / 3.0, -sqrt(3.0) / 3.0)));
  float edgeDist = 1.0 - max(ax, max(bx, cx));
  // edgeDist: ~0 near edge, ~1 near center (normalized so cell boundary = 0)

  // Ripple: propagates from center based on cell distance from origin
  vec2 cellCenter = axialToCart(cell) * hexSize;
  float distFromOrigin = length(cellCenter);
  float ripple = sin(distFromOrigin * 6.0 - uTime * 3.0 - uBass * 4.0);

  // Cell fill color from ripple phase
  float fillMix = 0.5 + 0.5 * ripple;
  vec3 fillColor = mix(uPrimary, uAccent, fillMix);

  // Beat flash: cells whose hash < uBeat get accent boost
  float cellHash = hash2(cell);
  float flashAmount = step(cellHash, uBeat * 0.8);
  fillColor = mix(fillColor, uAccent, flashAmount * 0.7);

  // Edge glow with treble shimmer
  float edgeWidth = 0.12 + uTreble * 0.10;
  float edgeGlow = smoothstep(0.0, edgeWidth, edgeDist);
  // Invert: glow is strong near edges
  float edgeMask = 1.0 - edgeGlow;
  // Treble shimmer: modulate edge brightness along time
  float shimmer = 0.5 + 0.5 * sin(distFromOrigin * 10.0 - uTime * 5.0);
  vec3 edgeColor = uAccent * (1.0 + uTreble * shimmer * 1.5);

  // Combine fill and edge
  vec3 col = mix(fillColor, edgeColor, edgeMask * 0.85);

  // Clip outside hex boundary with a soft mask
  float hexMask = smoothstep(0.0, 0.02, edgeDist - 0.0);
  col *= hexMask;

  // Overall level brightness
  col *= 0.75 + uLevel * 0.35;

  fragColor = vec4(col, 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uLevel', 'uBass', 'uTreble', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createHexGridPulse(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'hex-grid-pulse',
    name: 'Hex Grid Pulse',
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
