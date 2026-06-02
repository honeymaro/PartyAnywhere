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

vec2 rot2(vec2 v, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

float tunnelSDF(vec3 p, float radius) {
  // Infinite repeat along z using fract
  float rep = fract(p.z * 0.25) * 4.0 - 2.0;
  // Twist p.xy by depth and audio
  float twistAngle = p.z * (0.4 + uMid * 1.2) + uTime * 0.5;
  vec2 twisted = rot2(p.xy, twistAngle);
  // Tunnel wall: cylindrical shell with torus-like ripple detail
  float r = length(twisted);
  float pulse = 0.18 + uBeat * 0.12;
  float ripple = 0.045 * sin(p.z * 6.0 + uTime * 2.0) * sin(atan(twisted.y, twisted.x) * 5.0 + uTime);
  return (radius + pulse + ripple) - r;
}

vec3 cosPalette(float t, vec3 a, vec3 b) {
  // Cosine palette between uPrimary (a) and uAccent (b)
  vec3 c = 0.5 * (a + b);
  vec3 d = 0.5 * (b - a);
  return c + d * cos(6.2832 * t + vec3(0.0, 0.33, 0.67));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  // Camera marches forward along +z; bass boosts speed
  float speed = uTime * (1.4 + uBass * 2.5);
  vec3 ro = vec3(0.0, 0.0, speed);
  vec3 rd = normalize(vec3(uv, 1.6));

  float radius = 1.1;
  float t = 0.0;
  float minOrbit = 1e9;
  bool hit = false;

  for (int i = 0; i < 48; i++) {
    vec3 p = ro + rd * t;
    float d = tunnelSDF(p, radius);
    // Orbit trap: track min distance to tunnel axis
    float orbitR = length(p.xy);
    minOrbit = min(minOrbit, orbitR);
    if (d < 0.002) { hit = true; break; }
    t += max(d * 0.5, 0.008);
    if (t > 28.0) break;
  }

  vec3 col = vec3(0.0);
  if (hit) {
    float trap = clamp(minOrbit / (radius + 0.3), 0.0, 1.0);
    col = cosPalette(trap, uPrimary, uAccent);

    // Fog by depth
    float fog = exp(-t * 0.055);
    col *= fog;

    // Treble specular streaks: bright band near tunnel centre on each repeat
    vec3 hp = ro + rd * t;
    float twA = hp.z * (0.4 + uMid * 1.2) + uTime * 0.5;
    vec2 twistedHP = rot2(hp.xy, twA);
    float streak = pow(max(0.0, 1.0 - abs(length(twistedHP) - radius + 0.05) * 18.0), 3.0);
    col += uTreble * 0.6 * streak * (uPrimary + uAccent);
  } else {
    // Deep-tunnel void: faint ambient glow so pure black is avoided
    float glow = 0.04 + 0.04 * sin(uTime * 0.7);
    col = mix(uPrimary, uAccent, 0.5) * glow;
  }

  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uBass', 'uMid', 'uTreble', 'uBeat', 'uPrimary', 'uAccent',
] as const;

export function createRaymarchTwistTunnel(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'raymarch-twist-tunnel',
    name: 'Twisting SDF Tunnel',
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
