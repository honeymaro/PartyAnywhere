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

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  vec3 color = vec3(0.0);

  for (int layer = 0; layer < 5; layer++) {
    float fl = float(layer);
    float layerScale = 2.0 + fl * 1.8;
    float layerSpeed = 0.5 + fl * 0.4;
    float zScroll = uTime * layerSpeed * (0.5 + uBass * 3.0);

    vec2 tiled = uv * layerScale;
    vec2 cellId = floor(tiled);
    vec2 cellUv = fract(tiled) - 0.5;

    float h = hash(cellId + vec2(fl * 17.3, fl * 41.7));
    float h2 = hash(cellId + vec2(fl * 53.1, fl * 29.9));
    float h3 = hash(cellId + vec2(fl * 7.7, fl * 83.3));

    vec2 starPos = (vec2(h, h2) - 0.5) * 0.8;
    vec2 toStar = cellUv - starPos;

    float depth = fract(h3 + zScroll * 0.1);
    float proximity = 1.0 - depth;

    float baseBrightness = 0.0008 / (dot(toStar, toStar) + 0.0001);
    baseBrightness *= proximity * proximity;
    baseBrightness *= 0.5 + 0.5 * uLevel;

    float twinklePhase = h * 6.283 + uTime * (1.0 + h2 * 2.0);
    float twinkle = 1.0 + uTreble * 0.6 * sin(twinklePhase);
    baseBrightness *= twinkle;

    vec2 radialDir = normalize(uv + vec2(0.0001));
    float streakAmount = uBeat * 0.15 * proximity * proximity;
    vec2 streakOffset = radialDir * streakAmount;
    vec2 toStarStreaked = toStar - streakOffset;
    float streakBright = 0.0003 / (dot(toStarStreaked, toStarStreaked) + 0.0002);
    streakBright *= uBeat * proximity;

    float t = proximity;
    vec3 starColor = mix(uPrimary, uAccent, t * t);
    starColor = max(starColor, vec3(0.05));

    color += starColor * (baseBrightness + streakBright);
  }

  fragColor = vec4(color, 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uLevel', 'uBass', 'uTreble', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createStarfieldWarp(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'starfield-warp',
    name: 'Hyperspace Starfield',
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
