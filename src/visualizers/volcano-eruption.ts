import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Volcanic eruption: a dark mountain silhouette erupts a billowing fbm ash plume lit
// from below, while ballistic lava bombs arc out of the crater (procedural particles:
// hashed launch angle/speed, gravity parabola, fract-cycled lifetime, as in classic
// shader explosion particles; the per-bomb math is uniform-only, so it runs once per
// frame on the CPU and the shader just splats 24 glows). The crater and scene glow pulse
// with the bass; each beat surges the fountain and flashes the crater. Plume rise and
// eruption phase are CPU-accumulated (one-way) so audio changes speed, never reverses.
// Colors come from the live palette: uPrimary = lava/glow, uAccent = alternate bombs.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uRise;   // accumulated plume rise (audio = rate, one-way)
uniform vec4 uBombs[24]; // per bomb: xy = position, z = brightness, w = 1 for accent color (CPU)
uniform float uBass;
uniform float uBeat;
uniform float uLevel;
uniform vec3 uPrimary;
uniform vec3 uAccent;

const int BOMBS = 24;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// integer lattice hash for the noise: uRise grows without bound and feeds the lattice, and
// hash21's fract(p * 456.21) runs out of float32 precision within an hour (the plume turns
// blocky); integer math stays exact. (hash21 is still fine for the fixed star cells.)
float lhash(vec2 i) {
  uvec2 q = uvec2(ivec2(i));
  q = q * 1664525u + 1013904223u;
  q.x += q.y * 1664525u;
  q.y += q.x * 1664525u;
  q ^= q >> 16u;
  q.x += q.y * 1664525u;
  q.y += q.x * 1664525u;
  q ^= q >> 16u;
  return float(q.x ^ q.y) * (1.0 / 4294967295.0);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = lhash(i);
  float b = lhash(i + vec2(1.0, 0.0));
  float c = lhash(i + vec2(0.0, 1.0));
  float d = lhash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * vnoise(p);
    p = p * 2.04 + vec2(1.7, 9.2);
    amp *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  vec2 crater = vec2(0.0, -0.06);

  // --- night sky with sparse stars ---
  vec3 col = mix(vec3(0.012, 0.012, 0.022), vec3(0.03, 0.025, 0.04), uv.y + 0.5);
  // one small jittered point per cell (not a whole cell: those read as square blocks)
  vec2 sp = uv * 70.0;
  vec2 sCell = floor(sp);
  float sh = hash21(sCell);
  vec2 sOff = vec2(hash21(sCell + 3.1), hash21(sCell + 8.7)) * 0.6 + 0.2;
  float star = step(0.975, sh) * (0.35 + 0.45 * hash21(sCell + 1.7))
             * smoothstep(0.12, 0.0, length(fract(sp) - sOff));
  col += vec3(star) * smoothstep(0.1, 0.4, uv.y); // stars only high in the sky

  // --- ambient eruption glow lighting the whole scene (pulses with bass/beat) ---
  float ambD = length(uv - crater);
  col += uPrimary * exp(-ambD * 3.2) * (0.18 + uLevel * 0.1 + uBass * 0.4 + uBeat * 0.5);

  // --- billowing ash plume above the crater, lit from below by the lava ---
  float plumeY = uv.y - crater.y;
  if (plumeY > 0.0) {
    float halfW = 0.05 + plumeY * 0.42; // column widens as it rises
    // sideways sway only depends on height: two noise taps are plenty (cheaper than fbm)
    float wob = (vnoise(vec2(uv.y * 2.4, uRise * 0.55)) * 0.67
               + vnoise(vec2(uv.y * 4.9, uRise * 1.1 + 3.1)) * 0.33 - 0.5) * 0.32 * (0.3 + plumeY);
    float lateral = abs(uv.x - wob) / halfW;
    float density = fbm(vec2(uv.x * 3.1, uv.y * 2.3 - uRise) + vec2(7.3, 0.0));
    density = smoothstep(0.28, 0.8, density) * smoothstep(1.0, 0.25, lateral);
    // hot at the base -> ash higher up, still faintly lit by the lava glow
    vec3 ash = vec3(0.12, 0.11, 0.12) + uPrimary * 0.05;
    vec3 plumeCol = mix(uPrimary * (1.0 + uBass * 0.6 + uBeat * 0.5), ash,
                        clamp(plumeY * 1.7, 0.0, 1.0));
    col = mix(col, plumeCol, clamp(density * (0.75 + uLevel * 0.3), 0.0, 1.0));
  }

  // --- volcano silhouette with a crater notch and a rocky ridge ---
  float ridge = (vnoise(vec2(uv.x * 22.0, 3.7)) - 0.5) * 0.025;
  float notch = smoothstep(0.06, 0.0, abs(uv.x)) * 0.05; // dip at the crater mouth
  float topY = -0.05 - 0.62 * abs(uv.x) + ridge - notch;
  float mountain = smoothstep(0.004, -0.004, uv.y - topY);
  if (mountain > 0.0) {
    vec3 rock = vec3(0.020, 0.016, 0.020);
    // glowing cracks near the crater
    // thin crack network along the noise mid-level (ridged), not solid blobs
    // (kept close to the crater: further out the noise isolines read as contour lines)
    float crack = smoothstep(0.9, 0.98, 1.0 - abs(vnoise(uv * 26.0) * 2.0 - 1.0))
                * exp(-length(uv - crater) * 9.0);
    rock += uPrimary * crack * (0.6 + uBass * 0.8 + uBeat * 0.4);
    // two glowing lava streams running down the flanks from the crater
    float down = max(crater.y - uv.y, 0.0);
    float wig = (vnoise(vec2(uv.y * 18.0, 2.3)) - 0.5) * 0.05;
    float sx1 = abs(uv.x + 0.38 * down - wig);
    float sx2 = abs(uv.x - 0.5 * down + wig * 0.7);
    float stream = (exp(-sx1 / 0.006) + exp(-sx2 / 0.005) * 0.8)
                 * exp(-down * 3.0) * smoothstep(0.0, 0.03, down);
    rock += uPrimary * stream * (0.55 + uBass * 0.5 + uBeat * 0.4);
    // rim light along the upper edge, strongest near the crater
    float rim = smoothstep(0.018, 0.0, topY - uv.y) * exp(-abs(uv.x) * 5.0);
    rock += uPrimary * rim * (0.25 + uBass * 0.5 + uBeat * 0.6);
    col = mix(col, rock, mountain);
  }

  // --- crater core flash ---
  float core = exp(-length((uv - crater) * vec2(1.0, 2.2)) * 16.0);
  col += mix(uPrimary, vec3(1.0), 0.25) * core * (0.5 + uBass * 1.2 + uBeat * 2.2);

  // --- ballistic lava bombs (positions/brightness computed on the CPU) ---
  vec3 primBomb = mix(uPrimary, vec3(1.0), 0.45);
  vec3 accBomb = mix(uAccent, vec3(1.0), 0.3);
  for (int i = 0; i < BOMBS; i++) {
    vec4 b = uBombs[i];
    vec2 dv = uv - b.xy;
    float glow = 0.00025 / (dot(dv, dv) + 0.00005);
    col += mix(primBomb, accBomb, b.w) * glow * b.z;
  }

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uRise', 'uBombs', 'uBass', 'uBeat', 'uLevel',
  'uPrimary', 'uAccent',
] as const;

