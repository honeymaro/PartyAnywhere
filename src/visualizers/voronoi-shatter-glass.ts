import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Shattered glass: a Voronoi pane of palette-tinted facets. Cell centers wobble inside
// their own cells (bounded, so a 3x3 search is exact enough) and the cracks are drawn
// at the true distance to the shared border (constant width, no bright wedges where two
// centers get close). Each facet refracts a slow plasma behind it; on a kick the facets
// jolt apart (per-facet refraction offset), the bevels catch light and the cracks flash.
// Wobble phase is CPU-accumulated (audio = rate, one-way).
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uPhase;    // accumulated center wobble (audio = rate, one-way)
uniform float uBeat;
uniform float uBass;
uniform float uTreble;
uniform vec3 uPrimary;
uniform vec3 uAccent;

// Hash functions for pseudo-random cell data
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

float hash1(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Voronoi over a 3x3 window. Centers stay within [0.08, 0.92] of their cell.
// Outputs the nearest and second-nearest centers and the nearest cell id.
void voronoi(vec2 p, out vec2 c1, out vec2 c2, out vec2 cell1) {
  vec2 ip = floor(p);
  float F1 = 8.0;
  float F2 = 8.0;
  c1 = vec2(0.0);
  c2 = vec2(0.0);
  cell1 = ip;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 cellId = ip + vec2(float(i), float(j));
      vec2 h = hash2(cellId);
      vec2 wob = 0.1 * sin(uPhase * (0.6 + h.yx * 0.5) + h * 6.28);
      vec2 c = cellId + 0.5 + (h - 0.5) * 0.64 + wob;
      vec2 r = c - p;
      float d = dot(r, r);
      if (d < F1) {
        F2 = F1; c2 = c1;
        F1 = d; c1 = c; cell1 = cellId;
      } else if (d < F2) {
        F2 = d; c2 = c;
      }
    }
  }
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  // Aspect-correct coordinates for Voronoi, with a pleasing scale
  float aspect = uResolution.x / uResolution.y;
  vec2 p = uv * vec2(aspect * 5.5, 5.5);
  float px = 5.5 / uResolution.y;

  // Animate slow overall drift (constant rate)
  p += vec2(uTime * 0.06, uTime * 0.04);

  vec2 c1, c2, cell1;
  voronoi(p, c1, c2, cell1);
  float cellId = hash1(cell1);
  // true distance to the crack shared with the second-nearest facet
  vec2 n12 = normalize(c2 - c1);
  float border = abs(dot(p - 0.5 * (c1 + c2), n12));

  // Per-facet refraction: the kick jolts the facets apart
  vec2 refractDir = normalize(hash2(cell1 + 7.7) - 0.5 + 1e-3);
  float shatterAmt = 0.015 + uBeat * 0.16 + uBass * 0.03;
  vec2 sampUV = uv + refractDir * shatterAmt * (0.4 + cellId);

  // Background gradient fill for each facet (plasma + primary->accent)
  float plasma = 0.5 + 0.5 * sin(
    sampUV.x * 6.0 + uTime * 0.5 +
    sin(sampUV.y * 5.0 - uTime * 0.3) * 1.5
  );
  float gradT = clamp(plasma * 0.8 + cellId * 0.35 - 0.1, 0.0, 1.0);
  vec3 facetColor = mix(uPrimary, uAccent, gradT) * (0.55 + 0.25 * cellId);

  // bevel: facets catch light on the side facing the light, stronger on a kick
  vec2 toC = p - c1;
  float bevel = smoothstep(0.22, 0.0, border) * dot(normalize(toC + 1e-4), normalize(vec2(-0.6, 0.8)));
  facetColor += mix(uAccent, vec3(1.0), 0.6) * max(bevel, 0.0) * (0.18 + uBeat * 0.45);
  facetColor *= 1.0 + uBeat * 0.35 * step(0.6, hash1(cell1 + 3.1));

  // Glassy sparkle highlights driven by uTreble
  float sparkle = pow(clamp(sin(cellId * 93.7 + uTime * 2.3) * 0.5 + 0.5, 0.0, 1.0), 12.0);
  facetColor += uTreble * sparkle * 0.4 * vec3(0.9, 0.95, 1.0);

  // Crack edges: constant-width glowing lines that widen and flash on the kick
  float crackWidth = 0.02 + uBass * 0.015 + uBeat * 0.03;
  float crack = smoothstep(crackWidth + px, crackWidth - px, border);
  float crackGlow = exp(-border / (0.03 + uBeat * 0.05));
  vec3 crackColor = mix(uAccent, vec3(1.0), 0.35 + uBeat * 0.4) * (1.1 + uBass * 0.6 + uBeat * 1.2);

  vec3 col = facetColor + crackColor * crackGlow * 0.35;
  col = mix(col, crackColor, crack);

  // Subtle vignette
  float vig = 1.0 - 0.35 * dot(uv - 0.5, uv - 0.5) * 4.0;
  col *= clamp(vig, 0.0, 1.0);

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uPhase', 'uBeat', 'uBass', 'uTreble', 'uPrimary', 'uAccent',
] as const;

export function createVoronoiShatterGlass(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let phase = 0; // center wobble phase (audio modulates the rate; only ever increases)

  return {
    id: 'voronoi-shatter-glass',
    name: 'Shattered Glass Voronoi',
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
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      phase += (0.5 + frame.audio.mid * 0.5 + frame.audio.beat * 1.2) * frame.dt;
      gl.uniform1f(u.uTime, frame.time);
      gl.uniform1f(u.uPhase, phase);
      gl.uniform1f(u.uBeat, frame.audio.beat);
      gl.uniform1f(u.uBass, frame.audio.bass);
      gl.uniform1f(u.uTreble, frame.audio.treble);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
    },
  };
}
