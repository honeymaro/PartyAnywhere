import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uTravel;
uniform float uSpin;
uniform float uLevel;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

// cheap value-noise + 4-octave fbm (int loop only)
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i + vec2(0.0, 0.0));
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    s += amp * vnoise(p);
    p *= 2.02;
    amp *= 0.5;
  }
  return s;
}

// Compute the glowing wall intensity at a given depth/angle.
// Sampled once per color channel for chromatic aberration.
float walls(float depth, float a, float r) {
  // sharp emissive depth rings: bright thin bands repeating along the tunnel
  float dband = fract(depth);
  float rings = pow(smoothstep(0.5, 0.0, abs(dband - 0.5)), 6.0);
  // angular neon ribs that twist with depth
  float ang = a * 6.0 + depth * 1.5;
  float ribs = pow(0.5 + 0.5 * sin(ang), 8.0);
  // moving longitudinal streaks for extra structure
  float streaks = pow(0.5 + 0.5 * sin(a * 12.0 - depth * 4.0), 16.0) * 0.6;
  // wall noise breakup so it doesn't read as a flat grid.
  // Sample on circular coords (cos a, sin a) so the noise is seamless across the
  // 0deg/360deg wrap (raw angle into noise would tear at the -x axis); depth scrolls it.
  float n = fbm(vec2(cos(a), sin(a)) * 1.6 + vec2(depth * 1.5)) * 0.5 + 0.5;
  float wall = (rings * 1.2 + ribs * 0.9 + streaks) * n;
  // fade walls near the throat so the center reads as open glow
  wall *= smoothstep(0.0, 0.18, r);
  return wall;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  float r = length(uv);
  float a = atan(uv.y, uv.x);

  // Twist AMOUNT stays constant — letting the audio change it wound/unwound the spiral
  // (the back-and-forth wobble). Rotation SPEED is audio-reactive but accumulated (uSpin),
  // so the music only speeds it up / slows it down in one direction, never reversing.
  float swirl = 1.4;
  a += swirl / (r + 0.15) + uSpin;

  // forward flight: 1/r depth illusion. uTravel is an ever-increasing distance
  // accumulated on the CPU (speed*dt), so the music only changes HOW FAST we fall in —
  // it can never run backward. (uTime * audioSpeed pistoned in/out: a dip in the
  // audio-driven speed, multiplied by the large absolute time, yanked the field back.)
  float baseDepth = 1.0 / (r + 0.06) + uTravel;

  // treble drives the chromatic split (a per-channel depth offset → color fringe, not motion)
  float ca = (0.06 + uTreble * 0.35) / (r + 0.2);

  // chromatic aberration: offset the wall sample per channel
  float wr = walls(baseDepth + ca, a, r);
  float wg = walls(baseDepth, a, r);
  float wb = walls(baseDepth - ca, a, r);

  // color the walls by mixing primary<->accent along depth.
  // Use a (integer x1) not a*0.5 in the angular term — a non-integer multiple of the
  // angle is discontinuous across the +/-PI seam and would show a hard color edge.
  float mixT = 0.5 + 0.5 * sin(baseDepth * 0.6 + a);
  vec3 wallCol = mix(uPrimary, uAccent, mixT);

  // additive neon glow, tinted per-channel from the CA samples
  vec3 col = vec3(0.0);
  col += wallCol * vec3(wr, wg, wb) * 1.6;

  // throat glow: bright bloom at the center, pulsed by bass + beat
  float glow = pow(smoothstep(0.65, 0.0, r), 3.0);
  float throatPulse = 0.5 + uBass * 1.6 + uBeat * 3.0;
  vec3 throatCol = mix(uAccent, uPrimary, 0.3 + 0.5 * uBass);
  col += throatCol * glow * throatPulse;

  // faint inner haze so the open throat isn't pure black
  col += mix(uPrimary, uAccent, 0.5) * smoothstep(0.9, 0.0, r) * 0.12;

  // depth fog / vignette: pull the eye inward, darken the rim
  float fog = smoothstep(0.95, 0.15, r);
  col *= mix(0.25, 1.0, fog);

  // subtle exposure lift with the music so quiet passages stay visible
  col *= 0.9 + uLevel * 0.4 + uBeat * 0.6;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = ['uResolution','uTime','uTravel','uSpin','uLevel','uBass','uMid','uTreble','uBeat','uPrimary','uAccent'] as const;

export function createWormholeNeon(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let travel = 0; // accumulated fly-in distance (integrated from speed*dt; only ever increases)
  let spin = 0; // accumulated rotation angle (audio modulates the RATE, never the direction)
  return {
    id: 'wormhole-neon',
    name: 'Neon Wormhole',
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
      // uBeat is the sharp onset pulse — feed it into the RATES so each beat whooshes us
      // faster inward and spins harder. It's a one-way surge (never reverses), so it reads
      // as rhythm, not the in/out piston.
      travel += (0.4 + frame.audio.level * 0.8 + frame.audio.bass * 0.6 + frame.audio.beat * 2.4) * frame.dt;
      gl.uniform1f(u.uTravel, travel);
      spin += (0.15 + frame.audio.mid * 0.9 + frame.audio.level * 0.4 + frame.audio.beat * 1.6) * frame.dt;
      gl.uniform1f(u.uSpin, spin);
      gl.uniform1f(u.uLevel, frame.audio.level);
      gl.uniform1f(u.uBass, frame.audio.bass);
      gl.uniform1f(u.uMid, frame.audio.mid);
      gl.uniform1f(u.uTreble, frame.audio.treble);
      gl.uniform1f(u.uBeat, frame.audio.beat);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() { gl.deleteProgram(program); },
  };
}