const BOMBS = 24;
const CRATER_Y = -0.06; // must match 'crater' in the shader

function hash11(p: number): number {
  p = (p * 0.1031) % 1;
  p *= p + 33.33;
  p *= p + p;
  return p - Math.floor(p);
}

// per-bomb constants: launch angle, speed, lifetime rate/offset (same hashes as before)
const BOMB_H = Array.from({ length: BOMBS }, (_, i) => [
  hash11(i * 7.13 + 1.7),
  hash11(i * 3.77 + 9.1),
  hash11(i * 5.31 + 4.3),
]);

export function createVolcanoEruption(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let rise = 0; // plume scroll phase (audio modulates the rate; only ever increases)
  let erupt = 0; // bomb lifetime phase (audio = fountain speed; only ever increases)
  const bombs = new Float32Array(BOMBS * 4);
  return {
    id: 'volcano-eruption',
    name: 'Volcanic Eruption',
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
      rise += (0.16 + frame.audio.level * 0.3 + frame.audio.beat * 0.35) * frame.dt;
      erupt += (0.22 + frame.audio.level * 0.25 + frame.audio.beat * 0.5) * frame.dt;
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uRise, rise);
      // ballistic bombs: hashed launch cone + gravity, fract-cycled staggered lifetimes
      const gain = 0.45 + frame.audio.bass * 0.8 + frame.audio.beat * 1.6;
      for (let i = 0; i < BOMBS; i++) {
        const [h1, h2, h3] = BOMB_H[i];
        const t = erupt * (0.55 + h3 * 0.5) + h3 * 7.0;
        const age = t - Math.floor(t);
        const ang = (h1 - 0.5) * 1.25; // launch cone around straight up
        const v0 = 0.34 + h2 * 0.42;
        const twinkle = 0.75 + 0.25 * Math.sin(age * 40.0 + i * 3.0) * frame.audio.treble;
        bombs[i * 4] = Math.sin(ang) * 0.8 * v0 * age;
        bombs[i * 4 + 1] = CRATER_Y + Math.cos(ang) * v0 * age - 0.38 * age * age; // gravity arc
        bombs[i * 4 + 2] = (1 - age) * (1 - age) * gain * twinkle;
        bombs[i * 4 + 3] = h2 < 0.3 ? 1 : 0;
      }
      gl.uniform4fv(u.uBombs, bombs);
      gl.uniform1f(u.uBass, frame.audio.bass);
      gl.uniform1f(u.uBeat, frame.audio.beat);
      gl.uniform1f(u.uLevel, frame.audio.level);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
    },
  };
}
