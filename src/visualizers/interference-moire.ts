import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Two sets of fine concentric rings (primary and accent) from two slowly drifting centers,
// stacked like transparencies. Their difference frequency is the moire: large hyperbolic
// fringes that sweep across the screen when either ring set moves. Ring travel is an
// accumulated phase per set (audio sets the rate, one-way); a kick surges set A outward,
// which sweeps the moire fringes and flashes the coincidence highlights.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform vec2 uCA;        // ring centers (CPU, slow time-only drift)
uniform vec2 uCB;
uniform float uPhaseA;   // accumulated ring phases
uniform float uPhaseB;
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

const float RINGS = 22.0 * 6.28318530718; // ring angular frequency (rings per unit)

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  float pa = length(uv - uCA) * RINGS - uPhaseA;
  float pb = length(uv - uCB) * RINGS - uPhaseB;

  // thin ring lines; bass thickens them (lower exponent), treble keeps them crisp
  float sharp = 5.0 - uBass * 1.8 + uTreble * 0.8;
  float ga = pow(0.5 + 0.5 * cos(pa), sharp);
  float gb = pow(0.5 + 0.5 * cos(pb), sharp);

  // the moire term the eye sees: low-frequency difference of the two ring phases.
  // Crest bands glow, the bands between them fall dark.
  float fringe = 0.5 + 0.5 * cos(pa - pb);
  float band = 0.15 + 1.0 * fringe * fringe;

  vec3 col = mix(uPrimary, uAccent, 0.5) * 0.03;
  col += uPrimary * ga * 0.7 * band;
  col += uAccent * gb * 0.7 * band;
  // where the rings coincide (fringe crests) they burn bright; the kick flashes it
  col += mix(uPrimary, uAccent, 0.5 + 0.5 * uv.x) * fringe * fringe * fringe
       * (0.12 + uBass * 0.08 + uBeat * 0.35);
  col += vec3(1.0) * ga * gb * band * (0.35 + uBeat * 0.9);

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uCA', 'uCB', 'uPhaseA', 'uPhaseB', 'uBass', 'uTreble', 'uBeat',
  'uPrimary', 'uAccent',
] as const;

export function createInterferenceMoire(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let phaseA = 0; // ring travel phases (only ever increase)
  let phaseB = 0;

  return {
    id: 'interference-moire',
    name: 'Moire Interference',
    init(context: VisualizerContext) {
      ctx = context;
      gl = context.gl;
      program = context.compileFragment(FRAG);
      for (const name of NAMES) u[name] = gl.getUniformLocation(program, name);
    },
    resize() {},
    render(frame: RenderFrame) {
      const a = frame.audio;
      // both sets flow outward; A runs a bit faster and takes the kick surge, so the
      // fringes drift calmly and sweep on every kick
      phaseA += (0.9 + a.level * 0.8 + a.beat * 16.0) * frame.dt;
      phaseB += (0.6 + a.level * 0.6 + a.mid * 0.4) * frame.dt;
      const t = frame.time;
      const sep = 0.05 + 0.02 * Math.sin(t * 0.05); // half the center distance

      gl.useProgram(program);
      ctx.quad.bind(program);
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform2f(u.uCA, -sep + Math.sin(t * 0.11) * 0.025, Math.cos(t * 0.07) * 0.03);
      gl.uniform2f(u.uCB, sep + Math.cos(t * 0.09) * 0.025, Math.sin(t * 0.13) * 0.03);
      gl.uniform1f(u.uPhaseA, phaseA);
      gl.uniform1f(u.uPhaseB, phaseB);
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
