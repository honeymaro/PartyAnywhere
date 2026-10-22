import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Volumetric emission nebula. Cheap by design: a tileable 64^3 RGBA texture is baked once
// at init with the whole fbm in it (R = 4-octave density, GBA = smooth low-frequency warp
// field), so each march sample costs about 1.5 hardware trilinear fetches instead of the
// old curl (6 noises) + fbm (3 noises) of 8 hashes each. The slab is marched in 22 coarse
// steps with a per-pixel blue-noise dithered start (hides the slice banding). The camera
// flies forward on CPU-accumulated travel (kicks surge the speed); kicks brighten and bloom
// the gas without touching its shape.
const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uTravel; // accumulated fly-through distance (audio = speed, never reverses)
uniform float uLevel;
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;
uniform sampler3D uNoise; // baked fbm volume, LINEAR + REPEAT
uniform sampler2D uBlue;  // 32x32 blue-noise ranks (R8, NEAREST)
uniform float uDitherShift; // per-frame golden-ratio offset of the blue noise

float hash2(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// One layer of point stars on a screen-space grid (about 4 % of cells hold a star).
float stars(vec2 x, float twinkle) {
  vec2 c = floor(x);
  vec2 f = fract(x) - 0.5;
  float h = hash2(c);
  vec2 o = vec2(hash2(c + 17.1), hash2(c + 41.7)) - 0.5;
  float s = smoothstep(0.16, 0.0, length(f - o * 0.6)) * step(0.96, h);
  return s * (0.55 + 0.45 * sin(uTime * (1.5 + h * 5.0) + h * 60.0) * twinkle);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  // Camera: forward travel is accumulated on the CPU; the lateral sway and the slow roll
  // depend on time only, so nothing pistons with the audio.
  vec3 ro = vec3(sin(uTime * 0.031) * 1.6, cos(uTime * 0.023) * 1.1, uTravel);
  float ra = uTime * 0.013;
  float cr = cos(ra), sr = sin(ra);
  vec3 rd = normalize(vec3(mat2(cr, -sr, sr, cr) * uv, 1.25));

  // Per-pixel start offset from blue noise: no lattice/diagonal structure (unlike an
  // interleaved-gradient pattern, which stays visible when the canvas is upscaled), its error
  // sits at the highest spatial frequencies, and the golden-ratio shift re-randomizes it every
  // frame, so slice banding becomes a fine, moving film grain.
  float dither = fract(texelFetch(uBlue, ivec2(gl_FragCoord.xy) & 31, 0).r + uDitherShift);

  const int STEPS = 22;
  const float DT = 0.17;
  const float T0 = 0.1;
  const float T_FAR = T0 + DT * float(STEPS);
  float t = T0 + DT * dither;

  // Kick: emission gain and slightly softer cloud edges (bloom). Both return to rest.
  float kick = uBeat * 0.9 + uBass * 0.35;
  const float THR = 0.6;
  float soft = 0.22 + uBass * 0.035;
  vec3 hot = mix(uAccent, vec3(1.0), 0.4);
  vec3 drift = vec3(0.0, 0.0, uTime * 0.01);

  vec3 acc = vec3(0.0);
  float trans = 1.0;
  // Low-frequency field: GBA warps the density lookup into swirls and filaments, G also
  // picks the hue. It is smooth on the scale of several steps, so it is fetched every
  // second step and linearly interpolated in between (continuous, 12 fetches instead of 22).
  vec4 wB = texture(uNoise, (ro + rd * t) * 0.085 + drift);
  vec4 wA = wB;
  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * t;
    vec4 w;
    if ((i & 1) == 0) {
      wA = wB;
      wB = texture(uNoise, (p + rd * (2.0 * DT)) * 0.085 + drift);
      w = wA;
    } else {
      w = (wA + wB) * 0.5;
    }
    vec3 q = p + (w.gba - 0.5) * 2.0;
    // the 4-octave density
    float d = texture(uNoise, q * 0.25).r;
    float dens = smoothstep(THR, THR + soft, d);
    if (dens > 0.002) {
      // far samples fade in out of the dark instead of popping at the slab end
      float fade = smoothstep(T_FAR, T_FAR * 0.45, t);
      // hue: large-scale field plus depth (near gas leans accent, far gas primary)
      float hue = clamp(0.5 + (w.g - 0.5) * 1.3 + (1.9 - t) * 0.25, 0.0, 1.0);
      vec3 c = mix(uPrimary, uAccent, hue);
      // glowing rims, dusky cores: emission peaks at the cloud edges while the dense
      // interior mostly absorbs, which reads as lit gas with dark dust lanes
      float rim = smoothstep(0.0, 0.45, dens) * (1.0 - 0.7 * smoothstep(0.45, 1.0, dens));
      c = mix(c, hot, rim * rim * 0.3);
      acc += c * rim * fade * trans * DT * 3.0;
      trans *= 1.0 - dens * 0.32;
      if (trans < 0.03) break;
    }
    t += DT;
  }

  // Exposure: level lifts it slowly, the kick flashes the gas brighter (bloom), and a soft
  // exponential tonemap keeps the hues instead of clipping them to a flat pastel sheet.
  vec3 col = acc * (0.55 + uLevel * 0.3 + kick * 0.9);

  // far field: a dim 2D nebula sheet (one fetch, slow parallax) and stars behind the gas
  vec4 far = texture(uNoise, vec3(uv * 0.32 + vec2(0.0, uTravel * 0.006), 0.37));
  float farD = smoothstep(0.5, 0.9, far.r);
  vec3 bg = uPrimary * 0.02 + mix(uPrimary, uAccent, far.g) * farD * 0.16;
  float tw = 0.6 + uTreble * 0.8;
  float st = stars(uv * 70.0 + 3.1, tw) + stars(uv * 150.0 + 9.7, tw) * 0.6;
  col += (bg + vec3(st) * (0.7 + uTreble * 0.5)) * trans;

  col = 1.0 - exp(-col * 1.35);
  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uTravel', 'uLevel', 'uBass', 'uTreble', 'uBeat',
  'uPrimary', 'uAccent', 'uNoise', 'uBlue', 'uDitherShift',
] as const;

