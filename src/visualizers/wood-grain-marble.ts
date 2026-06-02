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
uniform float uTreble;
uniform vec3 uPrimary;
uniform vec3 uAccent;

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float val = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  for (int i = 0; i < 5; i++) {
    val += amp * noise(p * freq);
    freq *= 2.1;
    amp *= 0.5;
  }
  return val;
}

float turbulence(vec2 p) {
  float val = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  for (int i = 0; i < 5; i++) {
    val += amp * abs(noise(p * freq) * 2.0 - 1.0);
    freq *= 2.1;
    amp *= 0.5;
  }
  return val;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  uv = uv * 2.0 - 1.0;
  uv.x *= uResolution.x / uResolution.y;

  float t = uTime * 0.05;
  float midAmp = 1.0 + uMid * 3.0;
  float trebleGrain = uTreble * 0.4;

  // Warp coordinates with fbm for organic look
  vec2 warpUV = uv * 3.0 + vec2(t * 0.3, t * 0.2);
  vec2 offset = vec2(
    fbm(warpUV + vec2(1.7, 9.2)),
    fbm(warpUV + vec2(8.3, 2.8))
  );
  vec2 warpedUV = uv * 3.0 + offset * midAmp;

  // Turbulence for vein chaos
  float turb = turbulence(warpedUV + vec2(t * 0.5, t * 0.3));

  // Micro grain from treble
  float microGrain = noise(uv * 18.0 + vec2(t * 2.1, t * 1.7)) * trebleGrain;
  turb += microGrain;

  // Marble/wood vein formula: sin of warped position + turbulence
  float veinPhase = (uv.x * 2.5 + turb * 3.0 + t) * 3.14159265;
  float marble = sin(veinPhase);

  // Level-driven slow drift adds undulation
  float drift = uLevel * 2.0 * sin(uv.y * 5.0 + uTime * 0.12);
  marble = sin(veinPhase + drift);

  // Wood ring bands via smoothstep
  float rings = smoothstep(0.0, 0.35, marble) * smoothstep(1.0, 0.65, marble);
  float vein = smoothstep(0.55, 0.85, marble);

  // Base wood color: dark to light primary
  vec3 woodBase = mix(uPrimary * 0.55, uPrimary * 1.15, rings);

  // Bass-driven contrast in vein sharpness
  float bassContrast = 1.0 + uBass * 2.5;
  float sharpVein = pow(clamp(vein, 0.0, 1.0), bassContrast);

  // Electric accent veins
  vec3 col = mix(woodBase, uAccent, sharpVein * 0.85);

  // Subtle highlight on marble peaks
  float highlight = smoothstep(0.7, 1.0, marble) * 0.18;
  col += uPrimary * highlight;

  // Tone-map and gamma
  col = clamp(col, 0.0, 1.0);
  col = pow(col, vec3(0.85));

  fragColor = vec4(col, 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uLevel', 'uBass', 'uMid', 'uTreble', 'uPrimary', 'uAccent'] as const;

export function createWoodGrainMarble(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'wood-grain-marble',
    name: 'Wood Grain and Marble',
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
