import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

mat2 rot2(float a) { float c=cos(a),s=sin(a); return mat2(c,-s,s,c); }

void octFold(inout vec3 p) {
  if (p.x < p.y) p.xy = p.yx;
  if (p.x < p.z) p.xz = p.zx;
  if (p.y < p.z) p.yz = p.zy;
  p = abs(p);
}

float dKifs(vec3 p, float scale, float offset, out float trap) {
  trap = 1e9;
  for (int i = 0; i < 8; i++) {
    octFold(p);
    p.xy *= rot2(uTime * 0.31 + uMid * 1.5);
    p.xz *= rot2(uTime * 0.19 + uMid * 0.9);
    p = p * scale - offset * (scale - 1.0);
    trap = min(trap, dot(p, p));
  }
  return (length(p) - 1.5) * pow(scale, -8.0);
}

vec3 cospal(float t, vec3 a, vec3 b) {
  return a + b * cos(6.2832 * (t * vec3(1.0, 0.85, 0.7) + vec3(0.0, 0.15, 0.3)));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  float scale  = 2.0 + uBass * 0.6;
  float offset = 1.0 + uBeat * 0.45;

  vec3 ro = vec3(0.0, 0.0, 4.5);
  vec3 rd = normalize(vec3(uv, -1.8));

  float ang = uTime * 0.22;
  ro.xz *= rot2(ang);
  rd.xz *= rot2(ang);
  ro.yz *= rot2(uTime * 0.13);
  rd.yz *= rot2(uTime * 0.13);

  float t = 0.0;
  float trap = 1e9;
  bool hit = false;
  for (int i = 0; i < 64; i++) {
    vec3 p = ro + rd * t;
    float trap_i;
    float d = dKifs(p, scale, offset, trap_i);
    trap = min(trap, trap_i);
    if (d < 0.001) { hit = true; break; }
    if (t > 20.0) break;
    t += max(d * 0.55, 0.001);
  }

  vec3 col = vec3(0.0);
  if (hit) {
    float trapN = clamp(sqrt(trap) * 0.08, 0.0, 1.0);
    vec3 base = cospal(trapN, uPrimary * 0.5, uAccent * 0.5);

    // edge glint from treble
    float edge = exp(-t * 0.18) * (0.5 + 0.5 * uTreble);
    col = base * (0.6 + 0.4 * edge);
    col += uAccent * uTreble * 0.5 * pow(edge, 3.0);

    // depth fog
    col *= exp(-t * 0.07);
  }

  col = pow(max(col, vec3(0.0)), vec3(0.8));
  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uBass', 'uMid', 'uTreble', 'uBeat', 'uPrimary', 'uAccent',
] as const;

export function createKifsOctahedron(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'kifs-octahedron',
    name: 'KIFS Octahedron Bloom',
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
      gl.uniform1f(u.uBass, frame.audio.bass);
      gl.uniform1f(u.uMid, frame.audio.mid);
      gl.uniform1f(u.uTreble, frame.audio.treble);
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
