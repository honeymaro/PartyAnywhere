import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Classic Truchet weave: every tile holds two quarter arcs of radius 0.5 joining edge
// midpoints, randomly mirrored, so the arcs link into long winding ribbons. Ribbons are
// shaded like tubes, with energy dashes flowing along them; a checkerboard sign keeps the
// flow direction continuous from tile to tile. The tiling is fixed (never re-randomized);
// it only drifts slowly. Flow and drift are phases accumulated on the CPU (audio sets the
// rate, one-way). Each kick surges the flow, flares the dashes and sends a bright ring
// across the weave from the center; bass thickens the ribbons slightly.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uFlow;     // accumulated flow phase along the ribbons
uniform vec2 uDrift;     // accumulated tiling drift
uniform float uKickAge;  // seconds since the last kick (CPU rising edge)
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

const float TILES = 7.0; // tiles across the screen height

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  vec2 st = uv * TILES + uDrift;
  vec2 id = floor(st);
  vec2 gv = fract(st) - 0.5;

  // random mirror picks one of the two Truchet orientations
  if (hash(id) < 0.5) gv.x = -gv.x;
  float checker = mod(id.x + id.y, 2.0) * 2.0 - 1.0;

  // nearest of the two corner arcs (radius 0.5)
  float s = gv.x + gv.y > 0.0 ? 1.0 : -1.0;
  vec2 cuv = gv - s * 0.5;
  float d = abs(length(cuv) - 0.5);
  float ang = atan(cuv.x, cuv.y);

  float px = TILES / uResolution.y;
  float w = 0.12 + uBass * 0.03;  // ribbon half-width (tile units)
  float tube = 1.0 - smoothstep(w - px, w + px, d);
  float x = clamp(d / w, 0.0, 1.0);
  float shade = sqrt(1.0 - x * x);  // cylindrical shading across the ribbon

  // energy dashes flowing along the ribbons (8 = continuous across tile edges)
  float dash = 0.5 + 0.5 * sin(checker * ang * 8.0 + uFlow);
  dash = pow(dash, 4.0);

  // kick ring sweeping outward across the weave
  float r = length(uv);
  float ring = exp(-pow((r - uKickAge * 1.3) * 7.0, 2.0)) * exp(-uKickAge * 2.2);

  // ribbon color varies smoothly across the screen between the palette colors
  float hueT = 0.5 + 0.5 * sin(uv.x * 2.2 + uv.y * 1.3 + uFlow * 0.05);
  vec3 ribbon = mix(uPrimary, uAccent, hueT);

  vec3 col = mix(uPrimary, uAccent, 0.5) * 0.03;
  // soft halo around the ribbons
  col += ribbon * exp(-max(d - w, 0.0) * 18.0) * (1.0 - tube) * (0.18 + uBeat * 0.25 + ring * 0.4);
  vec3 tubeCol = ribbon * (0.25 + 0.6 * shade);
  tubeCol += mix(ribbon, vec3(1.0), 0.5) * dash * shade * (0.35 + uBeat * 0.9 + uTreble * 0.15);
  tubeCol += mix(uAccent, vec3(1.0), 0.5) * ring * shade * 0.9;
  col = mix(col, tubeCol, tube);

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uFlow', 'uDrift', 'uKickAge', 'uBass', 'uTreble', 'uBeat',
  'uPrimary', 'uAccent',
] as const;

export function createTruchetWeave(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let flow = 0; // dash flow phase (only ever increases)
  let drift = 0; // tiling drift (only ever increases)
  let kickAge = 10;
  let prevBeat = 0;

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
      const a = frame.audio;
      flow += (1.5 + a.mid * 1.5 + a.beat * 9.0) * frame.dt;
      drift += (0.05 + a.level * 0.05) * frame.dt;
      kickAge += frame.dt;
      if (a.beat > 0.85 && prevBeat <= 0.85) kickAge = 0;
      prevBeat = a.beat;

      gl.useProgram(program);
      ctx.quad.bind(program);
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uFlow, flow);
      gl.uniform2f(u.uDrift, drift, drift * 0.6);
      gl.uniform1f(u.uKickAge, kickAge);
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
