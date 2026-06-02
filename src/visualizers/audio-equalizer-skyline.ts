import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;
uniform sampler2D uSpectrum;

// Soft glow around a value: returns brightness centered at edge
float glow(float dist, float radius) {
  return exp(-dist * dist / (radius * radius + 0.0001));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;

  // Horizon sits at y=0.5; top half = bars, bottom half = reflection
  float horizon = 0.5;
  bool isAbove = uv.y >= horizon;

  // Map x to spectrum bin
  float barHeight = texture(uSpectrum, vec2(uv.x, 0.5)).r;
  // Animate minimum bar height with time so it moves even at zero audio
  float idleWave = 0.04 + 0.03 * sin(uTime * 1.2 + uv.x * 12.0);
  barHeight = max(barHeight, idleWave);

  // Beat flash: boost all bars momentarily
  barHeight = min(barHeight + uBeat * 0.18, 1.0);

  // --- TOP HALF: skyline bars ---
  vec3 col = vec3(0.0);

  if (isAbove) {
    // uv in top half: remap so horizon=0, sky top=1
    float localY = (uv.y - horizon) / (1.0 - horizon);

    // Bar fill: everything below barHeight (in local space) is lit
    float barFill = step(localY, barHeight);

    // Color gradient: uPrimary at base, uAccent at peak
    float tGrad = clamp(localY / max(barHeight, 0.001), 0.0, 1.0);
    vec3 barCol = mix(uPrimary, uAccent, tGrad);

    // Neon glow at bar tips — brighter with more treble
    float tipDist = abs(localY - barHeight);
    float tipGlow = glow(tipDist, 0.025 + uTreble * 0.04);
    vec3 glowCol = uAccent + vec3(0.4) * uTreble;

    // Beat flash: white highlight across all bars
    vec3 flashCol = mix(barCol, vec3(1.0), uBeat * 0.5);

    col = flashCol * barFill + glowCol * tipGlow * (0.6 + uTreble * 0.8);

    // Dark background where no bar
    col = mix(vec3(0.02, 0.02, 0.06), col, min(barFill + tipGlow, 1.0));

  } else {
    // --- BOTTOM HALF: reflection ---
    // Mirror uv.y across horizon
    float reflY = (horizon - uv.y) / horizon; // 0 at horizon, 1 at bottom

    // Sample same bar height for this x
    float refBarHeight = barHeight;

    // Reflection fill
    float refFill = step(reflY, refBarHeight);

    // Ripple distortion on the reflection (time-animated)
    float ripple = sin(uv.x * 30.0 + uTime * 3.0) * 0.008
                 + sin(uv.x * 17.0 - uTime * 2.0) * 0.005;
    float rippleY = reflY + ripple * uBass;
    float refFillRipple = step(rippleY, refBarHeight);

    // Fade reflection with distance from horizon and bass intensity
    float fade = (1.0 - reflY) * (0.35 + uBass * 0.45);

    vec3 refColor = mix(uPrimary, uAccent, clamp(reflY / max(refBarHeight, 0.001), 0.0, 1.0));
    refColor *= fade;

    // Subtle floor gradient
    vec3 floor = vec3(0.03, 0.03, 0.08) + vec3(0.0, 0.0, 0.04) * (1.0 - reflY);

    col = mix(floor, refColor, float(refFillRipple) * fade);

    // Horizon line glow
    float horizDist = uv.y - horizon;
    float horizGlow = glow(horizDist, 0.012) * (0.5 + uBass * 0.5);
    col += uAccent * horizGlow * 0.6;
  }

  // Vignette
  vec2 centered = uv - 0.5;
  float vignette = 1.0 - dot(centered, centered) * 1.2;
  col *= clamp(vignette, 0.0, 1.0);

  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uBass', 'uTreble', 'uBeat',
  'uPrimary', 'uAccent', 'uSpectrum',
] as const;

export function createAudioEqualizerSkyline(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'audio-equalizer-skyline',
    name: 'Equalizer Skyline',
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
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, ctx.spectrumTex);
      gl.uniform1i(u.uSpectrum, 0);
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uTime, frame.time);
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
