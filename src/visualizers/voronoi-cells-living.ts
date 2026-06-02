import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uLevel;
uniform float uBass;
uniform float uMid;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 cellCenter(vec2 cell) {
  float hx = hash21(cell + vec2(0.3, 0.7));
  float hy = hash21(cell + vec2(0.9, 0.1));
  float phase = uTime * 0.5;
  float bassJitter = 1.0 + uBass * 0.6;
  vec2 offset = 0.5 + 0.45 * sin(vec2(
    phase + hx * 6.2831 + uBass * 2.0,
    phase * 1.17 + hy * 6.2831 + uBass * 2.0
  )) * bassJitter;
  return cell + offset;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float aspect = uResolution.x / uResolution.y;
  uv.x *= aspect;

  float scale = 5.0 + uLevel * 1.5;
  vec2 st = uv * scale;
  vec2 iSt = floor(st);

  float f1 = 1e9;
  float f2 = 1e9;
  vec2 f1Cell = iSt;

  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 neighbor = iSt + vec2(float(dx), float(dy));
      vec2 center = cellCenter(neighbor);
      float d = distance(st, center);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        f1Cell = neighbor;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }

  float cellHash = hash21(f1Cell);
  float edgeSharpness = 4.0 + uMid * 12.0;
  float edge = smoothstep(0.0, 1.0 / edgeSharpness, (f2 - f1));
  float edgeGlow = 1.0 - edge;

  vec3 cellColor = mix(uPrimary, uAccent, cellHash);

  float beatFlash = step(cellHash, uBeat * 0.8) * uBeat * 1.5;
  cellColor += beatFlash * uAccent;

  float pulse = 1.0 + uLevel * 0.4;
  cellColor *= pulse;

  vec3 edgeColor = uAccent * (1.5 + uMid * 2.0);
  vec3 col = mix(cellColor, edgeColor, edgeGlow * 0.85);

  col = clamp(col, 0.0, 1.5);
  fragColor = vec4(col, 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uLevel', 'uBass', 'uMid', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createVoronoiCellsLiving(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

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
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uTime, frame.time);
      gl.uniform1f(u.uLevel, frame.audio.level);
      gl.uniform1f(u.uBass, frame.audio.bass);
      gl.uniform1f(u.uMid, frame.audio.mid);
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