const N = 64; // texture size; every octave tiles over it, so the volume repeats seamlessly

/**
 * Bakes tileable value-noise octaves into a 64^3 RGBA8 volume (deterministic LCG):
 * R = density fbm (lattice spacing 8, 4, 2, 1 texels), G/B/A = smooth warp field (16, 8).
 */
function bakeNoise(): Uint8Array {
  let seed = 0x2545f491;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const acc = new Float32Array(N * N * N * 4);
  const octave = (ch: number, spacing: number, amp: number) => {
    const m = N / spacing; // lattice points per axis (wraps -> tileable)
    const lat = new Float32Array(m * m * m);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    const i0 = new Int32Array(N), i1 = new Int32Array(N), wt = new Float32Array(N);
    for (let x = 0; x < N; x++) {
      const fx = x / spacing;
      const i = Math.floor(fx);
      const f = fx - i;
      i0[x] = i % m;
      i1[x] = (i + 1) % m;
      wt[x] = f * f * (3 - 2 * f);
    }
    let o = ch;
    for (let z = 0; z < N; z++) {
      const z0 = i0[z] * m * m, z1 = i1[z] * m * m, wz = wt[z];
      for (let y = 0; y < N; y++) {
        const y0 = i0[y] * m, y1 = i1[y] * m, wy = wt[y];
        for (let x = 0; x < N; x++, o += 4) {
          const x0 = i0[x], x1 = i1[x], wx = wt[x];
          const a = lat[z0 + y0 + x0] + (lat[z0 + y0 + x1] - lat[z0 + y0 + x0]) * wx;
          const b = lat[z0 + y1 + x0] + (lat[z0 + y1 + x1] - lat[z0 + y1 + x0]) * wx;
          const c = lat[z1 + y0 + x0] + (lat[z1 + y0 + x1] - lat[z1 + y0 + x0]) * wx;
          const d = lat[z1 + y1 + x0] + (lat[z1 + y1 + x1] - lat[z1 + y1 + x0]) * wx;
          const ab = a + (b - a) * wy;
          const cd = c + (d - c) * wy;
          acc[o] += (ab + (cd - ab) * wz) * amp;
        }
      }
    }
  };
  octave(0, 8, 0.5);
  octave(0, 4, 0.25);
  octave(0, 2, 0.15);
  octave(0, 1, 0.1);
  for (let ch = 1; ch < 4; ch++) {
    octave(ch, 16, 0.65);
    octave(ch, 8, 0.35);
  }
  // contrast-stretch around the mean so the 8-bit range is used well
  const out = new Uint8Array(acc.length);
  for (let i = 0; i < acc.length; i++) {
    const ch = i & 3;
    const v = ch === 0 ? (acc[i] / 1.0 - 0.5) * 2.0 + 0.5 : (acc[i] - 0.5) * 1.8 + 0.5;
    out[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  return out;
}

/**
 * 32x32 blue-noise dither ranks via void-and-cluster (Ulichney 1993): points are added one
 * by one into the largest void of a toroidal Gaussian energy field, and each pixel's rank
 * becomes its threshold. Deterministic, built once at init (a few ms).
 */
function blueNoise(): Uint8Array {
  const n = 32, size = n * n, R = 5;
  const kern: number[] = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) kern.push(Math.exp(-(dx * dx + dy * dy) / 4.5));
  const energy = new Float32Array(size);
  const on = new Uint8Array(size);
  const rank = new Int32Array(size);
  const splat = (i: number, sign: number) => {
    const x = i % n, y = (i / n) | 0;
    let k = 0;
    for (let dy = -R; dy <= R; dy++) {
      const row = ((y + dy + n) % n) * n;
      for (let dx = -R; dx <= R; dx++) energy[row + ((x + dx + n) % n)] += sign * kern[k++];
    }
  };
  const extreme = (want: number, max: boolean) => {
    let best = -1, bv = max ? -Infinity : Infinity;
    for (let i = 0; i < size; i++) {
      if (on[i] !== want) continue;
      const e = energy[i];
      if (max ? e > bv : e < bv) { bv = e; best = i; }
    }
    return best;
  };
  // initial random 10 % pattern, relaxed until the tightest cluster is the largest void
  let seed = 0x9e3779b9;
  const initial = size / 10;
  for (let placed = 0; placed < initial;) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const i = seed % size;
    if (!on[i]) { on[i] = 1; splat(i, 1); placed++; }
  }
  for (let iter = 0; iter < size; iter++) {
    const c = extreme(1, true);
    on[c] = 0; splat(c, -1);
    const v = extreme(0, false);
    on[v] = 1; splat(v, 1);
    if (v === c) break;
  }
  // phase 1: rank the initial points by removing the tightest cluster first
  const saveOn = on.slice(), saveE = energy.slice();
  for (let r = initial - 1; r >= 0; r--) {
    const c = extreme(1, true);
    on[c] = 0; splat(c, -1);
    rank[c] = r;
  }
  on.set(saveOn); energy.set(saveE);
  // phase 2: fill the largest void until every pixel has a rank
  for (let r = initial; r < size; r++) {
    const v = extreme(0, false);
    on[v] = 1; splat(v, 1);
    rank[v] = r;
  }
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) out[i] = Math.floor((rank[i] + 0.5) * 256 / size);
  return out;
}

