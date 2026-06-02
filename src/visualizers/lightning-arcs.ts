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
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

// Hash for pseudo-random values
float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Value noise
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash2(i);
  float b = hash2(i + vec2(1.0, 0.0));
  float c = hash2(i + vec2(0.0, 1.0));
  float d = hash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Fractional Brownian Motion
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.1 + vec2(1.3, 0.7);
    a *= 0.5;
  }
  return v;
}

// Glow from a bolt at given x-center, uv position, thickness scale
float boltGlow(float boltX, float uvX, float thickness) {
  float dist = abs(uvX - boltX);
  float core = smoothstep(0.004 * thickness, 0.0, dist);
  float haze = thickness * 0.012 / (dist + 0.001);
  return core + haze * 0.4;
}

void main() {
  vec2 uv = (gl_FragCoord.xy / uResolution) * 2.0 - 1.0;
  uv.x *= uResolution.x / uResolution.y;

  // Strike epoch — changes 6 times per second, gated by uBeat influence
  float strikeRate = 6.0 + uBeat * 4.0;
  float strikePhase = uTime * strikeRate;
  float strikeId = floor(strikePhase);
  float strikeFrac = fract(strikePhase);

  // Flash intensity: sharp attack, exponential decay
  float flash = exp(-strikeFrac * 5.0);
  // uBeat boosts flash brightness
  flash *= 0.3 + uBeat * 0.7;

  // Main bolt path: fbm over (y * 4, strikeId) so it changes each strike
  float uvY01 = uv.y * 0.5 + 0.5; // remap to [0,1]
  float trebleJitter = uTreble * 0.18;
  float mainPath = (fbm(vec2(uvY01 * 4.0, strikeId)) - 0.5) * 1.4
                 + trebleJitter * (fbm(vec2(uvY01 * 9.0, strikeId + 0.5)) - 0.5);

  float bassThickness = 1.0 + uBass * 3.0;

  // Main bolt glow
  float glow = boltGlow(mainPath, uv.x, bassThickness) * flash;

  // Branch bolt 1 — splits off in upper half
  float br1SeedY = 0.55 + hash(strikeId * 3.71) * 0.3;
  float br1Path = mainPath + (fbm(vec2(uvY01 * 6.0, strikeId + 10.0)) - 0.5) * 0.5;
  float br1Mask = smoothstep(br1SeedY - 0.02, br1SeedY, uvY01) * smoothstep(br1SeedY + 0.35, br1SeedY + 0.3, uvY01);
  glow += boltGlow(br1Path, uv.x, bassThickness * 0.6) * flash * br1Mask * 0.7;

  // Branch bolt 2 — splits off in lower half
  float br2SeedY = 0.15 + hash(strikeId * 7.13) * 0.3;
  float br2Path = mainPath + (fbm(vec2(uvY01 * 5.0, strikeId + 20.0)) - 0.5) * 0.55;
  float br2Mask = smoothstep(br2SeedY - 0.02, br2SeedY, uvY01) * smoothstep(br2SeedY + 0.3, br2SeedY + 0.25, uvY01);
  glow += boltGlow(br2Path, uv.x, bassThickness * 0.5) * flash * br2Mask * 0.6;

  // Branch bolt 3 — mid range
  float br3SeedY = 0.3 + hash(strikeId * 5.37) * 0.25;
  float br3Path = mainPath - (fbm(vec2(uvY01 * 7.0, strikeId + 30.0)) - 0.5) * 0.45;
  float br3Mask = smoothstep(br3SeedY - 0.02, br3SeedY, uvY01) * smoothstep(br3SeedY + 0.28, br3SeedY + 0.22, uvY01);
  glow += boltGlow(br3Path, uv.x, bassThickness * 0.45) * flash * br3Mask * 0.5;

  // Ambient electric haze — always present, driven by uLevel and uMid
  float haze = fbm(uv * 1.8 + vec2(uTime * 0.12, uTime * 0.08));
  float ambientStrength = 0.06 + uLevel * 0.12 + uMid * 0.08;
  float ambient = haze * ambientStrength;

  // Color: bolt core blends white -> uAccent, outer haze uses uPrimary
  float coreWeight = clamp(glow, 0.0, 1.0);
  vec3 boltColor = mix(uAccent, vec3(1.0), coreWeight * 0.85);
  vec3 hazeColor = uPrimary * ambient;

  // Additive composition on near-black background
  vec3 col = boltColor * glow + hazeColor;

  // Slight electric shimmer from uTreble
  float shimmer = uTreble * 0.06 * sin(uv.y * 40.0 + uTime * 30.0) * flash;
  col += shimmer * uAccent;

  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uLevel', 'uBass', 'uMid', 'uTreble', 'uBeat',
  'uPrimary', 'uAccent',
] as const;

export function createLightningArcs(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'lightning-arcs',
    name: 'Branching Lightning',
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
