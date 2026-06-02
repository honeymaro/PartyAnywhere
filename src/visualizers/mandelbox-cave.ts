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

// Mandelbox distance estimator
// boxFold: clamp each component to [-1,1], reflect: p = 2*clamp - p
// sphereFold: if |p|^2 < minR^2, scale by minR^2; else if < 1, scale by 1/|p|^2
float mandelboxDE(vec3 pos, float scale, float foldOffset) {
  vec3 p = pos;
  float dr = 1.0;
  float minR2 = 0.25;
  float fixedR2 = 1.0;

  for (int i = 0; i < 10; i++) {
    // box fold
    p = clamp(p, -1.0, 1.0) * 2.0 - p;

    // sphere fold
    float r2 = dot(p, p);
    if (r2 < minR2) {
      float k = fixedR2 / minR2;
      p *= k;
      dr *= k;
    } else if (r2 < fixedR2) {
      float k = fixedR2 / r2;
      p *= k;
      dr *= k;
    }

    p = p * scale + pos + vec3(foldOffset, foldOffset * 0.7, foldOffset * 1.3);
    dr = dr * abs(scale) + 1.0;
  }

  return (length(p) - abs(scale - 1.0) * 0.8) / abs(dr);
}

// Orbit trap: accumulate minimum distance to origin over iterations
float orbitTrap(vec3 pos, float scale, float foldOffset) {
  vec3 p = pos;
  float trap = 1e9;
  float minR2 = 0.25;
  float fixedR2 = 1.0;

  for (int i = 0; i < 10; i++) {
    p = clamp(p, -1.0, 1.0) * 2.0 - p;
    float r2 = dot(p, p);
    trap = min(trap, r2);
    if (r2 < minR2) {
      p *= fixedR2 / minR2;
    } else if (r2 < fixedR2) {
      p *= fixedR2 / r2;
    }
    p = p * scale + pos + vec3(foldOffset, foldOffset * 0.7, foldOffset * 1.3);
  }

  return clamp(trap, 0.0, 1.0);
}

// Cosine palette
vec3 cosPalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.28318 * (c * t + d));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  // Audio-driven parameters
  float scale = 2.0 + sin(uTime * 0.3) * 0.3 + uMid * 0.5;
  float foldOffset = sin(uTime * 0.17) * 0.15 + uBeat * 0.25;
  float dolly = uTime * 0.4 + uBass * 1.5;

  // Camera: fly into the cave along Z with a gentle spiral
  vec3 ro = vec3(sin(uTime * 0.11) * 0.4, cos(uTime * 0.07) * 0.3, -dolly);
  vec3 target = ro + vec3(sin(uTime * 0.13) * 0.1, sin(uTime * 0.09) * 0.1, 1.0);
  vec3 fwd = normalize(target - ro);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  vec3 rd = normalize(uv.x * right + uv.y * up + 1.6 * fwd);

  // Raymarch
  float t = 0.02;
  float dist = 0.0;
  int steps = 0;
  const int MAX_STEPS = 64;
  const float MAX_DIST = 20.0;
  const float HIT_DIST = 0.002;

  for (int i = 0; i < MAX_STEPS; i++) {
    vec3 p = ro + rd * t;
    dist = mandelboxDE(p, scale, foldOffset);
    if (dist < HIT_DIST || t > MAX_DIST) { steps = i; break; }
    t += dist * 0.6;
    steps = i;
  }

  bool hit = dist < HIT_DIST && t <= MAX_DIST;

  // Ambient occlusion from step count
  float ao = 1.0 - float(steps) / float(MAX_STEPS);

  // Orbit trap at hit point
  float trap = orbitTrap(ro + rd * t, scale, foldOffset);

  // Color
  float colorT = trap * 0.5 + (1.0 - ao) * 0.5;
  vec3 a = uPrimary * 0.5;
  vec3 b = (uAccent - uPrimary) * 0.5 + 0.5;
  vec3 c = vec3(1.0, 0.9, 1.1);
  vec3 d = vec3(0.0, 0.15, 0.3);
  vec3 col = cosPalette(colorT, a, b, c, d);

  // AO darkening
  col *= ao * ao * 2.0;

  // Treble edge sparkle: brighten high-step-count regions (edges/details)
  float edge = 1.0 - ao;
  col += uTreble * edge * edge * uAccent * 1.5;

  // Depth fog
  float fog = exp(-t * 0.08);
  col = mix(uPrimary * 0.03, col, fog);

  if (!hit) {
    col = uPrimary * 0.03 + uAccent * 0.01 * ao;
  }

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uBass', 'uMid', 'uTreble', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createMandelboxCave(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'mandelbox-cave',
    name: 'Mandelbox Crystal Cave',
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
