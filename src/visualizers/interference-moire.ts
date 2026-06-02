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

float grating(vec2 uv, vec2 dir, float freq) {
  return sin(dot(uv, dir) * freq);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  // Base grating frequency driven by bass; snapped by beat for rhythmic punch
  float freq = 18.0 + uBass * 24.0;

  // Beat snaps the rotation angle in discrete steps for rhythmic grid shifts
  float beatSnap = floor(uBeat * 6.0 + 0.5) / 6.0;
  float snapAngle = beatSnap * 1.5708; // pi/2 steps

  // Continuous rotation driven by mid; beat injects a discrete angle snap
  float angle = uTime * (0.18 + uMid * 0.55) + snapAngle;

  // Grating 1: fixed horizontal direction
  vec2 dir1 = vec2(1.0, 0.0);

  // Grating 2: rotated by angle
  vec2 dir2 = vec2(cos(angle), sin(angle));

  float g1 = grating(uv, dir1, freq);
  float g2 = grating(uv, dir2, freq);

  // Moire pattern: product emphasises constructive/destructive interference
  float moire = g1 * g2;

  // Treble sharpens the band edges via a power curve
  float sharpness = 1.0 + uTreble * 5.0;
  float bands = sign(moire) * pow(abs(moire), 1.0 / sharpness);

  // Map [-1,1] -> [0,1]
  float t = 0.5 + 0.5 * bands;

  // Color: primary for dark bands, accent for constructive peaks
  vec3 col = mix(uPrimary, uAccent, t);

  // Constructive interference bloom: brighten where both gratings are near +1
  float bloom = smoothstep(0.6, 1.0, moire) * (0.4 + uTreble * 0.6);
  col += uAccent * bloom;

  // Subtle diagonal secondary grating for extra moiré depth
  vec2 dir3 = vec2(cos(angle * 0.5 + 0.7854), sin(angle * 0.5 + 0.7854));
  float g3 = grating(uv, dir3, freq * 1.41);
  float secondary = 0.5 + 0.5 * (g1 * g3);
  col = mix(col, uPrimary * secondary, 0.18);

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uBass', 'uMid', 'uTreble', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createInterferenceMoire(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

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
