import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Crisp glowing honeycomb: dark beveled hex cells with bright neon edges. Every kick launches
// a ripple from the screen center that travels outward cell by cell, lighting each cell's
// fill and edges as it passes (up to four ripples in flight). Between kicks a slow idle
// wave (accumulated phase) and per-cell twinkle keep the grid alive; bass lifts the edge glow.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uPhase;    // accumulated idle wave phase
uniform vec4 uKickAge;   // seconds since each of the last 4 kicks (large = none)
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

const float SCALE = 6.5; // cells across the short screen side

// Hex grid from two offset rectangular lattices: returns (local offset, cell id)
vec4 hexCell(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec2 h = s * 0.5;
  vec2 a = mod(p, s) - h;
  vec2 b = mod(p - h, s) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  return vec4(gv, p - gv);
}

// 0 at the cell center, 0.5 on the edges
float hexDist(vec2 p) {
  p = abs(p);
  return max(dot(p, vec2(0.5, 0.8660254)), p.x);
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  float minRes = min(uResolution.x, uResolution.y);
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / minRes;
  vec4 h = hexCell(uv * SCALE);
  vec2 gv = h.xy;
  vec2 id = h.zw;
  float edgeD = 0.5 - hexDist(gv);   // distance to the cell edge (cell units)
  float px = SCALE / minRes;         // one pixel in cell units
  float cellR = length(id) / SCALE;  // cell center distance from the screen center

  // kick ripples: a band of cells around each expanding front
  float rip = 0.0;
  for (int i = 0; i < 4; i++) {
    float age = uKickAge[i];
    float front = age * 0.85;
    rip += exp(-pow((cellR - front) * 6.0, 2.0)) * exp(-age * 1.4);
  }
  rip = min(rip, 1.5);

  // idle wave + per-cell twinkle
  float idle = 0.5 + 0.5 * sin(cellR * 9.0 - uPhase);
  float tw = hash21(id);
  float twinkle = smoothstep(0.75, 1.0, sin(tw * 40.0 + uPhase * (0.6 + tw)) * 0.5 + 0.5);

  // cell fill: dark bevel that lights up as a ripple passes
  float bevel = 0.65 + 0.35 * smoothstep(0.0, 0.35, edgeD);
  vec3 fillCol = mix(uPrimary, uAccent, clamp(rip * 0.8 + tw * 0.2, 0.0, 1.0));
  float fillI = 0.05 + idle * 0.05 + twinkle * uTreble * 0.12 + rip * 0.6;
  vec3 col = mix(uPrimary, uAccent, 0.5) * 0.02;
  col += fillCol * fillI * bevel;

  // neon edge: crisp line plus soft inner glow
  float lw = 0.035;
  float line = 1.0 - smoothstep(lw - px, lw + px, edgeD);
  float glow = exp(-edgeD * 14.0);
  float edgeI = 0.3 + uBass * 0.2 + idle * 0.12 + rip * 0.9;
  vec3 edgeCol = mix(uAccent, mix(uPrimary, vec3(1.0), 0.5), clamp(rip * 0.6, 0.0, 1.0));
  col += edgeCol * (line * 0.8 + glow * 0.3) * edgeI;

  col *= 0.95 + uBeat * 0.2;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uPhase', 'uKickAge', 'uBass', 'uTreble', 'uBeat', 'uPrimary', 'uAccent',
] as const;

export function createHexGridPulse(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let phase = 0; // idle wave phase (only ever increases)
  const kicks = [10, 10, 10, 10]; // ages of the last 4 kicks, newest first
  let prevBeat = 0;

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
      const a = frame.audio;
      phase += (0.8 + a.level * 0.8) * frame.dt;
      for (let i = 0; i < 4; i++) kicks[i] += frame.dt;
      if (a.beat > 0.85 && prevBeat <= 0.85) {
        kicks.pop();
        kicks.unshift(0);
      }
      prevBeat = a.beat;

      gl.useProgram(program);
      ctx.quad.bind(program);
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uPhase, phase);
      gl.uniform4f(u.uKickAge, kicks[0], kicks[1], kicks[2], kicks[3]);
      gl.uniform1f(u.uBass, a.bass);
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
