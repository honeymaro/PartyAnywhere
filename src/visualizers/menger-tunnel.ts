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

float sdCross(vec3 p, float r) {
  vec3 d = abs(p) - r;
  float a = max(d.x, d.y);
  float b = max(d.y, d.z);
  float c = max(d.x, d.z);
  return min(a, min(b, c));
}

float mengerDE(vec3 p) {
  float scale = 1.0;
  float d = -1e10;
  for (int i = 0; i < 4; i++) {
    p = abs(p);
    p -= 1.5;
    p = abs(p);
    p -= 0.5;
    float s = 3.0 + uMid * 0.4;
    p *= s;
    scale *= s;
    float c = sdCross(p, 1.0) / scale;
    d = max(d, c);
  }
  return d;
}

mat2 rot2(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - uResolution) / min(uResolution.x, uResolution.y);

  // Beat-snapped rotation: accumulate in discrete steps
  float beatSnap = floor(uBeat * 4.0) * 0.3927; // pi/8 steps
  float rotAngle = uTime * 0.15 * (1.0 + uMid * 0.5) + beatSnap;

  // Camera flying forward through the tunnel
  float speed = uTime * 0.8 + uBass * 2.0;
  vec3 ro = vec3(0.0, 0.0, -speed);
  vec3 rd = normalize(vec3(uv, 1.6));

  // Apply global roll to ray direction
  rd.xy = rot2(rotAngle) * rd.xy;

  // Raymarch
  float t = 0.0;
  float hit = 0.0;
  int steps = 0;
  for (int i = 0; i < 80; i++) {
    vec3 p = ro + rd * t;
    // Tile the tunnel along z
    p.z = mod(p.z, 3.0) - 1.5;
    float d = mengerDE(p);
    if (d < 0.001) { hit = 1.0; steps = i; break; }
    if (t > 20.0) { steps = i; break; }
    t += max(d * 0.5, 0.002);
    steps = i;
  }

  // AO from step count (fewer steps = brighter, more open)
  float ao = 1.0 - float(steps) / 80.0;
  ao = clamp(ao * 1.4, 0.0, 1.0);

  // Depth fog
  float fog = exp(-t * 0.08);

  // Edge highlight via treble: brighten near-miss rays (small d at last step)
  vec3 p_edge = ro + rd * t;
  p_edge.z = mod(p_edge.z, 3.0) - 1.5;
  float edgeDist = abs(mengerDE(p_edge));
  float edge = uTreble * smoothstep(0.1, 0.0, edgeDist) * 0.6;

  // Surface color: mix primary->accent by AO, darken recesses
  vec3 surfCol = mix(uPrimary * 0.1, uAccent, ao * ao);
  surfCol += edge * uAccent;

  // Fog blend to primary background
  vec3 col = mix(uPrimary * 0.05, surfCol, fog);

  // No hit (open space inside tunnel) goes dark with primary tint
  if (hit < 0.5) {
    col = uPrimary * 0.04 * fog;
  }

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uBass', 'uMid', 'uTreble', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createMengerTunnel(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'menger-tunnel',
    name: 'Menger Sponge Tunnel',
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
