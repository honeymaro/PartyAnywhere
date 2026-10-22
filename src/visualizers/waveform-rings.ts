import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { AudioFrame, RenderFrame } from '../core/types';

// Concentric glowing rings drift slowly outward (accumulated uFlow). Every ring is bent
// by the live spectrum around the circle (mirrored left/right: bass at the bottom, treble
// at the top), with outer rings bent harder, so each ring reads as a radial waveform.
// Each detected onset emits a bright ring from the center that expands and fades.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uFlow;    // accumulated outward drift of the ring set (audio sets the rate)
uniform float uBass;
uniform float uBeat;
uniform vec4 uKickAge;  // seconds since the last 4 onsets (newest first)
uniform vec4 uKickAmp;  // their strengths 0..1
uniform vec3 uPrimary;
uniform vec3 uAccent;
uniform sampler2D uSpectrum;

const float K = 7.0; // rings per unit radius

// how far the spectrum bends a ring at base radius rb
float bendAmp(float rb) { return 0.012 + 0.075 * smoothstep(0.05, 0.6, rb); }

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  float aa = 1.5 / min(uResolution.x, uResolution.y);
  float r = length(uv);

  // mirrored angle: 0 at the bottom, 1 at the top, seamless on both sides
  float sx = abs(atan(uv.x, -uv.y)) / 3.14159265;
  float su = 0.01 + sx * 0.9;
  float s = 0.5 * (texture(uSpectrum, vec2(su - 0.004, 0.5)).r + texture(uSpectrum, vec2(su + 0.004, 0.5)).r);

  vec3 col = vec3(0.01, 0.01, 0.022);

  // the pixel can belong to its own ring or a neighbor bent across the spacing
  float w = 0.0035 + uBass * 0.0025;
  float ringPos = r * K - uFlow;
  float n0 = floor(ringPos);
  for (int j = -1; j <= 1; j++) {
    float n = n0 + float(j);
    float rb = (n + 0.5 + uFlow) / K;
    if (rb < 0.0) continue;
    float rr = rb + s * bendAmp(rb);
    float dist = abs(r - rr);
    float core = smoothstep(w + aa, w - aa, dist);
    float glow = exp(-dist * 110.0) * 0.35;
    vec3 c = mix(uPrimary, uAccent, 0.5 + 0.5 * cos(n * 1.9));
    float fade = smoothstep(0.02, 0.14, rb) * smoothstep(1.15, 0.55, rb);
    col += c * (core + glow) * fade * (0.5 + 0.8 * s) * (0.8 + uBeat * 0.5);
  }

  // onset rings: born at the center, bent by the spectrum like the others, fading out
  for (int i = 0; i < 4; i++) {
    float age = uKickAge[i];
    float rb = age * 0.8;
    float rr = rb + s * bendAmp(rb) * 1.2;
    float kw = 0.005 + age * 0.012;
    float dist = abs(r - rr);
    float e = uKickAmp[i] * exp(-age * 1.8);
    float k = smoothstep(kw + aa, kw - aa, dist) + exp(-dist * 40.0) * 0.5;
    col += mix(uAccent, vec3(1.0), 0.45) * k * e * 1.2;
  }

  // small core glow that breathes with the bass
  col += mix(uPrimary, uAccent, 0.3) * exp(-r * r * 140.0) * (0.25 + uBass * 0.6 + uBeat * 0.4);

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uFlow', 'uBass', 'uBeat', 'uKickAge', 'uKickAmp', 'uPrimary', 'uAccent', 'uSpectrum',
] as const;

export function createWaveformRings(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let flow = 0; // ring drift (audio sets the rate; only ever increases)
  // Onset events detected on the CPU (rising edge), newest first.
  const kickAge = new Float32Array(4).fill(99);
  const kickAmp = new Float32Array(4);
  let prevBeat = 0;
  let prevBass = 0;

  function trackKicks(a: AudioFrame, dt: number): void {
    for (let i = 0; i < 4; i++) kickAge[i] += dt;
    const onset = (a.beat - prevBeat > 0.25 && a.beat > 0.6) || (a.bass - prevBass > 0.18 && a.bass > 0.7);
    const amp = Math.min(1, 0.3 + 0.7 * a.bass);
    if (onset && kickAge[0] > 0.1) {
      kickAge.copyWithin(1, 0);
      kickAmp.copyWithin(1, 0);
      kickAge[0] = 0;
      kickAmp[0] = amp;
    } else if (onset) {
      kickAmp[0] = Math.max(kickAmp[0], amp); // bass landed a frame after the onset
    }
    prevBeat = a.beat;
    prevBass = a.bass;
  }

  return {
    id: 'waveform-rings',
    name: 'Concentric Waveform Rings',
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
      const a = frame.audio;
      trackKicks(a, frame.dt);
      flow += (0.12 + a.level * 0.2 + a.beat * 0.5) * frame.dt;
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uFlow, flow);
      gl.uniform1f(u.uBass, a.bass);
      gl.uniform1f(u.uBeat, a.beat);
      gl.uniform4fv(u.uKickAge, kickAge);
      gl.uniform4fv(u.uKickAmp, kickAmp);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
    },
  };
}
