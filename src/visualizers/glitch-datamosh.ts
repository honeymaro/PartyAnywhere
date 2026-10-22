import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Datamosh glitch over a clean "video frame": a slow, soft palette field with dark valleys,
// bright crests and faint scanlines. Glitches are event driven: every onset (CPU rising
// edge) bumps uSeed, which re-rolls which macroblocks and rows break; a CPU envelope (1 on a
// kick = onset with a bass hit, tiny for other onsets, fast decay) sets how many are broken,
// so a kick shatters the frame and it heals block by block within ~0.3 s. Broken blocks either shift (motion-vector error) or smear (stale pixels
// dragged down), get posterized and RGB-split, and are tinted from the palette.
// In silence there are no glitches at all.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uSeed;    // onset counter (CPU rising edge): new glitch layout per hit
uniform float uGlitch;  // glitch envelope (CPU: 1 on a kick, small on other onsets, decays)
uniform float uLevel;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

// clean frame: soft warped bands in the palette with dark valleys
vec3 scene(vec2 uv) {
  float t = uTime * 0.12;
  vec2 p = uv * vec2(uResolution.x / uResolution.y, 1.0) * 5.0;
  float n = sin(p.x * 1.1 + t + sin(p.y * 1.3 - t * 0.8) * 1.5)
          + sin(p.y * 1.6 - t * 0.7 + sin(p.x * 0.9 + t * 0.6) * 1.6)
          + 0.8 * sin((p.x + p.y) * 0.8 + t * 0.5);
  float m = 0.5 + 0.18 * n;                        // ~0..1
  vec3 col = mix(uPrimary, uAccent, smoothstep(0.15, 0.85, 0.5 + 0.5 * sin(p.x * 0.35 - p.y * 0.25 + t * 0.7)));
  float lum = smoothstep(0.25, 0.85, m);
  col *= 0.05 + 0.75 * lum;
  // thin neon contour lines give the frame structure for the glitches to break
  float c = abs(fract(m * 5.0) - 0.5);
  col += mix(col, vec3(1.0), 0.3) * smoothstep(0.06, 0.0, 0.5 - c) * 0.9 * lum;
  col += mix(col, vec3(1.0), 0.4) * pow(lum, 8.0) * 0.4; // crest highlights
  return col;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float g = uGlitch;  // glitch amount (0 in silence and between kicks)
  vec2 suv = uv;
  float broken = 0.0;
  float split = 0.0;

  if (g > 0.001) {
    float aspect = uResolution.x / uResolution.y;
    // macroblocks: 14 rows, square; some merge into 2x-wide blocks
    vec2 bs = vec2(1.0 / (14.0 * aspect), 1.0 / 14.0);
    vec2 bid = floor(uv / bs);
    vec2 bid2 = floor(bid / vec2(2.0, 1.0));
    float hb = hash(bid2 + uSeed * 7.31);
    if (hb < g * 0.32) {
      broken = 1.0;
      float hm = hash(bid2 + uSeed * 3.17 + 11.0);
      vec2 org = bid * bs;
      if (hm < 0.5) {
        // motion-vector error: the block shows content from somewhere else
        suv += (vec2(hash(bid2 + uSeed + 2.0), hash(bid2 + uSeed + 5.0)) - 0.5) * vec2(0.35, 0.12);
      } else {
        // smear: stale top row of the block dragged down through it
        suv = vec2(uv.x, org.y + bs.y * (0.9 + 0.1 * fract((uv.y - org.y) / bs.y)));
      }
      split = 0.006 + 0.012 * hash(bid2 + uSeed + 9.0);
    }
    // row slices: thin horizontal bands shifted sideways
    float row = floor(uv.y * 60.0);
    float hr = hash(vec2(row, uSeed * 1.93));
    if (hr < g * 0.18) {
      suv.x += (hash(vec2(row + 4.0, uSeed)) - 0.5) * 0.2 * g;
      split = max(split, 0.008);
    }
  }
  suv = fract(suv);

  vec3 col;
  if (split > 0.0) {
    // RGB split inside broken areas
    col.r = scene(fract(suv + vec2(split * g, 0.0))).r;
    col.g = scene(suv).g;
    col.b = scene(fract(suv - vec2(split * g, 0.0))).b;
  } else {
    col = scene(suv);
  }

  if (broken > 0.5) {
    col = floor(col * 5.0 + 0.5) / 5.0;            // compression posterize
    col = col * 1.2 + uAccent * 0.08;              // slightly hot, palette tinted
  }

  // faint scanlines and a hint of treble sparkle
  col *= 0.9 + 0.1 * sin(gl_FragCoord.y * 3.14159);
  col *= 0.85 + uLevel * 0.2 + uBeat * 0.2;
  col += uTreble * 0.02;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uSeed', 'uGlitch', 'uLevel', 'uTreble', 'uBeat',
  'uPrimary', 'uAccent',
] as const;

export function createGlitchDatamosh(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let seed = 0; // onset counter (wrapped: it feeds a float32 hash, which degrades for large values)
  let glitch = 0; // glitch envelope
  let prevBeat = 0;
  let sinceSeed = 99;

  return {
    id: 'glitch-datamosh',
    name: 'Datamosh Glitch',
    init(context: VisualizerContext) {
      ctx = context;
      gl = context.gl;
      program = context.compileFragment(FRAG);
      for (const name of NAMES) u[name] = gl.getUniformLocation(program, name);
    },
    resize() {},
    render(frame: RenderFrame) {
      const a = frame.audio;
      glitch *= Math.exp(-frame.dt / 0.13);
      sinceSeed += frame.dt;
      const onset = a.beat - prevBeat > 0.2;
      // a kick is the pulse crossing up through 0.85; it can take two or three frames to get
      // there, so judging the kick on the onset frame alone misread some kicks as minor hits
      const kick = a.beat > 0.85 && prevBeat <= 0.85;
      if (onset || kick) {
        // new layout per hit (a kick right after its own onset frame keeps that layout instead
        // of re-rolling mid-event); kicks break the frame hard, other onsets (hats, arpeggios)
        // only nick a block or two
        if (sinceSeed > 0.1) {
          seed = (seed + 1) % 64;
          sinceSeed = 0;
        }
        glitch = Math.max(glitch, kick ? 1 : 0.08);
      }
      prevBeat = a.beat;

      gl.useProgram(program);
      ctx.quad.bind(program);
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uTime, frame.time);
      gl.uniform1f(u.uSeed, seed);
      gl.uniform1f(u.uGlitch, glitch);
      gl.uniform1f(u.uLevel, a.level);
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
