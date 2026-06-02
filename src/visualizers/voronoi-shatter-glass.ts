import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBeat;
uniform float uBass;
uniform float uMid;
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

// Voronoi: returns vec3(F1 dist, F2 dist, cell ID scalar)
vec3 voronoi(vec2 p) {
  vec2 ip = floor(p);
  vec2 fp = fract(p);
  float F1 = 8.0;
  float F2 = 8.0;
  vec2 F1cell = vec2(0.0);

  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 nb = vec2(float(i), float(j));
      vec2 cellId = ip + nb;
      // Drift cell centers over time with uMid influence
      float drift = uMid * 0.18 + 0.04;
      vec2 center = hash2(cellId) + drift * sin(uTime * 0.7 + hash2(cellId + 3.7) * 6.28);
      vec2 r = nb + center - fp;
      float d = dot(r, r);
      if (d < F1) {
        F2 = F1;
        F1 = d;
        F1cell = cellId;
      } else if (d < F2) {
        F2 = d;
      }
    }
  }

  float cellId = hash1(F1cell);
  return vec3(sqrt(F1), sqrt(F2), cellId);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  // Aspect-correct coordinates for Voronoi, with a pleasing scale
  float aspect = uResolution.x / uResolution.y;
  vec2 p = uv * vec2(aspect * 5.5, 5.5);

  // Animate slow overall drift
  p += vec2(uTime * 0.06, uTime * 0.04);

  vec3 vor = voronoi(p);
  float F1 = vor.x;
  float F2 = vor.y;
  float cellId = vor.z;

  // Per-cell refraction: beat drives shattering apart
  vec2 refractDir = normalize(hash2(vec2(cellId * 31.7, cellId * 17.3)) - 0.5);
  float shatterAmt = uBeat * 0.22 + 0.02;
  vec2 sampUV = uv + refractDir * shatterAmt * (0.5 + cellId);

  // Background gradient fill for each facet (plasma + primary->accent)
  float plasma = 0.5 + 0.5 * sin(
    sampUV.x * 6.0 + uTime * 0.5 +
    sin(sampUV.y * 5.0 - uTime * 0.3) * 1.5
  );
  float gradT = clamp(plasma + cellId * 0.3, 0.0, 1.0);
  vec3 facetColor = mix(uPrimary, uAccent, gradT);

  // Glassy sparkle highlights driven by uTreble
  float sparkle = pow(clamp(sin(cellId * 93.7 + uTime * 2.3) * 0.5 + 0.5, 0.0, 1.0), 12.0);
  facetColor += uTreble * sparkle * 0.55 * vec3(0.9, 0.95, 1.0);

  // Crack edges: bright where F2-F1 is small, glowing uAccent with uBass
  float crackWidth = 0.04 + uBass * 0.06;
  float edge = 1.0 - smoothstep(0.0, crackWidth, F2 - F1);
  float crackGlow = pow(edge, 2.5);
  vec3 crackColor = uAccent * (1.5 + uBass * 2.5);

  vec3 col = mix(facetColor, crackColor, crackGlow);

  // Subtle vignette
  float vig = 1.0 - 0.35 * dot(uv - 0.5, uv - 0.5) * 4.0;
  col *= clamp(vig, 0.0, 1.0);

  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uBeat', 'uBass', 'uMid', 'uTreble', 'uPrimary', 'uAccent',
] as const;

export function createVoronoiShatterGlass(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

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
      gl.uniform1f(u.uTime, frame.time);
      gl.uniform1f(u.uBeat, frame.audio.beat);
      gl.uniform1f(u.uBass, frame.audio.bass);
      gl.uniform1f(u.uMid, frame.audio.mid);
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
