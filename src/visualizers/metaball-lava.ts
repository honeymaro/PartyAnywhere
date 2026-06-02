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

// Lissajous orbit for blob center i
vec2 blobCenter(int i, float t, float speed) {
  float fi = float(i);
  float ax = 0.35 + 0.05 * sin(fi * 1.3);
  float ay = 0.35 + 0.05 * cos(fi * 0.9);
  float px = fi * 1.0472; // phase offset per blob (PI/3)
  float py = fi * 0.7854; // PI/4
  float rx = 3.0 + mod(fi, 3.0);
  float ry = 2.0 + mod(fi * 1.7, 3.0);
  return vec2(
    ax * sin(rx * t * speed + px),
    ay * cos(ry * t * speed + py)
  );
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  float t = uTime * 0.25;
  float speed = 1.0 + uMid * 2.5;
  float radiusSq = 0.018 * (1.0 + uBass * 2.2);

  // Sum inverse-square potential from 6 blobs
  float potential = 0.0;
  for (int i = 0; i < 6; i++) {
    vec2 center = blobCenter(i, t, speed);
    vec2 d = uv - center;
    potential += radiusSq / dot(d, d);
  }

  // uBeat raises the iso-threshold so blobs merge
  float threshold = 1.0 + uBeat * 1.8;

  // Normalized field value relative to threshold
  float field = potential / threshold;

  // Blob body: smooth iso-surface
  float body = smoothstep(0.85, 1.05, field);

  // Inner glow rings: band the field with sine
  float rings = 0.5 + 0.5 * sin(field * 12.0 - uTime * 1.5);
  float innerGlow = body * rings * 0.55;

  // Surface noise driven by uTreble
  float noiseVal = sin(uv.x * 31.7 + uTime * 3.1) * sin(uv.y * 27.3 - uTime * 2.4);
  float surfaceNoise = uTreble * 0.08 * noiseVal * body;

  // Halo: field just below threshold
  float haloMask = smoothstep(0.55, 0.85, field) * (1.0 - body);

  // Color: core = uPrimary, rim/accent = uAccent
  float colorT = clamp(1.0 - field * 0.7, 0.0, 1.0);
  vec3 bodyColor = mix(uAccent, uPrimary, colorT);
  bodyColor += innerGlow * uAccent;
  bodyColor += surfaceNoise;

  vec3 haloColor = uAccent * 0.45;

  vec3 col = bodyColor * body + haloColor * haloMask;

  // Dark background with faint ambient glow
  float ambient = potential * 0.012;
  col += mix(uPrimary, uAccent, 0.5) * ambient * (1.0 - body);

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uBass', 'uMid', 'uTreble', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createMetaballLava(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'metaball-lava',
    name: 'Metaball Lava Lamp',
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
