import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform vec2 uC; // Julia constant, walked along a circle on the CPU (accumulated phase)
uniform vec2 uRot; // cos/sin of the slow, accumulated view rotation
uniform float uMorph; // accumulated phase, used for the slow background band drift
uniform float uLevel;
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

const float ZOOM = 1.55; // fixed framing (audio-driven zoom made every pixel swim)
const int MAX_ITER = 96;

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  vec2 z = mat2(uRot.x, uRot.y, -uRot.y, uRot.x) * uv * ZOOM;
  vec2 dz = vec2(1.0, 0.0); // derivative dz_n/dz_0 for the distance estimate
  float m2 = dot(z, z);
  float trap = 1e9;
  int n = MAX_ITER;
  bool inside = false;
  for (int i = 0; i < MAX_ITER; i++) {
    dz = 2.0 * vec2(z.x * dz.x - z.y * dz.y, z.x * dz.y + z.y * dz.x);
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + uC;
    m2 = dot(z, z);
    trap = min(trap, m2);
    if (m2 > 1e4) { n = i; break; }
    // the derivative collapsing means the orbit fell into an attracting cycle: interior,
    // stop early (interior pixels were the most expensive ones)
    if (i > 12 && dot(dz, dz) < 1e-8) { inside = true; break; }
  }
  if (n == MAX_ITER) inside = true;

  // distance to the Julia set in screen units (Hubbard-Douady estimate). It only exists for
  // escaping pixels; interior pixels get a large distance so the boundary glow below cannot
  // flood the filled set (it used to paint the whole interior as one flat bright mass). The
  // rim still glows, lit by the exterior pixels right next to it.
  float d = inside ? 1.0 : 0.25 * sqrt(m2 / max(dot(dz, dz), 1e-20)) * log(m2) / ZOOM;
  float px = 1.0 / min(uResolution.x, uResolution.y);

  vec3 col;
  if (inside) {
    // interior: deep, dark palette tint shaded by the orbit trap
    float t = clamp(sqrt(trap), 0.0, 1.0);
    col = mix(uPrimary, uAccent, t) * (0.05 + 0.06 * t);
  } else {
    // exterior: dark background with faint escape-time bands drifting slowly
    float sn = float(n) + 1.0 - log2(log2(m2) * 0.5);
    float band = 0.5 + 0.5 * cos(sn * 0.35 - uMorph * 2.0);
    col = mix(uPrimary, uAccent, band) * (0.025 + 0.03 * band) * (0.7 + 0.5 * uLevel);
  }

  // glowing boundary band: a ~1px hot core keeps the filigree resolved, a soft halo around
  // it; kicks brighten and widen the glow
  float kick = uBeat * 1.4 + uBass * 0.4;
  float w = 0.0006 + px * 0.9;
  float core = exp(-d / w);
  float near = exp(-d / (0.006 + px));
  float halo = exp(-d / (0.03 * (1.0 + uBeat * 0.8)));
  col += uPrimary * halo * (0.12 + 0.06 * uLevel + 0.3 * kick);
  col += uAccent * near * (0.25 + 0.35 * kick);
  col += mix(uAccent, vec3(1.0), 0.2) * core * (0.5 + 0.6 * kick);
  // treble glints along the edge
  col += vec3(1.0) * core * core * uTreble * 0.2;

  col = 1.0 - exp(-col * 1.25);
  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uC', 'uRot', 'uMorph', 'uLevel', 'uBass', 'uTreble', 'uBeat', 'uPrimary', 'uAccent',
] as const;

export function createJuliaMorph(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  // Accumulated phases: the Julia set is extremely sensitive to c, so audio may only change
  // how FAST c travels, never add an offset to it (offsets made the set flicker on beats).
  let morph = 0.9;
  let view = 0;

  return {
    id: 'julia-morph',
    name: 'Julia Morph Travel',
    init(context: VisualizerContext) {
      ctx = context;
      gl = context.gl;
      program = context.compileFragment(FRAG);
      for (const name of NAMES) u[name] = gl.getUniformLocation(program, name);
    },
    resize() {},
    render(frame: RenderFrame) {
      const a = frame.audio;
      morph = (morph + (0.035 + a.level * 0.04 + a.bass * 0.03 + a.beat * 0.07) * frame.dt) % (Math.PI * 2);
      view = (view + (0.02 + a.mid * 0.03) * frame.dt) % (Math.PI * 2);
      // c walks the classic r = 0.7885 circle: connected, filigree sets most of the way round
      const cr = 0.7885;
      gl.useProgram(program);
      ctx.quad.bind(program);
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform2f(u.uC, cr * Math.cos(morph), cr * Math.sin(morph));
      gl.uniform2f(u.uRot, Math.cos(view), Math.sin(view));
      gl.uniform1f(u.uMorph, morph);
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
