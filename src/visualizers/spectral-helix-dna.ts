import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { AudioFrame, RenderFrame } from '../core/types';

// A glowing double helix that twists and scrolls upward (both phases accumulated on the
// CPU; audio only sets the rates). Each rung lights up with the spectrum band at its
// screen height (bottom = bass, top = treble). The bass swells the helix radius, and
// every detected onset sends a bright flash climbing the helix while the nodes flare.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uSpin;    // accumulated twist phase (audio modulates the rate)
uniform float uScroll;  // accumulated upward scroll
uniform float uBass;
uniform float uBeat;
uniform vec4 uKickAge;  // seconds since the last 4 onsets (newest first)
uniform vec4 uKickAmp;  // their strengths 0..1
uniform vec3 uPrimary;
uniform vec3 uAccent;
uniform sampler2D uSpectrum;

const float FREQ = 7.0;
const float SPACING = 0.11; // rung spacing

// core uses the slope-corrected distance, the halo the plain horizontal one (the
// correction is only valid close to the curve; far out it would smear sideways)
float glowTube(float dist, float rawDist, float radius) {
  float core = smoothstep(radius, 0.0, dist);
  float halo = exp(-rawDist * 18.0) * 0.5;
  return core + halo;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  float scrollY = uv.y + uScroll;
  float radius = 0.27 + uBass * 0.12;

  // onset flashes climbing the helix from the bottom
  float climb = 0.0;
  for (int i = 0; i < 4; i++) {
    float age = uKickAge[i];
    float fy = (uv.y - (age * 1.6 - 0.6)) * 7.0;
    climb += uKickAmp[i] * exp(-fy * fy) * exp(-age * 1.4);
  }
  float boost = 1.0 + uBeat * 0.6 + climb * 1.6;

  // strand centerlines and their depth (front strand brighter)
  float th = scrollY * FREQ + uSpin;
  float sn = sin(th);
  float cs = cos(th);
  float strand1x = sn * radius;
  float strand2x = -sn * radius;
  float depth1 = 0.5 + 0.5 * cs;
  float depth2 = 0.5 - 0.5 * cs;
  // divide by the slope so the tubes keep their width where they cross
  float slopeK = inversesqrt(1.0 + pow(radius * FREQ * cs, 2.0));
  float raw1 = abs(uv.x - strand1x);
  float raw2 = abs(uv.x - strand2x);
  float dist1 = raw1 * slopeK;
  float dist2 = raw2 * slopeK;

  float tubeR = 0.02 * (1.0 + uBeat * 0.5);
  float g1 = glowTube(dist1, raw1, tubeR) * (0.5 + 0.5 * depth1);
  float g2 = glowTube(dist2, raw2, tubeR) * (0.5 + 0.5 * depth2);

  vec3 col = mix(uPrimary, uAccent, 0.5) * exp(-abs(uv.x) * 4.0) * (0.03 + uBass * 0.06);
  col += uPrimary * g1 * boost;
  col += uAccent * g2 * boost;
  col += vec3(1.0) * (smoothstep(tubeR * 0.5, 0.0, min(dist1, dist2))) * climb * 0.6;

  // rungs: one per SPACING in scrolled space; brightness from the band at its height
  float m = floor(scrollY / SPACING + 0.5);
  float rungY = m * SPACING - uScroll; // rung center in screen space
  float toRung = abs(uv.y - rungY);
  float s = texture(uSpectrum, vec2(clamp(rungY + 0.5, 0.0, 1.0) * 0.9 + 0.02, 0.5)).r;
  float xMin = min(strand1x, strand2x);
  float xMax = max(strand1x, strand2x);
  if (toRung < 0.02) {
    float inRung = smoothstep(xMin - 0.004, xMin + 0.006, uv.x) * smoothstep(xMax + 0.004, xMax - 0.006, uv.x);
    float t = clamp((uv.x - xMin) / (xMax - xMin + 0.0001), 0.0, 1.0);
    vec3 rungCol = mix(uPrimary, uAccent, t);
    float thick = 0.003 + s * 0.004;
    float rungGlow = inRung * (smoothstep(thick + 0.002, thick, toRung) * 0.9 + exp(-toRung * 120.0) * 0.4);
    col += rungCol * rungGlow * (0.15 + s * 1.0) * boost;
  }

  // nodes where rungs meet the strands: size and flare ride the band and the beat
  float nodeSize = 0.01 + s * 0.006 + uBeat * 0.009;
  float th0 = (m * SPACING) * FREQ + uSpin;
  float nx = sin(th0) * radius;
  float nd1 = length(uv - vec2(nx, rungY));
  float nd2 = length(uv - vec2(-nx, rungY));
  float flare = 0.3 + s * 0.5 + uBeat * 0.7 + climb;
  col += uPrimary * exp(-nd1 / nodeSize) * flare;
  col += uAccent * exp(-nd2 / nodeSize) * flare;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uSpin', 'uScroll', 'uBass', 'uBeat', 'uKickAge', 'uKickAmp',
  'uPrimary', 'uAccent', 'uSpectrum',
] as const;

export function createSpectralHelixDna(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let spin = 0; // helix twist phase (audio sets the rate; only ever increases)
  let scroll = 0; // upward scroll (audio sets the rate; only ever increases)
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
    id: 'spectral-helix-dna',
    name: 'Spectral Helix DNA',
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
      spin += (0.22 + a.mid * 0.45 + a.beat * 1.4) * frame.dt;
      scroll += (0.06 + a.level * 0.04 + a.beat * 0.12) * frame.dt;
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uSpin, spin);
      gl.uniform1f(u.uScroll, scroll);
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
