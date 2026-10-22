import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';
import { compileProgram } from '../gl/gl-utils';

// Points pass: every vertex is one orbit of the Clifford map. It starts at a hashed random
// position, is iterated a fixed number of times (the transient dies out, the point lands
// on the attractor) and is splatted as a 1px point. Additive blending turns the points into
// a density histogram, which the display pass tone-maps.
const POINT_VERT = `#version 300 es
precision highp float;
uniform vec4 uParams; // a, b, c, d
uniform vec2 uScale; // attractor coords -> clip space (includes aspect and the kick expansion)
uniform uint uFrame;
out float vT;

uint ihash(uint x) {
  x ^= x >> 16; x *= 0x7feb352du;
  x ^= x >> 15; x *= 0x846ca68bu;
  x ^= x >> 16;
  return x;
}

void main() {
  uint h = ihash(uint(gl_VertexID) * 0x9E3779B9u + uFrame * 0x85EBCA6Bu);
  vec2 p = (vec2(float(h & 0xffffu), float(h >> 16)) / 65535.0 - 0.5) * 4.0;
  vec2 prev = p;
  float a = uParams.x, b = uParams.y, c = uParams.z, d = uParams.w;
  for (int i = 0; i < 22; i++) {
    prev = p;
    p = vec2(sin(a * p.y) + c * cos(a * p.x), sin(b * p.x) + d * cos(b * p.y));
  }
  // color index: how far the orbit jumps per step (varies smoothly across the attractor)
  vT = clamp(length(p - prev) * 0.32, 0.0, 1.0);
  gl_Position = vec4(p * uScale, 0.0, 1.0);
  gl_PointSize = 1.0;
}
`;

const POINT_FRAG = `#version 300 es
precision highp float;
in float vT;
out vec4 fragColor;
// r = color index sum, a = hit count (weight 1 keeps half-float sums exact)
void main() { fragColor = vec4(vT, 0.0, 0.0, 1.0); }
`;

// Fade pass: output is ignored, the blend state (ZERO, CONSTANT_ALPHA) scales the history.
const FADE_FRAG = `#version 300 es
precision mediump float;
out vec4 fragColor;
void main() { fragColor = vec4(0.0); }
`;

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform sampler2D uAcc;
uniform vec2 uAccSize;
uniform float uExposure;
uniform float uGlow;
uniform float uLevel;
uniform vec3 uPrimary;
uniform vec3 uAccent;

// 4-tap rotated-grid blur on a coarse mip: hides the blocky texel grid of a single tap
float blurDensity(vec2 st, float lod) {
  vec2 o = exp2(lod) / uAccSize;
  return 0.25 * (textureLod(uAcc, st + o * vec2(0.6, 0.25), lod).a
               + textureLod(uAcc, st + o * vec2(-0.25, 0.6), lod).a
               + textureLod(uAcc, st + o * vec2(-0.6, -0.25), lod).a
               + textureLod(uAcc, st + o * vec2(0.25, -0.6), lod).a);
}

