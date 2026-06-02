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

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

// SDF: distance to a quarter-circle arc of radius r centered at corner,
// returning signed distance where 0 = on the arc.
float arcSDF(vec2 p, vec2 corner, float r) {
  vec2 d = p - corner;
  return abs(length(d) - r);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  // Maintain aspect
  float aspect = uResolution.x / uResolution.y;
  vec2 st = vec2(uv.x * aspect, uv.y);

  // Tile parameters
  float tileCount = 8.0;
  vec2 tiled = st * tileCount;
  vec2 cell = floor(tiled);
  vec2 local = fract(tiled); // [0,1) within cell

  // Beat-driven re-randomization: snap beat phase to integer steps
  float beatPhase = floor(uBeat * 4.0);
  float h = hash(cell + beatPhase);

  // Two Truchet orientations: arc from (0,1) to (1,0), or from (0,0) to (1,1)
  // Orientation 0: arcs at corners (0,0) and (1,1)
  // Orientation 1: arcs at corners (1,0) and (0,1)
  float orientation = step(0.5, h);

  float dist;
  if (orientation < 0.5) {
    // Corner arcs at (0,0) and (1,1)
    float d0 = arcSDF(local, vec2(0.0, 0.0), 1.0);
    float d1 = arcSDF(local, vec2(1.0, 1.0), 1.0);
    dist = min(d0, d1);
  } else {
    // Corner arcs at (1,0) and (0,1)
    float d0 = arcSDF(local, vec2(1.0, 0.0), 1.0);
    float d1 = arcSDF(local, vec2(0.0, 1.0), 1.0);
    dist = min(d0, d1);
  }

  // Line width driven by uBass
  float lineWidth = 0.04 + uBass * 0.07;

  // Arc angle for flow pulse: compute angle around active corner
  vec2 activeCorner;
  if (orientation < 0.5) {
    // pick nearest corner between (0,0) and (1,1)
    float d0 = length(local - vec2(0.0, 0.0));
    float d1 = length(local - vec2(1.0, 1.0));
    activeCorner = (d0 < d1) ? vec2(0.0, 0.0) : vec2(1.0, 1.0);
  } else {
    float d0 = length(local - vec2(1.0, 0.0));
    float d1 = length(local - vec2(0.0, 1.0));
    activeCorner = (d0 < d1) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  }
  float angle = atan(local.y - activeCorner.y, local.x - activeCorner.x);
  // Normalize angle to [0,1] over pi/2 range
  float normAngle = (angle + 3.14159265 * 0.5) / (3.14159265 * 0.5);

  // Flowing energy pulse along arc length using uTime + uMid
  float flow = uTime * 0.6 + uMid * 2.0;
  float pulse = 0.5 + 0.5 * sin((normAngle - flow) * 6.28318 * 2.0 + hash(cell) * 6.28318);

  // Smooth line SDF
  float line = smoothstep(lineWidth, lineWidth * 0.3, dist);

  // Treble bloom: widen glow
  float bloom = smoothstep(lineWidth * 3.0 + uTreble * 0.15, 0.0, dist) * uTreble * 0.6;

  // Background: dark primary tint
  vec3 bg = uPrimary * 0.12;

  // Arc color: accent modulated by flow pulse
  vec3 arcColor = mix(uAccent * 0.5, uAccent, pulse);
  arcColor += uPrimary * 0.3 * pulse;

  // Treble bloom adds bright halo
  vec3 bloomColor = uAccent * bloom;

  vec3 col = mix(bg, arcColor, line) + bloomColor;

  // Subtle overall glow from uTreble
  col += uPrimary * 0.05 * uTreble;

  fragColor = vec4(col, 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uBass', 'uMid', 'uTreble', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createTruchetWeave(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'truchet-weave',
    name: 'Truchet Arc Weave',
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
