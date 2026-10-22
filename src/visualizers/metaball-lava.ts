import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Lava lamp: soft wax blobs (inverse-square metaballs) bob up and down through glowing
// liquid, merging with wax pools at the bottom and top of the lamp. The field's analytic
// gradient gives each blob a domed normal, so the wax gets diffuse shading, a glossy
// highlight and a hot inner core; the glass adds cylindrical shading and vertical streaks.
// Audio: blob motion runs on a CPU-accumulated phase (audio = rate, one-way); kicks swell
// the blobs and flash their cores; bass/level warm up the lamp glow.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uPhase;   // accumulated blob motion (audio = rate, one-way)
uniform float uLevel;
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

const int BLOBS = 7;

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y; // y: -0.5..0.5
  float halfW = 0.5 * uResolution.x / uResolution.y;
  float px = 1.0 / uResolution.y;

  // kicks swell the wax (radius ~ +20% at the peak), bass adds a little
  float swell = 1.0 + uBeat * 0.45 + uBass * 0.15;

  // --- metaball field + analytic gradient ---
  float field = 0.0;
  vec2 grad = vec2(0.0);
  for (int i = 0; i < BLOBS; i++) {
    float fi = float(i);
    float h1 = fract(sin(fi * 12.9898 + 1.3) * 43758.5453);
    float h2 = fract(sin(fi * 78.233 + 4.1) * 43758.5453);
    float sp = 0.45 + 0.4 * h1;                         // each blob has its own pace
    vec2 c = vec2(
      (fi - 3.0) * 0.21 * (halfW / 0.89) + 0.1 * sin(uPhase * 0.5 * sp + fi * 2.1),
      0.44 * sin(uPhase * sp + fi * 1.7 + h2 * 3.0)
    );
    float r2 = (0.0075 + 0.0075 * h2) * swell;
    vec2 d = uv - c;
    float dd = dot(d, d) + 1e-5;
    float f = r2 / dd;
    field += f;
    grad -= 2.0 * f / dd * d;
  }
  // wax pools resting at the bottom and hanging at the top of the lamp (1D fields)
  float pb = uv.y + 0.6;
  float fb = 0.013 * swell / (pb * pb);
  field += fb;
  grad.y -= 2.0 * fb / pb;
  float pt = 0.62 - uv.y;
  float ft = 0.006 * swell / (pt * pt);
  field += ft;
  grad.y += 2.0 * ft / pt;

  // --- liquid + glass backdrop ---
  float yb = uv.y + 0.5;                                  // 0 bottom .. 1 top
  vec3 col = mix(uPrimary * 0.22, uPrimary * 0.05, yb);
  col += uAccent * 0.16 * exp(-yb * 3.5) * (0.8 + uLevel * 0.3 + uBass * 0.4); // lamp bulb glow
  float cyl = abs(uv.x) / halfW;                          // 0 center .. 1 sides
  col *= 1.0 - 0.55 * cyl * cyl;

  // wax color: palette accent, hot core leaning to white
  vec3 wax = uAccent;
  vec3 hot = mix(uAccent, vec3(1.0, 0.95, 0.85), 0.55);

  // glow the wax casts into the liquid
  float halo = smoothstep(0.25, 1.0, field);
  col += wax * halo * (0.18 + uBass * 0.12 + uBeat * 0.25);

  // --- wax body ---
  float w = max(length(grad) * px * 1.2, 0.02);
  float body = smoothstep(1.0 - w, 1.0 + w, field);
  if (body > 0.0) {
    float inner = clamp(1.0 - 1.0 / field, 0.0, 1.0);     // 0 at the surface .. 1 deep inside
    vec3 n = normalize(vec3(-grad / (field * field) * 0.06, 1.0));
    vec3 L = normalize(vec3(-0.45, 0.55, 0.7));
    float diff = max(dot(n, L), 0.0);
    float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
    // lit from the bulb below: lower parts of the wax glow warmer
    float under = 0.75 + 0.35 * (1.0 - yb);
    vec3 waxCol = mix(wax * 0.55, hot, smoothstep(0.1, 0.85, inner) * (0.55 + uBeat * 0.45));
    waxCol *= (0.45 + 0.65 * diff) * under * (0.9 + uLevel * 0.15 + uBeat * 0.35);
    // dark subsurface rim right at the edge
    waxCol *= 0.65 + 0.35 * smoothstep(0.0, 0.15, inner);
    waxCol += vec3(1.0) * spec * (0.4 + uTreble * 0.2);
    col = mix(col, waxCol, body);
  }

  // glass: vertical specular streaks in front of everything
  float s1 = exp(-pow((uv.x + halfW * 0.62) / 0.025, 2.0));
  float s2 = exp(-pow((uv.x - halfW * 0.7) / 0.012, 2.0));
  col += vec3(0.9, 0.95, 1.0) * (s1 * 0.07 + s2 * 0.05) * (0.6 + 0.4 * yb);

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = ['uResolution', 'uPhase', 'uLevel', 'uBass', 'uTreble', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createMetaballLava(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let phase = 0; // blob motion phase (audio modulates the rate; only ever increases)

  return {
    id: 'metaball-lava',
    name: 'Metaball Lava Lamp',
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
      phase += (0.3 + a.level * 0.2 + a.mid * 0.1 + a.beat * 0.45) * frame.dt;
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uPhase, phase);
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
