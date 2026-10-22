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

// --- cheap hash / noise / fbm (procedural, no textures) ---
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i + vec2(0.0, 0.0));
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p *= 2.02;
    amp *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  // --- audio-driven, smoothed parameters (calm) ---
  // swirl is CONSTANT: an audio-driven twist wound/unwound the spiral = back-and-forth sway.
  float swirl = 0.6;
  float beat = clamp(uBeat, 0.0, 1.0);

  // --- fake gravitational lens: warp coords radially before the tunnel ---
  // Static magnification — pulsing this on the beat made the throat piston in/out.
  float r0 = length(uv);
  float k = 0.022;
  uv *= 1.0 + k / (r0 * r0 + 0.1);

  // --- polar plane-deformation tunnel ---
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  // gentle depth-coupled twist (constant amount) + audio-reactive one-way rotation whose
  // SPEED rides the mids via the accumulated uSpin (it never reverses → no wobble).
  a += swirl / (r + 0.2) + uSpin;
  // uTravel = CPU-accumulated fly-in distance (speed*dt); the music changes the rate
  // only, so it never reverses. (uTime * audioSpeed pistoned: speed dips, scaled by the
  // large absolute time, yanked the tunnel backward.)
  float depth = 1.0 / (r + 0.06) + uTravel;

  // --- nebula walls: soft cloudy gas on the tunnel wall ---
  // Sample on circular coords (cos a, sin a) so 0deg and 360deg meet seamlessly;
  // depth scrolls the noise field as we fly forward.
  vec2 ring = vec2(cos(a), sin(a));
  vec2 np = ring * 1.6 + vec2(depth * 0.6);
  float density = fbm(np + vec2(0.0, uTime * 0.05));
  density = mix(density, fbm(np * 1.7 - vec2(uTime * 0.08, 0.0)), 0.5);
  density = smoothstep(0.25, 0.95, density);

  // mix palette by density, dreamy
  vec3 neb = mix(uPrimary, uAccent, density);
  // fade nebula in toward the rim, out at the throat
  float wallFade = smoothstep(0.04, 0.55, r);
  vec3 col = neb * density * wallFade * (0.7 + uBass * 0.6);

  // --- starfield: sparse bright stars streaming toward the throat ---
  // Angle mapped to an integer number of cells (NA) and wrapped, so the seam at
  // +/-PI falls on a cell boundary that matches across 0deg/360deg.
  float ang01 = a * 0.15915494 + 0.5; // a / (2*PI) + 0.5
  float NA = 18.0;
  vec2 sp = vec2(depth * 1.3, ang01 * NA);
  vec2 cell = floor(sp);
  cell.y = mod(cell.y, NA);
  float star = hash21(cell);
  // keep sparse: only a few cells light up
  float twinkle = 0.5 + 0.5 * sin(uTime * 6.0 + hash11(star * 91.7) * 6.28);
  twinkle = mix(1.0, twinkle, uTreble);
  float starMask = smoothstep(0.985, 1.0, star);
  vec2 sf = fract(sp) - 0.5;
  float sd = exp(-dot(sf, sf) * 90.0);
  col += vec3(0.9, 0.95, 1.0) * starMask * sd * twinkle * (0.8 + uTreble * 0.6) * wallFade;

  // --- bright throat + soft bloom at center, pulsed by bass + beat ---
  float throat = pow(smoothstep(0.7, 0.0, r), 2.5);
  // kept moderate: with the new dynamic bass/beat the old gains blew the throat into a
  // large flat white disc on every kick
  float pulse = 0.3 + uBass * 0.45 + beat * 1.3;
  vec3 throatCol = mix(uAccent, vec3(1.0), 0.25);
  col += throatCol * throat * pulse;
  // soft outer bloom around the throat
  col += uPrimary * smoothstep(0.55, 0.0, r) * 0.18 * pulse;

  // --- subtle chromatic aberration near the rim (treble) ---
  float ca = uTreble * 0.02 * smoothstep(0.2, 0.7, r);
  col.r *= 1.0 + ca;
  col.b *= 1.0 - ca;

  // --- outer vignette / fog for depth ---
  float vig = smoothstep(1.15, 0.2, r);
  col *= mix(0.35, 1.0, vig);
  // distance fog toward far tunnel
  col = mix(col, uPrimary * 0.04, smoothstep(0.0, 1.2, r) * 0.4);

  col = 1.0 - exp(-col * 1.3);
  fragColor = vec4(col, 1.0);
}
`;

const NAMES = ['uResolution','uTime','uTravel','uSpin','uLevel','uBass','uMid','uTreble','uBeat','uPrimary','uAccent'] as const;

export function createWormholeCosmic(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let travel = 0; // accumulated fly-in distance (integrated from speed*dt; only ever increases)
  let spin = 0; // accumulated rotation angle (audio modulates the RATE, never the direction)
  return {
    id: 'wormhole-cosmic',
    name: 'Cosmic Wormhole',
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
      // beat surges the fly-in and spin (one-way) so each kick is felt as a whoosh inward.
      travel += (0.25 + frame.audio.level * 0.6 + frame.audio.beat * 1.6) * frame.dt;
      gl.uniform1f(u.uTravel, travel);
      spin += (0.05 + frame.audio.mid * 0.4 + frame.audio.beat * 0.9) * frame.dt;
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
