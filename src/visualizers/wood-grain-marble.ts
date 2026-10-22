import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Polished dark marble. A warped fbm field slowly flows (accumulated phase, audio sets the
// rate); its level sets, bent along two crossing grains, become the meandering main veins,
// thinner secondary veins and a hairline crack network. Veins are thin anti-aliased cores with a soft glow, and the glow
// surges on every kick: a bright front runs out from the kick point through the stone.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uFlow;    // accumulated flow phase (audio modulates the rate on the CPU)
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec4 uPulse[3]; // kick glow fronts: center.xy, age in seconds, strength
uniform vec3 uPrimary;
uniform vec3 uAccent;

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

vec2 hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// two independent value noises from one set of lattice lookups
vec2 noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 a = hash2(i);
  vec2 b = hash2(i + vec2(1.0, 0.0));
  vec2 c = hash2(i + vec2(0.0, 1.0));
  vec2 d = hash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

const mat2 M2 = mat2(1.6, 1.2, -1.2, 1.6); // 2x scale + rotation between octaves

vec2 fbm2(vec2 p) {
  vec2 v = vec2(0.0);
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * noise2(p);
    p = M2 * p + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v / 0.875;
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = M2 * p + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v / 0.9375;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  vec2 p = uv * 1.3;
  float f = uFlow;

  // flowing warped field
  vec2 w = fbm2(p * 0.9 + vec2(f * 0.25, -f * 0.15)) - 0.5;
  float m = fbm(p * 1.1 + w * 1.8 + vec2(-f * 0.08, f * 0.12));

  // primary veins: level sets of a diagonal grain bent hard by the field
  float phi = dot(p, vec2(0.55, 0.83)) * 1.3 + m * 4.5;
  float fw = fwidth(phi);
  float dv = abs(fract(phi) - 0.5);
  float wv = 0.002 + 0.03 * smoothstep(-0.25, 0.35, w.x); // vein thickness varies along it
  float core = (1.0 - smoothstep(wv, wv + fw * 1.5, dv)) * (0.45 + 0.55 * smoothstep(-0.3, 0.15, w.y));
  float halo = exp(-dv * 14.0);
  float milk = exp(-dv * 4.0); // milky haze the vein mineral leaves in the stone

  // secondary veins: a crossing family, thinner, fading in and out along the stone
  float phi2 = dot(p, vec2(0.92, -0.38)) * 2.2 + m * 6.0 + w.y * 3.0;
  float fw2 = fwidth(phi2);
  float dv2 = abs(fract(phi2) - 0.5);
  float sec = (1.0 - smoothstep(0.01, 0.01 + fw2 * 1.5, dv2)) * smoothstep(-0.25, 0.15, w.y);
  sec *= 1.0 - smoothstep(0.3, 0.55, fw2);

  // hairline cracks in some regions
  float phi3 = m * 14.0 + w.x * 4.0;
  float fw3 = fwidth(phi3);
  float dv3 = abs(fract(phi3) - 0.5);
  float crack = 1.0 - smoothstep(0.02, 0.02 + fw3 * 1.2, dv3);
  crack *= smoothstep(-0.15, 0.2, w.x) * (1.0 - smoothstep(0.25, 0.5, fw3));

  // kick glow fronts racing out from the kick point
  float front = 0.0;
  for (int i = 0; i < 3; i++) {
    vec4 pl = uPulse[i];
    float age = pl.z;
    if (age > 2.0) continue;
    float x = length(uv - pl.xy) - age * 1.1;
    front += pl.w * exp(-age * 1.6) * exp(-x * x / 0.03);
  }
  float glow = 0.55 + uBass * 0.3 + uBeat * 1.2 + front * 2.2;

  // deep polished stone: mottled clouds at two scales plus a milky haze around the veins
  float cloud = smoothstep(0.2, 0.85, m) * (0.65 + 0.7 * w.x) + milk * 0.35;
  vec3 stone = mix(uPrimary, vec3(0.62), 0.6);
  vec3 col = mix(vec3(0.02, 0.021, 0.03), stone * 0.36, clamp(cloud, 0.0, 1.0));
  col *= 0.85 + 0.3 * smoothstep(-0.3, 0.3, w.y);
  col += uAccent * 0.05 * smoothstep(0.1, 0.45, w.y);

  // veins: soft colored glow, then bright mineral cores; finer veins and cracks fainter
  vec3 veinCol = mix(vec3(0.92, 0.93, 0.95), uAccent, 0.2);
  col += uAccent * halo * (0.03 + 0.14 * max(glow - 0.6, 0.0));
  col = mix(col, veinCol * min(0.7 + 0.3 * glow, 1.5), core);
  col = mix(col, mix(uPrimary, vec3(1.0), 0.6) * min(0.4 + 0.3 * glow, 1.2), sec * 0.85);
  col += vec3(0.75, 0.77, 0.8) * crack * 0.2 * (0.6 + 0.5 * glow);

  // polish: a soft window reflection band lying across the slab, plus treble glints
  float band = dot(uv, vec2(0.8, -0.6)) - 0.12;
  col += vec3(0.055) * (1.0 - smoothstep(0.0, 0.22, abs(band)));
  col += veinCol * core * uTreble * 0.15;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = ['uResolution', 'uFlow', 'uBass', 'uTreble', 'uBeat', 'uPulse', 'uPrimary', 'uAccent'] as const;

const PULSES = 3;

// deterministic 0..1 pseudo-random for pulse placement
function rand(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function createWoodGrainMarble(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  const pulses = new Float32Array(PULSES * 4); // x, y, age, strength
  let slot = 0;
  let hits = 0;
  let prevBass = 0;
  let prevBeat = 0;
  let sinceHit = 1;
  let flow = 0; // flow phase (audio modulates the rate; only ever increases)

  return {
    id: 'wood-grain-marble',
    name: 'Wood Grain and Marble',
    init(context: VisualizerContext) {
      ctx = context;
      gl = context.gl;
      program = context.compileFragment(FRAG);
      for (const name of NAMES) u[name] = gl.getUniformLocation(program, name);
      for (let i = 0; i < PULSES; i++) pulses[i * 4 + 2] = 99;
    },
    resize() {},
    render(frame: RenderFrame) {
      const dt = Math.min(frame.dt, 0.1);
      const a = frame.audio;
      flow += (0.05 + a.level * 0.07 + a.beat * 0.25) * dt;
      for (let i = 0; i < PULSES; i++) pulses[i * 4 + 2] += dt;
      sinceHit += dt;
      // Kick detector: the bass snaps up fast on a kick (> 11/s, i.e. +0.18 in one 60 fps
      // frame; slower bassline swells do not), or the onset pulse jumps to ~1.0 (kicks only;
      // snares, bass notes and hats pulse lower).
      const bassRise = (a.bass - prevBass) / Math.max(frame.dt, 1e-3);
      const kick = (a.bass > 0.6 && bassRise > 11) || (a.beat > 0.95 && a.beat > prevBeat + 0.2);
      if (kick && sinceHit > 0.2) {
        hits++;
        sinceHit = 0;
        const o = slot * 4;
        pulses[o] = (rand(hits) - 0.5) * 1.0;
        pulses[o + 1] = (rand(hits + 0.5) - 0.5) * 0.6;
        pulses[o + 2] = 0;
        pulses[o + 3] = Math.max(a.beat, a.bass);
        slot = (slot + 1) % PULSES;
      }
      prevBass = a.bass;
      prevBeat = a.beat;

      gl.useProgram(program);
      ctx.quad.bind(program);
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uFlow, flow);
      gl.uniform1f(u.uBass, a.bass);
      gl.uniform1f(u.uTreble, a.treble);
      gl.uniform1f(u.uBeat, a.beat);
      gl.uniform4fv(u.uPulse, pulses);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
    },
  };
}
