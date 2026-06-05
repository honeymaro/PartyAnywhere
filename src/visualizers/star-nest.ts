import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Audio-reactive adaptation of the iconic "Star Nest" by Kali
// (https://www.shadertoy.com/view/XlfGRj): a volumetric kaleidoscopic star-lattice
// flight. Reworked for GLSL ES 3.00, colored from the live palette, and driven by
// CPU-accumulated phase uniforms (uTravel/uSpin) so the music modulates the fly/rotate
// RATE one-directionally (no piston/wobble); bass + beat lift the glow brightness.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTravel; // accumulated fly-through distance (audio = speed, never reverses)
uniform float uSpin;   // accumulated view rotation
uniform float uBass;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

const int VOLSTEPS = 16;
const int ITERATIONS = 13;
const float FORMUPARAM = 0.53;
const float STEPSIZE = 0.1;
const float ZOOM = 0.8;
const float TILE = 0.85;
const float BRIGHTNESS = 0.0016;
const float DARKMATTER = 0.3;
const float DISTFADING = 0.73;
const float SATURATION = 0.85;

mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

void main(){
  vec2 uv = gl_FragCoord.xy / uResolution.xy - 0.5;
  uv.y *= uResolution.y / uResolution.x;
  vec3 dir = vec3(uv * ZOOM, 1.0);

  // one-way view rotation (rate set by audio on the CPU)
  dir.xz *= rot(uSpin * 0.5);
  dir.xy *= rot(uSpin * 0.3);

  // camera flies forward through the lattice via accumulated uTravel
  vec3 from = vec3(1.0, 0.5, 0.5);
  from += vec3(uTravel * 0.5, uTravel * 0.3, uTravel * 0.2);
  from.xz *= rot(uSpin * 0.5);
  from.xy *= rot(uSpin * 0.3);

  // volumetric rendering: tile-fold space, then iterate the inversive formula per step.
  float s = 0.1, fade = 1.0;
  vec3 v = vec3(0.0);
  for (int r = 0; r < VOLSTEPS; r++) {
    vec3 p = from + s * dir * 0.5;
    p = abs(vec3(TILE) - mod(p, vec3(TILE * 2.0))); // kaleidoscopic tiling fold
    float pa = 0.0, a = 0.0;
    for (int i = 0; i < ITERATIONS; i++) {
      p = abs(p) / (dot(p, p) + 1e-7) - FORMUPARAM;  // the "magic formula" (+eps guard)
      a += abs(length(p) - pa);
      pa = length(p);
    }
    float dm = max(0.0, DARKMATTER - a * a * 0.001);
    a *= a * a;
    if (r > 6) fade *= 1.0 - dm;
    v += fade * 0.4; // faint milky base haze
    // bright star clusters colored along depth by the live palette
    v += mix(uPrimary, uAccent, clamp(s * 1.2, 0.0, 1.0)) * a * BRIGHTNESS * fade;
    fade *= DISTFADING;
    s += STEPSIZE;
  }
  v = mix(vec3(length(v)), v, SATURATION); // saturation control

  vec3 col = v * 0.012;
  col *= 0.9 + uBass * 0.5 + uBeat * 0.8; // brightness lift on bass/beat (no motion)

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = ['uResolution', 'uTravel', 'uSpin', 'uBass', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createStarNest(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let travel = 0; // fly-through distance (rate rides level + beat; only ever increases)
  let spin = 0; // view rotation phase (rate rides mids; only ever increases)
  return {
    id: 'star-nest',
    name: 'Star Nest',
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
      travel += (0.01 + frame.audio.level * 0.05 + frame.audio.beat * 0.12) * frame.dt;
      spin += (0.006 + frame.audio.mid * 0.03) * frame.dt;
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uTravel, travel);
      gl.uniform1f(u.uSpin, spin);
      gl.uniform1f(u.uBass, frame.audio.bass);
      gl.uniform1f(u.uBeat, frame.audio.beat);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
    },
  };
}
