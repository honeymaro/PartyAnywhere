import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Looking down at a tiled pool floor through moving water: the classic iterated
// "water turbulence" caustic (a few rounds of sin/cos domain feedback) paints a bright
// net of focused sunlight over palette-tinted tiles that wobble with the refraction.
// Audio: the water flow rate is CPU-accumulated (one-way), level/bass brighten the
// light, and every kick drops a "pebble" whose ring ripple distorts and lights the net.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uFlow;     // accumulated water motion (audio = rate, one-way)
uniform float uKickAge;  // seconds since the last kick (large when none yet)
uniform vec2 uKickPos;   // where the last kick ripple started (height units)
uniform float uLevel;
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

// iterated water turbulence caustic: returns ~0 (dark) .. 1+ (focused light)
float caustic(vec2 p, float time) {
  vec2 i = p;
  float c = 1.0;
  const float inten = 0.005;
  for (int n = 0; n < 5; n++) {
    float t = time * (1.0 - 3.5 / float(n + 1));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
  }
  c /= 5.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 11.0) * 1.4;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution.y; // x: 0..aspect, y: 0..1
  vec2 center = vec2(0.5 * uResolution.x / uResolution.y, 0.5);

  // kick ripple: an expanding ring that pushes the water outward and fades
  vec2 kd = uv - uKickPos;
  float kr = length(kd);
  float front = kr - uKickAge * 0.75;
  float ring = exp(-front * front * 140.0) * exp(-uKickAge * 2.0);
  vec2 rippleOff = kd / max(kr, 1e-3) * ring * 0.035 * sin(front * 70.0);

  // surface refraction wobble (gentle, flow-driven)
  vec2 wob = 0.006 * vec2(sin(uv.y * 9.0 + uFlow * 1.3), sin(uv.x * 8.0 - uFlow * 1.1));

  // --- caustic light net ---
  vec2 p = (uv + rippleOff) * 7.0 - 250.0;
  float light = caustic(p, uFlow + 23.0);

  // --- tiled pool floor seen through the water ---
  vec2 tuv = (uv + wob + rippleOff * 0.5) * 8.0;
  vec2 tf = abs(fract(tuv) - 0.5);
  float grout = smoothstep(0.455, 0.49, max(tf.x, tf.y));
  float tileVar = fract(sin(dot(floor(tuv), vec2(12.9898, 78.233))) * 43758.5453);
  vec3 water = uPrimary * (0.26 + tileVar * 0.04);
  vec3 col = mix(water, water * 0.7, grout);

  // depth falloff toward the frame edges (deeper water, darker)
  float vig = smoothstep(1.25, 0.25, length(uv - center));
  col *= 0.55 + 0.45 * vig;

  // light gain rides the music: brighter with level/bass, surges on each kick
  float gain = 0.6 + uLevel * 0.4 + uBass * 0.5 + uBeat * 1.0;
  vec3 lightCol = mix(uPrimary, vec3(1.0), 0.5);
  col += lightCol * light * gain * (0.65 + 0.35 * vig);
  col += vec3(1.0) * light * light * light * gain * 0.35;   // hot white filament cores
  // the ripple ring itself glints in the accent color
  col += mix(uAccent, vec3(1.0), 0.3) * ring * (0.35 + light * 1.2);
  // faint treble sparkle on the brightest filaments
  col += vec3(1.0) * smoothstep(0.6, 1.0, light) * uTreble * 0.2;

  col = 1.0 - exp(-col * 1.3);
  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uFlow', 'uKickAge', 'uKickPos', 'uLevel', 'uBass', 'uTreble', 'uBeat',
  'uPrimary', 'uAccent',
] as const;

export function createCausticsPool(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let flow = 0; // water motion phase (audio modulates the rate; only ever increases)
  let prevBeat = 0;
  let kickAge = 99; // seconds since the last kick (rising edge of the beat pulse)
  let kickCount = 0;

  return {
    id: 'caustics-pool',
    name: 'Refractive Caustics Pool',
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
      const a = frame.audio;
      flow += (0.3 + a.level * 0.25 + a.mid * 0.15 + a.beat * 0.6) * frame.dt;
      kickAge += frame.dt;
      if (a.beat > 0.85 && prevBeat <= 0.85 && kickAge > 0.1) {
        kickAge = 0;
        kickCount++;
      }
      prevBeat = a.beat;
      const aspect = frame.resolution[0] / frame.resolution[1];
      // deterministic low-discrepancy walk so each pebble lands somewhere new
      const kx = aspect * (0.2 + 0.6 * ((kickCount * 0.618034) % 1));
      const ky = 0.25 + 0.5 * ((kickCount * 0.754878) % 1);
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uFlow, flow);
      gl.uniform1f(u.uKickAge, kickAge);
      gl.uniform2f(u.uKickPos, kx, ky);
      gl.uniform1f(u.uLevel, a.level);
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
