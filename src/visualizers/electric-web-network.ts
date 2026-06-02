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

// Hash for pseudo-random values
float hash(float n) { return fract(sin(n) * 43758.5453123); }
vec2 hash2(float n) { return vec2(hash(n), hash(n + 17.31)); }

// Segment distance field: returns (dist, t along segment)
vec2 segSDF(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
  return vec2(length(p - (a + t * ab)), t);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  float speed = 0.18 + uMid * 0.45;
  float bassGlow = 0.5 + uBass * 1.2;
  float beatPulse = uBeat * 2.5;

  // Build 12 drifting nodes
  const int N = 12;
  vec2 nodes[12];
  for (int i = 0; i < N; i++) {
    float fi = float(i);
    vec2 seed = hash2(fi * 3.7 + 1.1);
    vec2 base = (seed - 0.5) * 1.6;
    float ox = sin(uTime * speed * (0.6 + seed.x * 0.8) + fi * 2.39996) * 0.18;
    float oy = cos(uTime * speed * (0.5 + seed.y * 0.7) + fi * 1.61803) * 0.18;
    nodes[i] = base + vec2(ox, oy);
  }

  vec3 col = vec3(0.02, 0.02, 0.06); // dark background

  // Connection threshold in UV space
  float threshold = 0.55;

  // Draw edges between nearby node pairs
  for (int i = 0; i < N; i++) {
    for (int j = i + 1; j < N; j++) {
      float dist_ij = length(nodes[i] - nodes[j]);
      if (dist_ij < threshold) {
        float fi = float(i);
        float fj = float(j);
        float edgeHash = hash(fi * 13.7 + fj * 7.3);
        vec2 sd = segSDF(uv, nodes[i], nodes[j]);
        float lineDist = sd.x;
        float tAlong = sd.y;

        // Fade by proximity: closer nodes = brighter edge
        float edgeFade = 1.0 - dist_ij / threshold;
        float lineGlow = edgeFade * bassGlow * 0.012 / (lineDist + 0.004);
        lineGlow = clamp(lineGlow, 0.0, 1.2);

        // Traveling pulse along edge
        float pulseSpeed = 0.7 + edgeHash * 0.6;
        float pulsePos = fract(uTime * pulseSpeed + edgeHash);
        float pulseBeat = fract(uTime * pulseSpeed * 0.5 + edgeHash + 0.5);
        float pulse = exp(-abs(tAlong - pulsePos) * 28.0) * 0.7;
        pulse += exp(-abs(tAlong - pulseBeat) * 20.0) * beatPulse * 0.5;
        pulse *= exp(-lineDist * 90.0);

        // Lines are uPrimary, pulses blend toward uAccent
        col += uPrimary * lineGlow;
        col += mix(uPrimary, uAccent, pulse) * pulse * 1.8;
      }
    }
  }

  // Node glows (uAccent, boosted by uTreble)
  for (int i = 0; i < N; i++) {
    float fi = float(i);
    float d = length(uv - nodes[i]);
    float twinkle = 0.75 + 0.25 * sin(uTime * (2.1 + hash(fi) * 3.0) + fi * 4.7);
    float nodeGlow = (0.004 + uTreble * 0.003) * twinkle / (d * d + 0.0003);
    float core = exp(-d * 120.0) * (1.0 + beatPulse * 0.8) * twinkle;
    col += uAccent * clamp(nodeGlow, 0.0, 2.5);
    col += uAccent * core;
  }

  col = clamp(col, 0.0, 1.0);
  // Subtle vignette
  float vign = 1.0 - smoothstep(0.6, 1.3, length(uv));
  col *= vign;

  fragColor = vec4(col, 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uBass', 'uMid', 'uTreble', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createElectricWebNetwork(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'electric-web-network',
    name: 'Electric Node Network',
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
