import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { AudioFrame, RenderFrame } from '../core/types';

// 64 discrete rounded bars radiating from a glowing inner ring. The spectrum is mirrored
// left/right around the vertical axis (bass at the bottom, treble at the top), so the
// wrap is seamless. The inner ring swells and brightens with the bass, every onset
// launches a ring outward from it, and the whole crown turns slowly (accumulated uRot).
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uRot;     // accumulated rotation (audio modulates the rate)
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec4 uKickAge;  // seconds since the last 4 onsets (newest first)
uniform vec4 uKickAmp;  // their strengths 0..1
uniform vec3 uPrimary;
uniform vec3 uAccent;
uniform sampler2D uSpectrum;

const float TWO_PI = 6.28318530718;
const float NB = 64.0;
const float GAP = 0.016;   // space between the inner ring and the bar bases
const float MAX_L = 0.25;  // longest bar

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  float aa = 1.5 / min(uResolution.x, uResolution.y);
  float r = length(uv);
  // angle measured from the bottom, so the mirror axis is vertical
  float a = atan(uv.x, -uv.y) - uRot;

  float R0 = 0.16 * (1.0 + uBass * 0.06); // inner ring radius: small bass swell

  // nearest bar (bars are centered on integer k)
  float fa = a / TWO_PI * NB;
  float k = floor(fa + 0.5);
  float da = (fa - k) * TWO_PI / NB;
  // mirrored spectrum position: k and -k share a band, 0 = bass, 32 = treble
  float km = mod(k + NB * 0.5, NB) - NB * 0.5;
  float sx = abs(km) / (NB * 0.5);
  float s = texture(uSpectrum, vec2(0.01 + sx * 0.9, 0.5)).r;
  float len = 0.02 + s * MAX_L;

  // bar-local frame: lx across the bar, ly along the radius
  float lx = r * sin(da);
  float ly = r * cos(da);
  float hw = 0.0055;
  float y0 = R0 + GAP + hw;
  float y1 = R0 + GAP + max(len - hw, hw);
  float d = length(vec2(lx, ly - clamp(ly, y0, y1))) - hw;

  float fill = smoothstep(aa, -aa, d);
  float t = clamp((ly - R0 - GAP) / MAX_L, 0.0, 1.0);
  vec3 barCol = mix(uPrimary, uAccent, smoothstep(0.0, 0.8, t));
  barCol *= 0.75 + 0.35 * (1.0 - abs(lx) / hw);
  float tip = smoothstep(hw * 4.0, 0.0, abs(ly - y1));
  barCol += mix(uAccent, vec3(1.0), 0.5) * tip * (0.2 + uTreble * 0.2 + uBeat * 0.5);
  barCol *= 0.8 + uBeat * 0.4;

  vec3 col = vec3(0.012, 0.012, 0.025);
  // faint halo behind the crown
  col += mix(uPrimary, uAccent, 0.5) * exp(-abs(r - R0 - 0.1) * 9.0) * (0.04 + uBass * 0.06);
  col = mix(col, barCol, fill);
  col += mix(uPrimary, uAccent, t) * exp(-max(d, 0.0) * 55.0) * (1.0 - fill) * (0.14 + uBeat * 0.2);

  // inner ring: thickness and brightness ride the bass
  float ringW = 0.003 + uBass * 0.004;
  float ring = smoothstep(ringW + aa, ringW - aa, abs(r - R0));
  vec3 ringCol = mix(uPrimary, vec3(1.0), 0.3 + uBeat * 0.4);
  col += ringCol * ring * (0.5 + uBass * 0.5);
  col += uPrimary * exp(-abs(r - R0) * 45.0) * (0.12 + uBass * 0.35 + uBeat * 0.3);

  // core: dark center with a soft bass glow
  float inside = smoothstep(R0, R0 - 0.02, r);
  col += mix(uAccent, uPrimary, 0.5) * inside * exp(-r * r * 60.0) * (0.15 + uBass * 0.5);

  // onset rings launched outward from the inner ring
  for (int i = 0; i < 4; i++) {
    float age = uKickAge[i];
    float rr = R0 + age * 0.75;
    float w = 0.004 + age * 0.02;
    float x = (r - rr) / w;
    col += mix(uAccent, vec3(1.0), 0.35) * exp(-x * x) * uKickAmp[i] * exp(-age * 3.0) * 0.9;
  }

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uRot', 'uBass', 'uTreble', 'uBeat', 'uKickAge', 'uKickAmp',
  'uPrimary', 'uAccent', 'uSpectrum',
] as const;

export function createSpectrumRadialBars(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let rot = 0; // crown rotation (audio sets the rate; only ever increases)
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
    id: 'spectrum-radial-bars',
    name: 'Radial Spectrum Bars',
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
      rot += (0.03 + a.level * 0.05 + a.beat * 0.18) * frame.dt;
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uRot, rot);
      gl.uniform1f(u.uBass, a.bass);
      gl.uniform1f(u.uTreble, a.treble);
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
