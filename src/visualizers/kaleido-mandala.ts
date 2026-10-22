import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Kaleidoscope mandala: the plane is folded into a fixed 8-fold mirrored wedge, then an
// iterated fract() fold draws glowing lace rings inside it, colored from the live palette.
// Rotation and the ring flow are phases accumulated on the CPU (audio sets the rate,
// one-way), so the symmetry never snaps and the image never jitters. Each kick sends a
// bright shockwave ring outward, flares the lace and pulses the core.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uRot;      // accumulated rotation
uniform float uPhase;    // accumulated lace flow phase
uniform float uKickAge;  // seconds since the last kick (CPU rising edge)
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

const float TWO_PI = 6.28318530717959;
const float N = 8.0;

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  float r = length(uv);
  float a = atan(uv.y, uv.x) + uRot;

  // fold into one mirrored wedge
  float sector = TWO_PI / N;
  a = mod(a, sector);
  a = abs(a - sector * 0.5);
  // small kick "breath" (< 5 % scale) so the lace leans outward on the hit
  vec2 p = vec2(cos(a), sin(a)) * r * (1.0 - uBeat * 0.04);

  // iterated fold: glowing lace rings
  float glowGain = 1.0 + uBeat * 1.4 + uBass * 0.3;
  vec3 col = vec3(0.0);
  vec2 q = p * 1.1;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    q = fract(q * 1.5) - 0.5;
    float d = length(q) * exp(-r * 1.4);
    float w = abs(sin(d * 8.0 + uPhase + fi * 0.7)) / 8.0;
    float glow = 0.0105 / (w + 0.007);
    glow *= glow;
    vec3 c = mix(uPrimary, uAccent, 0.5 + 0.5 * cos(TWO_PI * (r * 0.9 + fi * 0.22) - uPhase * 0.15));
    col += c * glow * glowGain * (0.5 - fi * 0.08);
  }
  // treble shimmer on the outer lace
  col *= 1.0 + uTreble * 0.3 * smoothstep(0.3, 0.8, r);
  // faint palette haze behind the lace so the backdrop is not a void
  col += mix(uPrimary, uAccent, smoothstep(0.0, 0.8, r)) * 0.07 * (1.0 - smoothstep(0.0, 0.9, r));

  // kick shockwave ring
  float ringR = uKickAge * 1.1;
  float ring = exp(-pow((r - ringR) * 16.0, 2.0)) * exp(-uKickAge * 3.0);
  col += mix(uAccent, vec3(1.0), 0.4) * ring * 1.2;

  // core glow pulses with the kick
  col += mix(uPrimary, vec3(1.0), 0.3) * exp(-r * 7.0) * (0.25 + uBeat * 0.9);

  // soft tone map keeps the brightest lace from flattening to white
  col = 1.0 - exp(-col * 1.1);
  col *= 1.0 - smoothstep(0.65, 1.15, r);

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uRot', 'uPhase', 'uKickAge', 'uBass', 'uTreble', 'uBeat',
  'uPrimary', 'uAccent',
] as const;

export function createKaleidoMandala(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let rot = 0; // rotation (only ever increases)
  let phase = 0; // lace flow (only ever increases)
  let kickAge = 10;
  let prevBeat = 0;

  return {
    id: 'kaleido-mandala',
    name: 'Kaleidoscope Mandala',
    init(context: VisualizerContext) {
      ctx = context;
      gl = context.gl;
      program = context.compileFragment(FRAG);
      for (const name of NAMES) u[name] = gl.getUniformLocation(program, name);
    },
    resize() {},
    render(frame: RenderFrame) {
      const a = frame.audio;
      rot += (0.05 + a.mid * 0.05 + a.beat * 0.35) * frame.dt;
      phase += (0.5 + a.level * 0.7 + a.beat * 3.0) * frame.dt;
      kickAge += frame.dt;
      if (a.beat > 0.85 && prevBeat <= 0.85) kickAge = 0;
      prevBeat = a.beat;

      gl.useProgram(program);
      ctx.quad.bind(program);
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uRot, rot);
      gl.uniform1f(u.uPhase, phase);
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
