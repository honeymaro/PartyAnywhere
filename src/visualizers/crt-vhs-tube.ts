import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uLevel;
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

float hash(float n) { return fract(sin(n) * 43758.5453123); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec2 barrel(vec2 uv) {
  vec2 d = uv - 0.5;
  float r2 = dot(d, d);
  float k = 0.18 + 0.06 * uBass;
  return uv + d * (k * r2 + 0.04 * r2 * r2);
}

void main() {
  vec2 fragUV = gl_FragCoord.xy / uResolution;

  // Vertical hold wobble driven by uBass
  float holdShift = uBass * 0.025 * sin(uTime * 3.1 + fragUV.y * 8.0);
  vec2 distUV = barrel(fragUV + vec2(0.0, holdShift));

  // Outside tube: black borders
  if (distUV.x < 0.0 || distUV.x > 1.0 || distUV.y < 0.0 || distUV.y > 1.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // --- Tracking noise: row displacement on beat ---
  float rowId = floor(distUV.y * uResolution.y);
  float beatPhase = floor(uBeat * 4.0);
  float rowNoise = hash(rowId * 0.31 + beatPhase * 7.13);
  float trackShift = 0.0;
  // Rolling bad-track bar
  float barY = fract(uTime * 0.18 + uBeat * 0.5);
  float inBar = smoothstep(0.04, 0.0, abs(distUV.y - barY) - 0.015);
  trackShift = (rowNoise - 0.5) * 0.012 * inBar
             + (hash(rowId * 0.07 + uTime * 0.3) - 0.5) * 0.004 * uBeat;

  vec2 tubeUV = distUV + vec2(trackShift, 0.0);
  tubeUV = clamp(tubeUV, 0.0, 1.0);

  // --- Procedural plasma content layer ---
  vec2 p = tubeUV * 2.0 - 1.0;
  float t = uTime * 0.35;
  float plasma =  sin(p.x * 3.5 + t)
                + sin(p.y * 3.5 - t * 1.1)
                + sin((p.x + p.y) * 2.8 + t * 0.9)
                + sin(length(p) * 5.0 - t * 1.6 + uLevel * 2.5);
  float m = 0.5 + 0.5 * sin(plasma * 1.2);
  vec3 content = mix(uPrimary, uAccent, m);

  // --- Scanlines ---
  float scanLine = 0.5 + 0.5 * sin(distUV.y * uResolution.y * 3.14159);
  float scanStrength = 0.55 + 0.1 * uLevel;
  content *= mix(1.0, scanLine, scanStrength);

  // --- RGB phosphor triad mask ---
  float col3 = mod(gl_FragCoord.x, 3.0);
  vec3 mask = vec3(
    smoothstep(0.0, 0.5, 0.5 - abs(col3 - 0.5)),
    smoothstep(0.0, 0.5, 0.5 - abs(col3 - 1.5)),
    smoothstep(0.0, 0.5, 0.5 - abs(col3 - 2.5))
  ) * 0.35 + 0.65;
  content *= mask;

  // --- Static grain scaled by uTreble ---
  float grain = (hash2(tubeUV * uResolution + vec2(uTime * 47.3, uTime * 31.7)) - 0.5);
  content += grain * (0.06 + 0.18 * uTreble);

  // --- Bloom/glow: sample neighbours (cheap 5-tap) ---
  vec2 px = 1.5 / uResolution;
  vec3 bloom = content * 0.5;
  float bAmt = 0.08 + 0.12 * uLevel;
  bloom += mix(uPrimary, uAccent, 0.5) * bAmt * scanLine;

  // --- Vignette ---
  vec2 vd = distUV - 0.5;
  float vign = 1.0 - dot(vd, vd) * 2.2;
  vign = clamp(vign, 0.0, 1.0);
  vign = vign * vign;

  vec3 final = (content + bloom * 0.15) * vign;

  // Slight desaturation to mimic phosphor aging
  float luma = dot(final, vec3(0.299, 0.587, 0.114));
  final = mix(vec3(luma), final, 0.85);

  fragColor = vec4(clamp(final, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uLevel', 'uBass', 'uTreble', 'uBeat',
  'uPrimary', 'uAccent',
] as const;

export function createCrtVhsTube(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'crt-vhs-tube',
    name: 'CRT VHS Tube',
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