void main() {
  vec2 st = gl_FragCoord.xy / uResolution;
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  vec4 acc = texture(uAcc, st);
  // log tone mapping of the hit density (the classic attractor / flame look)
  float v = log(1.0 + acc.a * uExposure) * 0.3;
  float tAvg = acc.r / max(acc.a, 1e-3);
  vec3 base = mix(uPrimary, uAccent, smoothstep(0.25, 0.75, tAvg));
  // soft bloom: blurred density from coarser mips (lod chosen relative to the buffer size
  // so the glow radius is the same fraction of the screen at any resolution)
  float lod = max(log2(uAccSize.y / 540.0) + 3.0, 1.0);
  float bloom = log(1.0 + blurDensity(st, lod) * uExposure) * 0.2
              + log(1.0 + blurDensity(st, lod + 1.5) * uExposure) * 0.14;

  vec3 col = uPrimary * 0.035 * smoothstep(1.4, 0.0, length(uv)) * (0.6 + uLevel * 0.6);
  col += base * v;
  col += vec3(1.0) * pow(clamp(v, 0.0, 1.5), 4.0) * 0.18; // dense filaments burn toward white
  col += mix(uPrimary, uAccent, 0.4) * bloom * uGlow;

  col = 1.0 - exp(-col * 1.15);
  fragColor = vec4(col, 1.0);
}
`;

const NAMES = ['uResolution', 'uAcc', 'uAccSize', 'uExposure', 'uGlow', 'uLevel', 'uPrimary', 'uAccent'] as const;
const POINT_NAMES = ['uParams', 'uScale', 'uFrame'] as const;

const POINTS = 160000;
const MAX_ACC_DIM = 1280; // accumulation buffer cap (the user runs 4K; points are 1px in this buffer)

// A closed loop of (a, b, c, d) presets. Each straight segment between neighbours was checked
// offline (dense sampling) to stay chaotic, so the attractor morphs without collapsing to
// a few dots (most of Clifford parameter space hides periodic windows).
const PRESETS: [number, number, number, number][] = [
  [1.928, 1.647, -0.641, 1.218],
  [1.747, 1.913, -1.6, 1.199],
  [1.87, 1.515, -1.586, 0.254],
  [1.904, 1.786, -1.399, 1.232],
];

export function createCliffordAttractor(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  let pointProgram: WebGLProgram;
  let fadeProgram: WebGLProgram;
  let vao: WebGLVertexArrayObject;
  let accTex: WebGLTexture | null = null;
  let fbo: WebGLFramebuffer | null = null;
  let accW = 0;
  let accH = 0;
  let floatTarget = false;
  const u: Record<string, WebGLUniformLocation | null> = {};
  const pu: Record<string, WebGLUniformLocation | null> = {};
  let morph = 0; // accumulated position along the preset loop (audio drives the rate)
  let frameNo = 0;
  let accWeight = 0; // frames held in the accumulator: sum of decay^k since the last clear
  let canvasW = 0;
  let canvasH = 0;

  function allocTarget(w: number, h: number) {
    const s = Math.min(0.5, MAX_ACC_DIM / Math.max(w, 1));
    const nw = Math.max(1, Math.round(w * s));
    const nh = Math.max(1, Math.round(h * s));
    if (accTex && nw === accW && nh === accH) return;
    accW = nw;
    accH = nh;
    if (!accTex) accTex = gl.createTexture()!;
    if (!fbo) fbo = gl.createFramebuffer()!;
    gl.bindTexture(gl.TEXTURE_2D, accTex);
    if (floatTarget) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, accW, accH, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, accW, accH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, accTex, 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    accWeight = 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, ctx.spectrumTex);
  }

  return {
    id: 'clifford-attractor',
    name: 'Clifford Attractor Field',
    init(context: VisualizerContext) {
      ctx = context;
      gl = context.gl;
      program = context.compileFragment(FRAG);
      fadeProgram = context.compileFragment(FADE_FRAG);
      pointProgram = compileProgram(gl, POINT_VERT, POINT_FRAG);
      for (const name of NAMES) u[name] = gl.getUniformLocation(program, name);
      for (const name of POINT_NAMES) pu[name] = gl.getUniformLocation(pointProgram, name);
      // empty VAO: the point shader has no attributes (it runs off gl_VertexID), and an own
      // VAO keeps the shared quad's attribute state untouched
      vao = gl.createVertexArray()!;
      // half-float accumulation keeps the hit counts linear; RGBA8 fallback saturates sooner
      floatTarget = !!gl.getExtension('EXT_color_buffer_float');
    },
    resize(width: number, height: number) {
      canvasW = width;
      canvasH = height;
      allocTarget(width, height);
    },
    render(frame: RenderFrame) {
      const a = frame.audio;
      const [w, h] = frame.resolution;
      if (w !== canvasW || h !== canvasH || !accTex) {
        canvasW = w;
        canvasH = h;
        allocTarget(w, h);
      }

      // slow walk around the preset loop; music (and each kick) speeds the morph up
      morph = (morph + (0.03 + a.level * 0.05 + a.beat * 0.12) * frame.dt) % PRESETS.length;
      const i0 = Math.floor(morph);
      const f = morph - i0;
      const e = f * f * (3 - 2 * f);
      const p0 = PRESETS[i0];
      const p1 = PRESETS[(i0 + 1) % PRESETS.length];
      const pa = p0[0] + (p1[0] - p0[0]) * e;
      const pb = p0[1] + (p1[1] - p0[1]) * e;
      const pc = p0[2] + (p1[2] - p0[2]) * e;
      const pd = p0[3] + (p1[3] - p0[3]) * e;
      // fit the attractor's bounding box (|x| <= 1+|c|, |y| <= 1+|d|) to the screen; a kick
      // expands it a few percent (returns to rest as the pulse decays)
      const extent = Math.max(1 + Math.abs(pc), 1 + Math.abs(pd));
      const fit = (0.9 / extent) * (1 + a.beat * 0.05 + a.bass * 0.02);
      const aspect = w / Math.max(h, 1);

      // trail persistence (time based so it does not depend on the frame rate)
      const decay = Math.exp(-frame.dt / 0.07);
      frameNo = (frameNo + 1) >>> 0;
      accWeight = accWeight * decay + 1;

      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, accW, accH);
      gl.enable(gl.BLEND);
      // 1) fade the history: dst = dst * decay
      gl.blendColor(0, 0, 0, decay);
      gl.blendFunc(gl.ZERO, gl.CONSTANT_ALPHA);
      gl.useProgram(fadeProgram);
      ctx.quad.bind(fadeProgram);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // 2) splat the new points additively
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(pointProgram);
      gl.bindVertexArray(vao);
      gl.uniform4f(pu.uParams, pa, pb, pc, pd);
      gl.uniform2f(pu.uScale, fit / aspect, fit);
      gl.uniform1ui(pu.uFrame, frameNo);
      gl.drawArrays(gl.POINTS, 0, POINTS);
      gl.bindVertexArray(null);
      // restore the default state the shared fullscreen pipeline expects
      gl.disable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ZERO);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);

      // 3) display: tone-map the density with the palette
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, accTex);
      gl.generateMipmap(gl.TEXTURE_2D);
      // hits per accumulation pixel ~ POINTS * accWeight / pixels. Using the frames actually
      // held (not the steady state POINTS / (1 - decay)) keeps the first frame, a single-frame
      // gallery thumbnail and the frames after a resize clear at the right brightness.
      const exposure = ((accW * accH) / (POINTS * accWeight)) * 5 * (1 + a.beat * 0.9 + a.bass * 0.3);
      gl.useProgram(program);
      ctx.quad.bind(program);
      gl.uniform2f(u.uResolution, w, h);
      gl.uniform1i(u.uAcc, 0);
      gl.uniform2f(u.uAccSize, accW, accH);
      gl.uniform1f(u.uExposure, exposure);
      gl.uniform1f(u.uGlow, 0.3 + a.bass * 0.3 + a.beat * 0.9);
      gl.uniform1f(u.uLevel, a.level);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindTexture(gl.TEXTURE_2D, ctx.spectrumTex);
    },
    dispose() {
      gl.deleteProgram(program);
      gl.deleteProgram(pointProgram);
      gl.deleteProgram(fadeProgram);
      gl.deleteVertexArray(vao);
      if (accTex) gl.deleteTexture(accTex);
      if (fbo) gl.deleteFramebuffer(fbo);
      accTex = null;
      fbo = null;
    },
  };
}
