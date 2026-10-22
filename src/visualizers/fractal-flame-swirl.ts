import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';
import { compileProgram } from '../gl/gl-utils';

// A real fractal flame (chaos game). The old per-pixel "orbit density" shader could only
// produce smooth swirly gradients, washed out, at 12 ms. Here every vertex runs its own
// chaos game: start at a random point, apply randomly chosen transforms (affine + nonlinear
// variations) a fixed number of times, and splat the final point. Additive blending turns
// the points into a hit histogram that the display pass tone-maps (log density, palette).
const TRANSFORMS = 3;

const POINT_VERT = `#version 300 es
precision highp float;
uniform vec4 uLin[${TRANSFORMS}]; // affine linear part (a, b, c, d): x' = a x + b y, y' = c x + d y
uniform vec2 uOff[${TRANSFORMS}]; // affine offset
uniform vec4 uVar[${TRANSFORMS}]; // variation weights: linear, swirl, spherical, sinusoidal
uniform vec3 uCum; // cumulative transform probabilities
uniform vec3 uColorIdx; // color index each transform pulls the point toward
uniform vec2 uSym; // cos/sin of the 3-fold symmetry step
uniform vec2 uSpinRot; // cos/sin of the accumulated output rotation
uniform vec2 uScale; // flame coords -> clip space (includes aspect and the kick expansion)
uniform uint uFrame;
out float vColor;

uint ihash(uint x) {
  x ^= x >> 16; x *= 0x7feb352du;
  x ^= x >> 15; x *= 0x846ca68bu;
  x ^= x >> 16;
  return x;
}
float rnd(inout uint s) {
  s ^= s << 13; s ^= s >> 17; s ^= s << 5; // xorshift32
  return float(s) * (1.0 / 4294967296.0);
}

void main() {
  uint s = ihash(uint(gl_VertexID) * 0x9E3779B9u + uFrame * 0x85EBCA6Bu) | 1u;
  vec2 p = vec2(rnd(s), rnd(s)) * 2.0 - 1.0;
  float col = rnd(s);
  for (int i = 0; i < 24; i++) {
    float r = rnd(s);
    int k = r < uCum.x ? 0 : (r < uCum.y ? 1 : 2);
    vec4 L = uLin[k];
    vec2 q = vec2(L.x * p.x + L.y * p.y, L.z * p.x + L.w * p.y) + uOff[k];
    float r2 = dot(q, q);
    float sn = sin(r2), cs = cos(r2);
    vec4 V = uVar[k];
    p = V.x * q
      + V.y * vec2(q.x * sn - q.y * cs, q.x * cs + q.y * sn) // swirl
      + V.z * q / (r2 + 1e-4) // spherical
      + V.w * sin(q); // sinusoidal
    col = (col + uColorIdx[k]) * 0.5;
  }
  // 3-fold rotational symmetry (output only), then the slow accumulated spin
  float sym = floor(rnd(s) * 3.0);
  if (sym > 0.5) p = vec2(uSym.x * p.x - uSym.y * p.y, uSym.y * p.x + uSym.x * p.y);
  if (sym > 1.5) p = vec2(uSym.x * p.x - uSym.y * p.y, uSym.y * p.x + uSym.x * p.y);
  p = vec2(uSpinRot.x * p.x - uSpinRot.y * p.y, uSpinRot.y * p.x + uSpinRot.x * p.y);
  if (!(abs(p.x) < 1e4 && abs(p.y) < 1e4)) p = vec2(1e4); // park escaped points off screen
  vColor = col;
  gl_Position = vec4(p * uScale, 0.0, 1.0);
  gl_PointSize = 1.0;
}
`;

