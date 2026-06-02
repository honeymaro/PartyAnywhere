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

// Hash for pseudo-random drop positions
vec2 hash2(float n) {
  return fract(sin(vec2(n, n + 1.0)) * vec2(43758.5453, 22578.1459));
}

// Fractional Brownian Motion
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  vec2 shift = vec2(100.0);
  for (int i = 0; i < 5; i++) {
    v += a * (sin(p.x) * cos(p.y) + sin(p.x * 1.7 + p.y * 1.3));
    p = p * 2.1 + shift;
    a *= 0.5;
  }
  return v;
}

// Surface height at point p
float surfaceHeight(vec2 p) {
  float t = uTime;
  // Base fbm surface with mid-driven flow
  vec2 flowUV = p * 3.0 + vec2(uMid * 0.4, uMid * 0.3) * t + t * 0.1;
  float h = fbm(flowUV) * 0.18;

  // Beat-spawned concentric drop rings from 4 drop positions
  for (int i = 0; i < 4; i++) {
    vec2 dropPos = hash2(float(i) * 7.3 + floor(uBeat * 0.5 + float(i) * 0.25)) * 2.0 - 1.0;
    float d = length(p - dropPos);
    float phase = uTime * 8.0 - float(i) * 1.5;
    float ring = sin(d * 30.0 - phase) * exp(-d * 4.0) * exp(-uTime * 0.3 + floor(uBeat * 0.5 + float(i) * 0.25) * 0.3);
    h += ring * (0.06 + uBass * 0.18);
  }

  // Treble micro-ripples
  h += sin(p.x * 40.0 + uTime * 3.0) * sin(p.y * 37.0 + uTime * 2.7) * uTreble * 0.03;

  return h;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  // Compute surface normal via finite differences
  float eps = 0.004;
  float hC = surfaceHeight(uv);
  float hR = surfaceHeight(uv + vec2(eps, 0.0));
  float hU = surfaceHeight(uv + vec2(0.0, eps));
  vec3 normal = normalize(vec3(hC - hR, hC - hU, eps * 6.0));

  // Incident view ray (top-down, slight angle)
  vec3 viewDir = normalize(vec3(0.0, 0.0, 1.0));

  // Reflect off normal to get sky direction
  vec3 reflectDir = reflect(-viewDir, normal);

  // Sample fake sky gradient by reflect.y
  float skyT = clamp(reflectDir.y * 0.5 + 0.5 + hC * 0.8, 0.0, 1.0);
  vec3 skyColor = mix(uPrimary, uAccent, skyT);

  // Fresnel factor (grazing = more reflective)
  float fresnel = pow(1.0 - clamp(dot(viewDir, normal), 0.0, 1.0), 2.5);
  fresnel = mix(0.4, 1.0, fresnel);

  // Specular sun highlight — sharp metallic peak
  vec3 lightDir = normalize(vec3(0.4, 0.3, 1.0));
  float spec = pow(clamp(dot(reflectDir, lightDir), 0.0, 1.0), 120.0 + uTreble * 200.0);
  spec += pow(clamp(dot(reflectDir, lightDir), 0.0, 1.0), 8.0) * 0.08;

  // Mercury tint: desaturate sky toward silvery gray
  vec3 mercuryTint = vec3(0.72, 0.75, 0.78);
  vec3 col = mix(skyColor, mercuryTint, 0.35) * fresnel;

  // Add specular highlight (white-hot)
  col += vec3(spec * (1.0 + uTreble * 0.5));

  // Subtle bass pulse darkening at edges
  float edge = length(uv) * (1.0 + uBass * 0.4);
  col *= 1.0 - smoothstep(0.7, 1.4, edge) * 0.6;

  fragColor = vec4(col, 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uBass', 'uMid', 'uTreble', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createLiquidMercuryPool(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'liquid-mercury-pool',
    name: 'Liquid Mercury Pool',
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
