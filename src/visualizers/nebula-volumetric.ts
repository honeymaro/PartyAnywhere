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

float hash(vec3 p) {
  p = fract(p * vec3(127.1, 311.7, 74.7));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), u.x),
                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), u.x), u.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), u.x),
                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), u.x), u.y), u.z);
}

float fbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.1 + vec3(5.7, 3.2, 1.9);
    a *= 0.5;
  }
  return v;
}

vec3 curl(vec3 p) {
  float e = 0.1;
  float nx1 = noise(p + vec3(e, 0, 0)), nx2 = noise(p - vec3(e, 0, 0));
  float ny1 = noise(p + vec3(0, e, 0)), ny2 = noise(p - vec3(0, e, 0));
  float nz1 = noise(p + vec3(0, 0, e)), nz2 = noise(p - vec3(0, 0, e));
  return vec3(ny1 - ny2 - nz1 + nz2, nz1 - nz2 - nx1 + nx2, nx1 - nx2 - ny1 + ny2) / (2.0 * e);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  // Slow camera drift
  float t = uTime * 0.12;
  vec3 ro = vec3(sin(t) * 0.8, cos(t * 0.7) * 0.5, t * 0.3);
  vec3 rd = normalize(vec3(uv, 1.5));

  // Ray slab march through volumetric gas cloud
  float tNear = 1.0, tFar = 4.0;
  int steps = 40;
  float dt = (tFar - tNear) / float(steps);

  vec3 accum = vec3(0.0);
  float transmittance = 1.0;
  float bloomScale = 1.0 + uBeat * 1.8;

  for (int i = 0; i < 40; i++) {
    float tStep = tNear + (float(i) + 0.5) * dt;
    vec3 p = ro + rd * tStep;

    // Curl warp driven by uMid
    vec3 warp = curl(p * 1.3 + vec3(0.0, 0.0, uTime * 0.05)) * uMid * 1.5;
    vec3 sp = p + warp;

    float density = fbm(sp * 1.8 * bloomScale + vec3(uTime * 0.04)) * (0.4 + uBass * 1.2);
    density = max(0.0, density - 0.25);

    if (density > 0.0) {
      vec3 emission = mix(uPrimary, uAccent, clamp(density * 2.5, 0.0, 1.0)) * density;
      emission *= (0.6 + uLevel * 1.4);
      float absorption = density * 2.5 * dt;
      accum += emission * transmittance * dt * 8.0;
      transmittance *= exp(-absorption);
      if (transmittance < 0.01) break;
    }
  }

  // Starfield overlay with uTreble twinkle
  vec2 starCell = floor(uv * 80.0);
  vec2 starUV = fract(uv * 80.0) - 0.5;
  float starSeed = hash2(starCell);
  float starBrightness = step(0.97, starSeed);
  float twinkle = 0.7 + 0.3 * sin(uTime * (3.0 + starSeed * 5.0) + starSeed * 6.28);
  float starGlow = starBrightness * twinkle * (1.0 + uTreble * 2.0);
  float starDist = length(starUV);
  starGlow *= smoothstep(0.12, 0.0, starDist);
  vec3 stars = vec3(starGlow);

  vec3 color = accum + stars;

  // HDR Reinhard tonemap
  color = color / (color + vec3(1.0));
  color = pow(color, vec3(0.4545));

  fragColor = vec4(color, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uLevel', 'uBass', 'uMid', 'uTreble', 'uBeat',
  'uPrimary', 'uAccent',
] as const;

export function createNebulaVolumetric(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'nebula-volumetric',
    name: 'Cyber-Organic Nebula',
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
