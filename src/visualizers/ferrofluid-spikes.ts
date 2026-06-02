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

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float spikedSphere(vec3 p, float bass, float mid, float beat, float t) {
  float r = length(p);
  vec3 d = p / max(r, 0.0001);
  float theta = acos(clamp(d.y, -1.0, 1.0));
  float phi   = atan(d.z, d.x);
  float N = 6.0 + floor(mid * 10.0);
  float spike = pow(max(0.0, sin(theta * N + t * 0.7)), 8.0) * bass;
  spike      += pow(max(0.0, sin(phi   * N - t * 0.5)), 8.0) * bass * 0.6;
  float burst = beat * 0.35 * exp(-mod(t, 3.14159) * 2.0);
  return r - (0.5 + spike * 0.55 + burst);
}

vec3 calcNormal(vec3 p, float bass, float mid, float beat, float t) {
  const float e = 0.002;
  return normalize(vec3(
    spikedSphere(p + vec3(e,0,0), bass, mid, beat, t) - spikedSphere(p - vec3(e,0,0), bass, mid, beat, t),
    spikedSphere(p + vec3(0,e,0), bass, mid, beat, t) - spikedSphere(p - vec3(0,e,0), bass, mid, beat, t),
    spikedSphere(p + vec3(0,0,e), bass, mid, beat, t) - spikedSphere(p - vec3(0,0,e), bass, mid, beat, t)
  ));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  float t = uTime * 0.5;

  vec3 ro = vec3(0.0, 0.0, 2.0);
  vec3 rd = normalize(vec3(uv, -1.4));

  float tHit = -1.0;
  float rayT = 0.1;
  for (int i = 0; i < 64; i++) {
    vec3 p = ro + rd * rayT;
    float d = spikedSphere(p, uBass, uMid, uBeat, t);
    if (d < 0.001) { tHit = rayT; break; }
    if (rayT > 6.0) break;
    rayT += max(d * 0.6, 0.005);
  }

  vec3 col = vec3(0.0);

  if (tHit > 0.0) {
    vec3 p  = ro + rd * tHit;
    vec3 n  = calcNormal(p, uBass, uMid, uBeat, t);
    vec3 lA = normalize(vec3(1.5, 2.0, 2.0));
    vec3 lB = normalize(vec3(-1.2, -0.5, 1.0));
    vec3 v  = -rd;
    vec3 h  = normalize(lA + v);

    float diff  = max(dot(n, lA), 0.0) * 0.4 + max(dot(n, lB), 0.0) * 0.15;
    float spec  = pow(max(dot(n, h), 0.0), 64.0);
    float fres  = pow(1.0 - max(dot(n, v), 0.0), 3.5);
    float glint = hash(p * 18.0 + vec3(t)) * uTreble * spec;

    vec3 base   = vec3(0.04, 0.04, 0.05);
    vec3 metal  = base + diff * vec3(0.12, 0.13, 0.16);
    vec3 rim    = uPrimary * fres * 0.9;
    vec3 hilite = uAccent  * spec * (1.2 + glint * 2.5);

    col = metal + rim + hilite;
    col = pow(clamp(col, 0.0, 1.0), vec3(0.4545));
  } else {
    float vign = 1.0 - smoothstep(0.5, 1.5, length(uv));
    col = vec3(0.01) * vign;
  }

  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uBass', 'uMid', 'uTreble', 'uBeat', 'uPrimary', 'uAccent',
] as const;

export function createFerrofluidSpikes(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'ferrofluid-spikes',
    name: 'Ferrofluid Spikes',
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
      gl.uniform1f(u.uTime,   frame.time);
      gl.uniform1f(u.uBass,   frame.audio.bass);
      gl.uniform1f(u.uMid,    frame.audio.mid);
      gl.uniform1f(u.uTreble, frame.audio.treble);
      gl.uniform1f(u.uBeat,   frame.audio.beat);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent,  frame.palette.accent[0],  frame.palette.accent[1],  frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
    },
  };
}
