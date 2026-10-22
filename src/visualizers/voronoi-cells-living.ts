import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Living tissue under a microscope: a Voronoi cell sheet whose centers wander inside
// their own grid cells (bounded, so the 3x3 search stays exact: no wedge glitches).
// Each cell has a dark cytoplasm, a glowing nucleus that breathes with its own band of
// the live spectrum, and a bright membrane measured as the true distance to the shared
// border. Motion is CPU-accumulated (audio = rate, one-way); every kick flashes a new
// random subset of cells and pulses the membranes.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uPhase;    // accumulated cell wobble phase (audio = rate, one-way)
uniform vec2 uDrift;     // accumulated slow pan of the sheet (one-way)
uniform float uKickSeed; // kick counter: picks which cells flash on this kick
uniform float uLevel;
uniform float uBass;
uniform float uMid;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;
uniform sampler2D uSpectrum;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// wandering center, always inside [0.14, 0.86] of its own cell
vec2 cellCenter(vec2 cell) {
  float hx = hash21(cell + vec2(0.3, 0.7));
  float hy = hash21(cell + vec2(0.9, 0.1));
  vec2 ph = uPhase * vec2(0.7 + 0.5 * hx, 0.6 + 0.5 * hy) + vec2(hx, hy) * 6.2831;
  return cell + 0.5 + 0.36 * sin(ph);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution.y;        // aspect-correct, height units
  float px = 5.5 / uResolution.y;                   // one pixel in cell units
  vec2 st = uv * 5.5 + uDrift;
  vec2 iSt = floor(st);

  float f1 = 1e9;
  float f2 = 1e9;
  vec2 c1 = vec2(0.0);
  vec2 c2 = vec2(0.0);
  vec2 cell1 = iSt;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 nb = iSt + vec2(float(dx), float(dy));
      vec2 c = cellCenter(nb);
      vec2 r = c - st;
      float d = dot(r, r);
      if (d < f1) {
        f2 = f1; c2 = c1;
        f1 = d; c1 = c; cell1 = nb;
      } else if (d < f2) {
        f2 = d; c2 = c;
      }
    }
  }
  float dCenter = sqrt(f1);
  // true distance to the border shared with the 2nd-nearest cell (constant-width membranes)
  float border = dot(st - 0.5 * (c1 + c2), normalize(c2 - c1));
  border = abs(border);

  float h = hash21(cell1);
  float h2 = hash21(cell1 + 17.3);
  vec3 tint = mix(uPrimary, uAccent, h);

  // the cell's own spectrum band drives its nucleus
  float band = textureLod(uSpectrum, vec2(0.05 + h2 * 0.85, 0.5), 0.0).r;

  // cytoplasm: dark, a bit lighter toward the membrane (cell wall glow)
  vec3 col = tint * (0.07 + 0.16 * smoothstep(0.35, 0.0, border));

  // nucleus: soft glowing blob that breathes with its band
  float rN = 0.1 + 0.12 * band;
  float nuc = smoothstep(rN + px * 1.5, rN * 0.4, dCenter);
  vec3 nucCol = mix(tint, vec3(1.0), 0.25);
  col += nucCol * (nuc * (0.55 + band * 0.6) + exp(-dCenter * 7.0) * 0.12);

  // kick: a fresh random subset of cells flashes (counter changes per kick only)
  float sel = step(0.72, hash21(cell1 + uKickSeed * 7.31));
  col += mix(tint, vec3(1.0), 0.35) * sel * uBeat * (0.55 + 0.45 * smoothstep(0.6, 0.0, dCenter));

  // membrane: bright core + soft glow, thicker and hotter with bass / kick
  float mw = 0.025 + uBass * 0.02 + uBeat * 0.02;
  float mem = smoothstep(mw + px, mw - px, border);
  float memGlow = exp(-border / (0.06 + uBass * 0.04));
  vec3 memCol = mix(uAccent, uPrimary, 0.3 + 0.4 * h);
  float memGain = 0.55 + uMid * 0.25 + uBass * 0.4 + uBeat * 0.8;
  col += memCol * memGlow * 0.35 * memGain;
  col = mix(col, mix(memCol, vec3(1.0), 0.3) * memGain, mem * 0.85);

  col *= 0.9 + uLevel * 0.2;
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uPhase', 'uDrift', 'uKickSeed', 'uLevel', 'uBass', 'uMid', 'uBeat',
  'uPrimary', 'uAccent', 'uSpectrum',
] as const;

export function createVoronoiCellsLiving(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let phase = 0; // cell wobble phase (audio modulates the rate; only ever increases)
  let drift = 0; // slow pan distance (one-way)
  let kickSeed = 0; // kick counter (rising edge of the beat pulse)
  let prevBeat = 0;
  let sinceKick = 99;

  return {
    id: 'voronoi-cells-living',
    name: 'Living Voronoi Cells',
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
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, ctx.spectrumTex);
      gl.uniform1i(u.uSpectrum, 0);
      const a = frame.audio;
      phase += (0.25 + a.level * 0.3 + a.bass * 0.3 + a.beat * 0.9) * frame.dt;
      drift += (0.03 + a.level * 0.03) * frame.dt;
      sinceKick += frame.dt;
      if (a.beat > 0.85 && prevBeat <= 0.85 && sinceKick > 0.1) {
        kickSeed++;
        sinceKick = 0;
      }
      prevBeat = a.beat;
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uPhase, phase);
      gl.uniform2f(u.uDrift, drift, drift * 0.6);
      gl.uniform1f(u.uKickSeed, kickSeed % 64);
      gl.uniform1f(u.uLevel, a.level);
      gl.uniform1f(u.uBass, a.bass);
      gl.uniform1f(u.uMid, a.mid);
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