// Both bakes are deterministic and together cost ~150-190 ms of main-thread time, so they run
// once per page load instead of on every activation (rotation re-creates the visualizer).
let noiseData: Uint8Array | undefined;
let blueNoiseData: Uint8Array | undefined;

function createBlueNoiseTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  blueNoiseData ??= blueNoise();
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 32, 32, 0, gl.RED, gl.UNSIGNED_BYTE, blueNoiseData);
  gl.activeTexture(gl.TEXTURE0);
  return tex;
}

function createNoiseTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_3D, tex);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);
  noiseData ??= bakeNoise();
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, N, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, noiseData);
  gl.activeTexture(gl.TEXTURE0); // leave unit 0 active for the spectrum users
  return tex;
}

export function createNebulaVolumetric(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  let noiseTex: WebGLTexture;
  let blueTex: WebGLTexture;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let travel = 0; // fly-through distance (rate rides level + bass + beat; only ever increases)
  let ditherShift = 0; // golden-ratio sequence, re-randomizes the dither every frame

  return {
    id: 'nebula-volumetric',
    name: 'Cyber-Organic Nebula',
    init(context: VisualizerContext) {
      ctx = context;
      gl = context.gl;
      program = context.compileFragment(FRAG);
      for (const name of NAMES) u[name] = gl.getUniformLocation(program, name);
      noiseTex = createNoiseTexture(gl);
      blueTex = createBlueNoiseTexture(gl);
    },
    resize() {},
    render(frame: RenderFrame) {
      gl.useProgram(program);
      ctx.quad.bind(program);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, noiseTex);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, blueTex);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(u.uNoise, 1);
      gl.uniform1i(u.uBlue, 2);
      ditherShift = (ditherShift + 0.6180339887) % 1;
      gl.uniform1f(u.uDitherShift, ditherShift);
      travel += (0.12 + frame.audio.level * 0.22 + frame.audio.bass * 0.25 + frame.audio.beat * 0.9) * frame.dt;
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uTime, frame.time);
      gl.uniform1f(u.uTravel, travel);
      gl.uniform1f(u.uLevel, frame.audio.level);
      gl.uniform1f(u.uBass, frame.audio.bass);
      gl.uniform1f(u.uTreble, frame.audio.treble);
      gl.uniform1f(u.uBeat, frame.audio.beat);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
      gl.deleteTexture(noiseTex);
      gl.deleteTexture(blueTex);
    },
  };
}
