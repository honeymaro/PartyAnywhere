import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { AudioFrame, RenderFrame } from '../core/types';

// Seven stacked glowing ribbons that flow sideways (accumulated uPhase; audio sets the
// rate). Each ribbon owns a slice of the log spectrum (bottom = bass, top = treble):
// its band sets the wave amplitude, thickness and glow, and the ribbon width twists
// along its length. Each detected onset sends a bright pulse sweeping across all
// ribbons from left to right.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uPhase;   // accumulated flow phase (audio modulates the rate)
uniform float uBass;
uniform float uBeat;
uniform vec4 uKickAge;  // seconds since the last 4 onsets (newest first)
uniform vec4 uKickAmp;  // their strengths 0..1
uniform vec3 uPrimary;
uniform vec3 uAccent;
uniform sampler2D uSpectrum;

const int NR = 7;

void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 p = gl_FragCoord.xy / uResolution.y; // y 0..1, x 0..aspect
  float aa = 1.5 / uResolution.y;
  float xn = p.x / aspect;

  // onset sweeps: a bright band moving across the screen after each onset
  float sweep = 0.0;
  for (int k = 0; k < 4; k++) {
    float age = uKickAge[k];
    float sx = (xn - (age * 1.5 - 0.15)) * 5.0;
    sweep += uKickAmp[k] * exp(-sx * sx) * exp(-age * 1.6);
  }

  vec3 col = vec3(0.0);
  for (int i = 0; i < NR; i++) {
    float fi = float(i);
    float baseY = 0.14 + fi * (0.72 / float(NR - 1));

    // this ribbon's slice of the spectrum (two taps for a steadier value)
    float su = (fi + 0.5) / float(NR) * 0.88 + 0.02;
    float s = 0.5 * (texture(uSpectrum, vec2(su - 0.03, 0.5)).r + texture(uSpectrum, vec2(su + 0.03, 0.5)).r);

    float freq = 3.2 + fi * 0.9;
    float ph = uPhase * (0.8 + fi * 0.13) + fi * 1.7;
    float amp = 0.02 + s * 0.075;

    // centerline: two sines per ribbon; the analytic slope keeps the width even on steep parts
    float a1 = p.x * freq + ph;
    float a2 = p.x * freq * 2.1 - ph * 1.3 + fi;
    float cy = baseY + amp * (0.75 * sin(a1) + 0.25 * sin(a2));
    float slope = amp * freq * (0.75 * cos(a1) + 0.525 * cos(a2));
    float d = abs(p.y - cy) / sqrt(1.0 + slope * slope);

    // twisting ribbon: width breathes along x, swells with its band and the sweep
    float twist = 0.35 + 0.65 * abs(cos(p.x * freq * 0.45 + ph * 0.6 + fi * 2.0));
    float hw = (0.0032 + s * 0.007 + uBass * 0.003 + sweep * 0.005) * twist;

    float core = smoothstep(hw + aa, hw - aa, d);
    float glow = exp(-d * 85.0) * (0.12 + s * 0.2);

    // smooth palette blend along the ribbon (no fract seams)
    float ct = 0.5 + 0.5 * sin(fi * 1.25 + p.x * 1.6 + uPhase * 0.12);
    vec3 c = mix(uPrimary, uAccent, ct);
    float lum = (0.45 + s * 0.6) * (0.8 + uBeat * 0.6) + sweep * 1.3;
    col += c * (core * 0.85 + glow) * lum;
    col += vec3(1.0) * core * sweep * 0.35;
  }

  // backdrop and gentle tonemap keep the overlap from washing out
  col += vec3(0.012, 0.012, 0.025) + mix(uPrimary, uAccent, 0.5) * 0.02;
  col = 1.0 - exp(-col * 1.15);
  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uPhase', 'uBass', 'uBeat', 'uKickAge', 'uKickAmp',
  'uPrimary', 'uAccent', 'uSpectrum',
] as const;

export function createSineRibbonFlow(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let phase = 0; // ribbon flow phase (audio sets the rate; only ever increases)
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
    id: 'sine-ribbon-flow',
    name: 'Flowing Sine Ribbons',
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
      phase += (0.35 + a.mid * 0.35 + a.level * 0.2 + a.beat * 0.8) * frame.dt;
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uPhase, phase);
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
