import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Classic sum-of-sines plasma in the live palette. The flow phase is accumulated on the CPU
// (audio sets the rate, one-way), so the bands never jitter back and forth. Troughs sink to a
// deep palette shade for contrast, crests glow. Each kick fires a shockwave ring from the
// center that locally bends the bands and flashes the crests.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uPhase;    // accumulated flow phase (audio modulates the rate)
uniform float uKickAge;  // seconds since the last kick (CPU rising edge)
uniform vec2 uCenter;    // drifting center of the radial term (CPU, time only)
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  float t = uPhase;
  float r = length(uv);

  // kick shockwave: a ring expanding from the center, fading as it travels
  float ringR = uKickAge * 1.5;
  float ring = exp(-pow((r - ringR) * 6.0, 2.0)) * exp(-uKickAge * 2.5);

  float v = sin(uv.x * 3.1 + t)
          + sin(uv.y * 3.7 - t * 0.8)
          + sin((uv.x + uv.y) * 2.3 + t * 1.3)
          + sin(length(uv - uCenter) * 5.5 - t * 1.1);
  v += ring * 2.0; // the shockwave locally bends the bands, then they settle back

  float m = 0.5 + 0.5 * sin(v * 1.2);

  // deep troughs -> primary -> accent crests
  vec3 deep = mix(uPrimary, uAccent, 0.5) * 0.07;
  vec3 col = mix(deep, uPrimary, smoothstep(0.05, 0.55, m));
  col = mix(col, uAccent, smoothstep(0.5, 0.95, m));

  // crest glow: bass lifts it, the beat flashes it
  float crest = pow(m, 8.0);
  col += mix(uAccent, vec3(1.0), 0.3) * crest * (0.05 + uBass * 0.12 + uBeat * 0.45);
  col += mix(uPrimary, vec3(1.0), 0.5) * ring * 0.8;
  col += uTreble * 0.03 * m;
  col *= 0.82 + uBeat * 0.45;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uPhase', 'uKickAge', 'uCenter', 'uBass', 'uTreble', 'uBeat',
  'uPrimary', 'uAccent',
] as const;

export function createPlasmaWave(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let phase = 0; // flow phase (only ever increases)
  let kickAge = 10; // seconds since the last kick
  let prevBeat = 0;

  return {
    id: 'plasma-wave',
    name: 'Plasma Wave',
    init(context: VisualizerContext) {
      ctx = context;
      gl = context.gl;
      program = context.compileFragment(FRAG);
      for (const name of NAMES) u[name] = gl.getUniformLocation(program, name);
    },
    resize() {},
    render(frame: RenderFrame) {
      const a = frame.audio;
      phase += (0.3 + a.level * 0.35 + a.beat * 0.9) * frame.dt;
      kickAge += frame.dt;
      if (a.beat > 0.85 && prevBeat <= 0.85) kickAge = 0;
      prevBeat = a.beat;

      gl.useProgram(program);
      ctx.quad.bind(program);
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uPhase, phase);
      gl.uniform1f(u.uKickAge, kickAge);
      gl.uniform2f(u.uCenter, Math.sin(phase * 0.37) * 0.45, Math.cos(phase * 0.29) * 0.45);
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
