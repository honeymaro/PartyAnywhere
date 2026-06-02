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

float gridLine(float v, float thickness) {
  float f = abs(fract(v) - 0.5);
  return smoothstep(thickness, thickness * 0.3, f);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float horizonY = 0.42;

  // --- SKY ---
  vec3 sky = vec3(0.0);
  if (uv.y >= horizonY) {
    float skyT = (uv.y - horizonY) / (1.0 - horizonY);
    // deep violet to primary gradient
    vec3 deepViolet = vec3(0.06, 0.02, 0.14);
    sky = mix(uPrimary * 0.55, deepViolet, skyT * skyT);

    // sun disc
    vec2 sunCenter = vec2(0.5, horizonY + 0.18);
    float sunRadius = 0.13;
    float d = distance(uv, sunCenter);
    float sunDisc = smoothstep(sunRadius, sunRadius - 0.008, d);

    // horizontal slits cut through the sun
    float slitY = (uv.y - sunCenter.y + sunRadius) / (sunRadius * 2.0);
    float slitCount = 8.0;
    float slit = step(0.55, fract(slitY * slitCount));

    float beatGlow = 1.0 + uBeat * 0.7;
    float glow = smoothstep(sunRadius * 2.5 * beatGlow, 0.0, d) * 0.55 * beatGlow;

    vec3 sunCol = mix(uAccent, uPrimary * 1.3, smoothstep(0.0, sunRadius, d));
    sky += sunDisc * slit * sunCol;
    sky += glow * uAccent * 0.8;
  }

  // --- FLOOR ---
  vec3 floor = vec3(0.0);
  if (uv.y < horizonY) {
    // perspective projection: map screen uv to grid uv
    float fy = horizonY - uv.y; // distance below horizon (0 at horizon, horizonY at bottom)
    float perspective = horizonY / (fy + 0.001);
    float gx = (uv.x - 0.5) * perspective;
    float gz = perspective + uTime * 0.35 + uBass * 1.8;

    float lineScale = 1.0;
    float gridX = gridLine(gx * lineScale, 0.04);
    float gridZ = gridLine(gz * lineScale, 0.04);
    float grid = max(gridX, gridZ);

    // brightness falls off toward horizon
    float depthFade = clamp(fy / horizonY, 0.0, 1.0);
    depthFade = depthFade * depthFade;

    float brightness = grid * depthFade * (0.6 + uTreble * 0.8);
    vec3 lineColor = uPrimary * 1.4;

    // base floor color: deep violet tint
    vec3 floorBase = vec3(0.04, 0.01, 0.09);
    floor = mix(floorBase, lineColor, brightness);

    // haze toward horizon
    float haze = 1.0 - depthFade;
    vec3 hazeColor = mix(uPrimary, uAccent, 0.4) * 0.25 * (0.5 + uLevel * 0.8);
    floor = mix(floor, hazeColor, haze * haze * 0.75);
  }

  vec3 col = (uv.y >= horizonY) ? sky : floor;

  // thin horizon glow line
  float horizonDist = abs(uv.y - horizonY);
  float horizonGlow = smoothstep(0.018, 0.0, horizonDist);
  col += horizonGlow * mix(uAccent, uPrimary, 0.5) * (0.9 + uBeat * 0.5);

  // CRT scanline overlay
  float scanline = 0.88 + 0.12 * sin(gl_FragCoord.y * 3.14159);
  col *= scanline;

  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uLevel', 'uBass', 'uTreble', 'uBeat', 'uPrimary', 'uAccent',
] as const;

export function createRetroGridHorizon(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'retro-grid-horizon',
    name: 'Retro Synthwave Grid',
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
