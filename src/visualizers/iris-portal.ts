import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uSpin; // CPU-accumulated rotation (the mids drive its RATE, never the angle)
uniform float uKickAge; // seconds since the last kick (CPU rising-edge detector)
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p *= 2.1;
    amp *= 0.5;
  }
  return v;
}

// Thin-film iridescence built from the live palette: three cosine-weighted bands cycling
// through primary, accent and a pale primary highlight (a fixed rainbow palette injected
// red/green regardless of the palette).
vec3 iridescence(float x) {
  vec3 w = 0.5 + 0.5 * cos(6.2832 * (x + vec3(0.0, 0.3333, 0.6667)));
  vec3 pale = mix(uPrimary, vec3(1.0), 0.55);
  return (uPrimary * w.x + uAccent * w.y + pale * w.z) / 1.5;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  float r = length(uv);
  float angle = atan(uv.y, uv.x);

  float t = uTime * 0.3;
  float rotAngle = angle + uSpin;
  // Seamless angular basis (periodic across the 0/360 wrap) for noise / color.
  // sin(rotAngle * 60.0) is already seamless (integer multiple), but fbm/palette are not,
  // so feed them this circular coordinate instead of the raw (discontinuous) angle.
  vec2 ang = vec2(cos(rotAngle), sin(rotAngle));

  // Iris fiber striations via fbm + sin (fbm sampled on the circle, wraps seamlessly)
  vec2 fiberCoord = ang * (3.0 + r * 4.0);
  float fiber = sin(rotAngle * 60.0 + fbm(fiberCoord + t) * 4.0);
  float fiberFalloff = smoothstep(1.2, 0.05, r);
  float striation = fiber * fiberFalloff;

  // Aperture: slow breathing, dilates on the bass (a size pulse that returns to rest)
  float apertureBase = 0.26 + 0.05 * sin(t * 1.1);
  float shutter = apertureBase + uBass * 0.09 + uBeat * 0.04;

  // Pupil: dark center with glowing core
  float pupil = smoothstep(shutter, shutter * 0.6, r);
  float coreGlow = exp(-r * r * 28.0) * (0.35 + uBass * 0.4 + uBeat * 0.9);

  // Thin-film iridescence over radial + angular index
  float iridIndex = r * 2.2 + ang.x * 0.35 + striation * 0.12 + t * 0.3;
  vec3 irisColor = iridescence(iridIndex);

  // Concentric ring modulation + fiber relief
  float rings = 0.5 + 0.5 * cos(r * 28.0 - t * 2.0 + striation * 0.5);
  float fiberMask = 0.5 + 0.5 * fiber;
  irisColor *= (0.55 + 0.35 * rings) * (0.2 + 1.0 * fiberMask * fiberMask);

  // Treble shimmer: glints riding the fiber crests (continuous, no blocky cells)
  float glint = pow(0.5 + 0.5 * fiber, 14.0) * fiberFalloff;
  irisColor += mix(uAccent, vec3(1.0), 0.5) * glint * (0.08 + uTreble * 0.45);

  // Fade iris out beyond outer edge; the whole iris flares on the kick
  float irisEdge = smoothstep(1.1, 0.55, r);
  vec3 col = irisColor * irisEdge * (0.85 + uBeat * 0.5);

  // Subtract pupil (dark hole) and add glowing core
  col *= (1.0 - pupil * 0.95);
  col += uPrimary * coreGlow;
  col += mix(uAccent, vec3(1.0), 0.3) * exp(-r * r * 80.0) * (0.3 + uBeat * 0.5);

  // kick shockwave: a bright ring leaves the pupil edge and fades as it expands
  float waveR = shutter + uKickAge * 1.1;
  float wave = exp(-pow((r - waveR) / 0.025, 2.0)) * exp(-uKickAge * 4.0);
  col += mix(uAccent, vec3(1.0), 0.35) * wave * 0.9;

  col = max(col, vec3(0.0));
  col = 1.0 - exp(-col * 1.4);
  fragColor = vec4(col, 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uSpin', 'uKickAge', 'uBass', 'uTreble', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createIrisPortal(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let spin = 0; // accumulated rotation (audio modulates the RATE, never the direction)
  let kickAge = 10; // seconds since the last kick rising edge
  let prevBeat = 0;

  return {
    id: 'iris-portal',
    name: 'Iridescent Iris Portal',
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
      spin = (spin + (0.1 + frame.audio.mid * 0.2 + frame.audio.beat * 0.6) * frame.dt) % (Math.PI * 2);
      gl.uniform1f(u.uSpin, spin);
      kickAge += frame.dt;
      // kicks snap beat to ~1.0; other onsets stay below ~0.9, so they do not fire the wave
      if (frame.audio.beat > 0.93 && prevBeat <= 0.93 && kickAge > 0.15) kickAge = 0;
      prevBeat = frame.audio.beat;
      gl.uniform1f(u.uKickAge, kickAge);
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
