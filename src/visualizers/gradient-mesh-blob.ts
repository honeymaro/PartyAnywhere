import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Modern mesh gradient: five soft color blobs (primary, accent and three tones derived from
// them) drift on slow orbits around spread-out home spots over a deep background. Colors
// blend as a sharpened weighted average in linear light, so overlaps stay vivid instead of
// muddy, and areas no blob reaches fall off to dark for contrast. Each blob listens to one band of the log spectrum (bass ... treble)
// and swells / brightens with it; kicks swell and brighten all of them at once.
// Orbits and the organic warp are phases accumulated on the CPU (audio sets the rate).
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uWarp;       // accumulated warp phase
uniform vec2 uAnchor[5];   // blob centers (CPU)
uniform float uRadius[5];  // blob radii (CPU: base * band energy * kick swell)
uniform float uGain[5];    // blob intensities (CPU)
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y * 2.0;
  // gentle organic warp so blobs read as fluid shapes, not perfect circles
  uv += 0.1 * vec2(sin(uv.y * 1.9 + uWarp), cos(uv.x * 1.5 - uWarp * 0.8));

  // work in (approximately) linear light
  vec3 P = uPrimary * uPrimary;
  vec3 A = uAccent * uAccent;
  vec3 cols[5];
  cols[0] = P;
  cols[1] = A;
  cols[2] = mix(P, A, 0.5) * 1.15;
  cols[3] = mix(P, vec3(1.0), 0.3);
  cols[4] = mix(A, P, 0.25) * 0.9;

  vec3 acc = vec3(0.0);
  float ws = 0.0;  // total blob energy at this pixel
  float ws2 = 0.0; // sharpened weights: each blob keeps its own color zone
  for (int i = 0; i < 5; i++) {
    vec2 d = uv - uAnchor[i];
    float w = exp(-dot(d, d) / (uRadius[i] * uRadius[i])) * uGain[i];
    float w2 = w * w;
    acc += cols[i] * w2;
    ws += w;
    ws2 += w2;
  }
  vec3 mesh = acc / (ws2 + 1e-6);        // vivid mesh color (no muddy averaging)
  float cover = 1.0 - exp(-ws * 1.8);    // how much blob energy reaches this pixel

  vec3 bg = mix(P, A, 0.5) * 0.03;
  vec3 col = mix(bg, mesh, cover) * (0.3 + 0.75 * cover);
  // hot cores bloom on the kick
  col += mesh * cover * cover * cover * uBeat * 0.6;

  col = sqrt(max(col, 0.0));
  col += (hash(gl_FragCoord.xy) - 0.5) / 128.0; // static dither against gradient banding

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uWarp', 'uAnchor', 'uRadius', 'uGain', 'uBeat', 'uPrimary', 'uAccent',
] as const;

// per-blob home position (spread over the screen, y in -1..1) and orbit around it:
// [homeX, homeY, radiusX, radiusY, speed, offset]
const ORBITS: [number, number, number, number, number, number][] = [
  [-0.95, 0.4, 0.5, 0.3, 1.0, 0.0],
  [0.85, 0.45, 0.45, 0.35, -0.73, 1.26],
  [0.0, -0.05, 0.6, 0.3, 0.57, 2.51],
  [-0.7, -0.55, 0.4, 0.3, -1.17, 3.77],
  [1.05, -0.5, 0.45, 0.3, 0.83, 5.03],
];
const BASE_R = [0.75, 0.7, 0.62, 0.5, 0.58];
// spectrum band centers per blob (log texture bins 0..127: bass .. treble)
const BANDS = [4, 22, 45, 70, 98];

export function createGradientMeshBlob(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  const anchors = new Float32Array(10);
  const radii = new Float32Array(5);
  const gains = new Float32Array(5);
  let orbit = 0; // orbit phase (only ever increases)
  let warp = 0; // warp phase (only ever increases)

  return {
    id: 'gradient-mesh-blob',
    name: 'Gradient Mesh Blobs',
    init(context: VisualizerContext) {
      ctx = context;
      gl = context.gl;
      program = context.compileFragment(FRAG);
      for (const name of NAMES) u[name] = gl.getUniformLocation(program, name);
    },
    resize() {},
    render(frame: RenderFrame) {
      const a = frame.audio;
      orbit += (0.1 + a.level * 0.12 + a.beat * 0.5) * frame.dt;
      warp += (0.15 + a.level * 0.15) * frame.dt;
      const spec = a.spectrum;
      for (let i = 0; i < 5; i++) {
        const [hx, hy, rx, ry, sp, off] = ORBITS[i];
        const ang = orbit * sp + off;
        anchors[i * 2] = hx + Math.cos(ang) * rx;
        anchors[i * 2 + 1] = hy + Math.sin(ang * 1.3) * ry;
        // band energy: average of 5 neighboring bins (0..1)
        const c = BANDS[i];
        let e = 0;
        for (let j = -2; j <= 2; j++) e += spec[Math.min(127, Math.max(0, c + j))];
        e /= 5 * 255;
        radii[i] = BASE_R[i] * (0.75 + e * 0.25 + a.beat * 0.25);
        gains[i] = 0.5 + e * 0.35 + a.beat * 0.6;
      }

      gl.useProgram(program);
      ctx.quad.bind(program);
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uWarp, warp);
      gl.uniform2fv(u.uAnchor, anchors);
      gl.uniform1fv(u.uRadius, radii);
      gl.uniform1fv(u.uGain, gains);
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