const POINT_FRAG = `#version 300 es
precision highp float;
in float vColor;
out vec4 fragColor;
// r = color index sum, a = hit count (weight 1 keeps half-float sums exact)
void main() { fragColor = vec4(vColor, 0.0, 0.0, 1.0); }
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
  // log-density tone mapping (the flame look); a small floor hides lone stray hits
  float v = max(log(1.0 + acc.a * uExposure) * 0.32 - 0.04, 0.0);
  float tAvg = acc.r / max(acc.a, 1e-3);
  vec3 base = mix(uPrimary, uAccent, smoothstep(0.25, 0.75, tAvg));
  float lod = max(log2(uAccSize.y / 540.0) + 3.0, 1.0);
  float bloom = log(1.0 + blurDensity(st, lod) * uExposure) * 0.2
              + log(1.0 + blurDensity(st, lod + 1.5) * uExposure) * 0.14;

  vec3 col = uPrimary * 0.03 * smoothstep(1.4, 0.0, length(uv)) * (0.6 + uLevel * 0.6);
  col += base * v;
  col += vec3(1.0) * pow(clamp(v, 0.0, 1.5), 4.0) * 0.2; // dense filaments burn toward white
  col += mix(uPrimary, uAccent, 0.4) * bloom * uGlow;

  col = 1.0 - exp(-col * 1.2);
  fragColor = vec4(col, 1.0);
}
`;

const NAMES = ['uResolution', 'uAcc', 'uAccSize', 'uExposure', 'uGlow', 'uLevel', 'uPrimary', 'uAccent'] as const;
const POINT_NAMES = [
  'uLin', 'uOff', 'uVar', 'uCum', 'uColorIdx', 'uSym', 'uSpinRot', 'uScale', 'uFrame',
] as const;

const POINTS = 180000;
const MAX_ACC_DIM = 1280; // accumulation buffer cap (the user runs 4K; points are 1px in this buffer)

// The flame's transforms. Each one's linear part rotates with the accumulated morph phase
// at its own rate (the classic way to animate a flame smoothly).
const XF = [
  { w: 0.4, rot: 0.3, spin: 1.0, s: 0.7, tx: 0.35, ty: 0.1, v: [0.3, 0.7, 0, 0], c: 0.0 },
  { w: 0.35, rot: 2.0, spin: -0.7, s: 0.6, tx: -0.4, ty: 0.25, v: [0, 0, 0.3, 0.7], c: 0.5 },
  { w: 0.25, rot: 4.0, spin: 0.5, s: 0.75, tx: 0.0, ty: -0.45, v: [0, 0.4, 0, 0.6], c: 1.0 },
];

export function createFractalFlameSwirl(): Visualizer {
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
  const lin = new Float32Array(TRANSFORMS * 4);
  const off = new Float32Array(TRANSFORMS * 2);
  const vars = new Float32Array(TRANSFORMS * 4);
  let morph = 0; // accumulated morph phase (audio drives the RATE)
  let spin = 0; // accumulated output rotation
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
    id: 'fractal-flame-swirl',
    name: 'Fractal Flame Swirl',
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

      // the flame morphs and spins faster with the music; each kick surges both rates
      morph = (morph + (0.05 + a.level * 0.07 + a.beat * 0.25) * frame.dt) % (Math.PI * 20);
      spin = (spin + (0.04 + a.mid * 0.05 + a.beat * 0.35) * frame.dt) % (Math.PI * 2);
      let wsum = 0;
      for (let i = 0; i < TRANSFORMS; i++) {
        const x = XF[i];
        const ang = x.rot + morph * x.spin;
        const c = Math.cos(ang) * x.s;
        const s = Math.sin(ang) * x.s;
        lin.set([c, -s, s, c], i * 4);
        off.set([x.tx, x.ty], i * 2);
        vars.set(x.v, i * 4);
        wsum += x.w;
      }
      const c0 = XF[0].w / wsum;
      const c1 = c0 + XF[1].w / wsum;
      const aspect = w / Math.max(h, 1);
      // kicks expand the flame a few percent (returns to rest as the pulse decays)
      const fit = 0.8 * (1 + a.beat * 0.05 + a.bass * 0.02);
      const decay = Math.exp(-frame.dt / 0.07); // trail persistence, frame-rate independent
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
      gl.uniform4fv(pu.uLin, lin);
      gl.uniform2fv(pu.uOff, off);
      gl.uniform4fv(pu.uVar, vars);
      gl.uniform3f(pu.uCum, c0, c1, 1);
      gl.uniform3f(pu.uColorIdx, XF[0].c, XF[1].c, XF[2].c);
      gl.uniform2f(pu.uSym, Math.cos((2 * Math.PI) / 3), Math.sin((2 * Math.PI) / 3));
      gl.uniform2f(pu.uSpinRot, Math.cos(spin), Math.sin(spin));
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
      const exposure = ((accW * accH) / (POINTS * accWeight)) * 4.5 * (1 + a.beat * 0.9 + a.bass * 0.3);
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
