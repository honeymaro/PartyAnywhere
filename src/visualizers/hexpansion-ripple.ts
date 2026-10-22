import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// A field of small hexagonal tiles that expand and light up as ripples pass through them.
// Each kick launches a ring from the center that travels outward; tiles on the ring pop to
// full size and flare toward white, then shrink back as the ring moves on (up to four
// rings in flight). Between kicks, slow idle waves (accumulated phase) and a radial
// spectrum (inner tiles = bass, outer = treble) keep the field gently breathing.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uPhase;    // accumulated idle wave phase
uniform vec4 uKickAge;   // seconds since each of the last 4 kicks (large = none)
uniform float uLevel;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;
uniform sampler2D uSpectrum;

const float SCALE = 15.0; // cells across the short screen side

// Hex grid from two offset rectangular lattices: returns (local offset, cell id)
vec4 hexCell(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec2 h = s * 0.5;
  vec2 a = mod(p, s) - h;
  vec2 b = mod(p - h, s) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  return vec4(gv, p - gv);
}

// 0 at the cell center, 0.5 on the edges
float hexDist(vec2 p) {
  p = abs(p);
  return max(dot(p, vec2(0.5, 0.8660254)), p.x);
}

float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 45.31);
  return fract(p.x * p.y);
}

void main() {
  float minRes = min(uResolution.x, uResolution.y);
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / minRes;
  vec4 h = hexCell(uv * SCALE);
  vec2 gv = h.xy;
  vec2 id = h.zw;
  float px = SCALE / minRes;
  float cellR = length(id) / SCALE;
  float n = hash21(id);

  // kick rings: tiles near each expanding front pop, with a short trailing afterglow
  float ring = 0.0;
  for (int i = 0; i < 4; i++) {
    float age = uKickAge[i];
    float dr = cellR - age * 0.75;
    float front = exp(-dr * dr * 220.0);
    float trail = exp(dr * 9.0) * step(dr, 0.0) * 0.35;
    ring += (front + trail) * exp(-age * 1.1);
  }
  ring = min(ring, 1.2);

  // idle: two slow waves moving outward plus the radial spectrum
  float idle = 0.5 + 0.5 * sin(cellR * 14.0 - uPhase);
  idle *= 0.5 + 0.5 * sin(cellR * 5.0 - uPhase * 0.6 + n * 0.8);
  float spec = texture(uSpectrum, vec2(clamp(cellR * 0.95, 0.0, 1.0), 0.5)).r;
  float act = idle * 0.22 + spec * uLevel * 0.3 + ring;

  // tile size expands with activation (gap shrinks)
  float size = 0.26 + 0.2 * clamp(act, 0.0, 1.0);
  float sd = hexDist(gv) - size;
  float tile = 1.0 - smoothstep(-px, px, sd);
  float bevel = 1.0 - 0.45 * clamp(hexDist(gv) / size, 0.0, 1.0);

  vec3 base = mix(uPrimary, uAccent, n * 0.35);
  vec3 hot = mix(uAccent, vec3(1.0), clamp(ring - 0.75, 0.0, 0.35));
  vec3 tileCol = mix(base, hot, clamp(ring * 1.3, 0.0, 1.0));
  float bright = 0.14 + 0.75 * clamp(act, 0.0, 1.2);

  vec3 col = mix(uPrimary, uAccent, 0.5) * 0.025;
  col += tileCol * tile * bright * bevel;
  // soft halo around active tiles
  col += tileCol * exp(-max(sd, 0.0) * 30.0) * (1.0 - tile) * clamp(act, 0.0, 1.0) * 0.35;
  col *= 0.95 + uBeat * 0.15;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uPhase', 'uKickAge', 'uLevel', 'uBeat', 'uPrimary', 'uAccent', 'uSpectrum',
] as const;

export function createHexpansionRipple(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let phase = 0; // idle wave phase (only ever increases)
  const kicks = [10, 10, 10, 10]; // ages of the last 4 kicks, newest first
  let prevBeat = 0;

  return {
    id: 'hexpansion-ripple',
    name: 'Hex Ripple Expansion',
    init(context: VisualizerContext) {
      ctx = context;
      gl = context.gl;
      program = context.compileFragment(FRAG);
      for (const name of NAMES) u[name] = gl.getUniformLocation(program, name);
    },
    resize() {},
    render(frame: RenderFrame) {
      const a = frame.audio;
      phase += (1.0 + a.level * 0.8 + a.mid * 0.6) * frame.dt;
      for (let i = 0; i < 4; i++) kicks[i] += frame.dt;
      if (a.beat > 0.85 && prevBeat <= 0.85) {
        kicks.pop();
        kicks.unshift(0);
      }
      prevBeat = a.beat;

      gl.useProgram(program);
      ctx.quad.bind(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, ctx.spectrumTex);
      gl.uniform1i(u.uSpectrum, 0);
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uPhase, phase);
      gl.uniform4f(u.uKickAge, kicks[0], kicks[1], kicks[2], kicks[3]);
      gl.uniform1f(u.uLevel, a.level);
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
