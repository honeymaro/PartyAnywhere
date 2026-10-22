import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { AudioFrame, RenderFrame } from '../core/types';

// Concentric gradient rings that flow outward from the center (accumulated uFlow; the
// audio only sets the rate). Every detected onset launches a bright shockwave ring that
// races outward and bends the bands as it passes, plus a center bloom; bass widens and
// brightens the ring crests.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uFlow;    // accumulated outward ring travel (audio modulates the rate)
uniform float uBass;
uniform float uBeat;
uniform vec4 uKickAge;  // seconds since the last 4 onsets (newest first)
uniform vec4 uKickAmp;  // their strengths 0..1
uniform vec3 uPrimary;
uniform vec3 uAccent;

const float TWO_PI = 6.28318530718;
const float SW_SPEED = 0.95; // shockwave radius growth per second

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  float d = length(uv);
  float a = atan(uv.y, uv.x);

  // Shockwaves: thin bright rings riding outward from each onset. They also push the
  // bands outward locally (a refraction-like bulge that returns to rest).
  float shock = 0.0;
  float push = 0.0;
  float flash = 0.0;
  for (int i = 0; i < 4; i++) {
    float age = uKickAge[i];
    float amp = uKickAmp[i] * exp(-age * 2.2);
    float w = 0.012 + age * 0.035;
    float x = (d - age * SW_SPEED) / w;
    float g = exp(-x * x);
    shock += amp * g;
    push += amp * g * w;
    flash += uKickAmp[i] * exp(-age * 9.0);
  }

  // gentle organic wobble of the ring shape (accumulated phase, never audio-added)
  float wob = 0.016 * sin(3.0 * a + uFlow * 0.9) + 0.01 * sin(5.0 * a - uFlow * 0.55);
  float dr = d + wob * smoothstep(0.0, 0.35, d) - push * 0.9;

  // gradient bands: crest sharpness and brightness ride the bass
  float bandPos = dr * 5.0 - uFlow;
  float band = 0.5 + 0.5 * cos(bandPos * TWO_PI);
  float crest = pow(band, mix(5.0, 2.2, uBass));
  // adjacent crests alternate primary / accent with a smooth blend in between
  vec3 bandCol = mix(uPrimary, uAccent, 0.5 + 0.5 * cos(bandPos * 3.14159265));
  float env = smoothstep(0.03, 0.22, d) * smoothstep(1.25, 0.35, d);

  vec3 col = vec3(0.012, 0.012, 0.025) + mix(uPrimary, uAccent, 0.5) * 0.035;
  col += bandCol * (band * 0.12 + crest * (0.32 + uBass * 0.5)) * env;

  // shockwave rings: palette-tinted, hot white core
  vec3 swCol = mix(uAccent, vec3(1.0), 0.45);
  col += swCol * shock * 1.4;

  // center bloom: breathes with the bass, flares on each onset
  float core = exp(-d * d * 22.0);
  col += mix(uAccent, uPrimary, 0.35) * core * (0.25 + uBass * 0.55 + flash * 0.9);
  col += vec3(1.0) * exp(-d * d * 90.0) * flash * 0.5;

  // brief exposure lift on the beat
  col *= 0.92 + uBeat * 0.18;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uFlow', 'uBass', 'uBeat', 'uKickAge', 'uKickAmp', 'uPrimary', 'uAccent',
] as const;

export function createGradientPulse(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let flow = 0; // outward ring travel (audio sets the rate; only ever increases)
  // Onset events detected on the CPU (rising edge), newest first.
  const kickAge = new Float32Array(4).fill(99);
  const kickAmp = new Float32Array(4);
  let prevBeat = 0;
  let prevBass = 0;

  function trackKicks(a: AudioFrame, dt: number): void {
    for (let i = 0; i < 4; i++) kickAge[i] += dt;
    const onset = (a.beat - prevBeat > 0.25 && a.beat > 0.6) || (a.bass - prevBass > 0.18 && a.bass > 0.7);
    const amp = Math.min(1, 0.3 + 0.7 * a.bass);
    if (onset && kickAge[0] > 0.1) {
      kickAge.copyWithin(1, 0);
      kickAmp.copyWithin(1, 0);
      kickAge[0] = 0;
      kickAmp[0] = amp;
    } else if (onset) {
      kickAmp[0] = Math.max(kickAmp[0], amp); // bass landed a frame after the onset
    }
    prevBeat = a.beat;
    prevBass = a.bass;
  }

  return {
    id: 'gradient-pulse',
    name: 'Gradient Pulse',

    init(context: VisualizerContext) {
      ctx = context;
      gl = context.gl;
      program = context.compileFragment(FRAG);
      for (const name of NAMES) u[name] = gl.getUniformLocation(program, name);
    },

    resize() {
      // Resolution is passed as a uniform each frame; nothing to cache here.
    },

    render(frame: RenderFrame) {
      gl.useProgram(program);
      ctx.quad.bind(program);
      const a = frame.audio;
      trackKicks(a, frame.dt);
      flow += (0.12 + a.level * 0.22 + a.bass * 0.25 + a.beat * 0.5) * frame.dt;
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uFlow, flow);
      gl.uniform1f(u.uBass, a.bass);
      gl.uniform1f(u.uBeat, a.beat);
      gl.uniform4fv(u.uKickAge, kickAge);
      gl.uniform4fv(u.uKickAmp, kickAmp);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },

    dispose() {
      gl.deleteProgram(program);
    },
  };
}
