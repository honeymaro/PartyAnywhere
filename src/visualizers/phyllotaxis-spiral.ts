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

const float PHI = 2.399963229728; // golden angle in radians (137.5077 deg)
const float N = 320.0;            // total seeds
const float C = 0.055;            // radial scale factor

// rotate a 2D point by angle a
vec2 rot(vec2 p, float a) {
  float s = sin(a); float c = cos(a);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  // rotate whole pattern with time + uMid influence
  float rotation = uTime * 0.18 + uMid * 1.2;
  uv = rot(uv, rotation);

  float r = length(uv);
  float a = atan(uv.y, uv.x);

  // invert r -> approximate seed index: r ~ C * sqrt(i) => i ~ (r/C)^2
  float iEst = (r / C) * (r / C);

  // dot size driven by uBass
  float dotSize = 0.022 + uBass * 0.03;

  float minDist = 1e9;
  float bestI = 0.0;

  // check a window of neighboring seeds around the estimate
  float start = max(0.0, floor(iEst) - 6.0);
  float end   = min(N - 1.0, ceil(iEst) + 6.0);

  int iStart = int(start);
  int iEnd = int(end);
  for (int i = iStart; i <= iEnd; i++) {
    float fi = float(i);
    float seedR = C * sqrt(fi);
    float seedA = fi * PHI;
    vec2 seedPos = vec2(seedR * cos(seedA), seedR * sin(seedA));
    float d = length(uv - seedPos);
    if (d < minDist) {
      minDist = d;
      bestI   = fi;
    }
  }

  // also check a small ring near r=0 to fill center
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    float seedR = C * sqrt(fi);
    float seedA = fi * PHI;
    vec2 seedPos = vec2(seedR * cos(seedA), seedR * sin(seedA));
    float d = length(uv - seedPos);
    if (d < minDist) {
      minDist = d;
      bestI   = fi;
    }
  }

  // dot mask
  float dot = 1.0 - smoothstep(dotSize * 0.6, dotSize, minDist);

  // color: mix primary -> accent by normalized index
  float t = bestI / (N - 1.0);
  vec3 col = mix(uPrimary, uAccent, t);

  // uBeat: brightness flash wave sweeping outward from center
  float waveFront = uBeat * 0.9;
  float wave = exp(-15.0 * abs(r - waveFront)) * uBeat;
  col += wave * 0.7;

  // uTreble: high-frequency shimmer sparkle on dots
  float sparkle = uTreble * (0.5 + 0.5 * sin(bestI * 17.3 + uTime * 8.0));
  col += dot * sparkle * 0.5;

  // slight glow halo around dots
  float glow = exp(-minDist * 30.0) * 0.18;
  col += mix(uPrimary, uAccent, t) * glow;

  // background: deep dark tint
  vec3 bg = mix(uPrimary, vec3(0.0), 0.92);
  col = mix(bg, col, dot + glow * 0.4);

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uBass', 'uMid', 'uTreble', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createPhyllotaxisSpiral(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'phyllotaxis-spiral',
    name: 'Phyllotaxis Spiral Dots',
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
