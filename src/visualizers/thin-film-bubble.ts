import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// A soap bubble floating in the dark: an analytic sphere whose thin film shows
// interference colors (RGB wavelengths through the film's optical path). The film
// drains (thin at the top, thick at the bottom) and swirls with a domain-warped noise
// flow; window highlights and a Fresnel rim sell the glassiness. Swirl and flow are
// CPU-accumulated (audio = rate, one-way). Each kick wobbles the outline, flashes the
// film and sends a ring of thickness change rippling out across the surface.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uSpin;     // accumulated film swirl angle (audio = rate, one-way)
uniform float uFlow;     // accumulated film flow (audio = rate, one-way)
uniform float uKickAge;  // seconds since the last kick (large when none yet)
uniform float uLevel;
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 17.5);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1, 0)), f.x),
    mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x),
    f.y
  );
}

// Thin-film interference for a given wavelength (nm) and optical path difference (nm)
float thinFilm(float opd, float lambda) {
  return 0.5 + 0.5 * cos(6.28318530718 * opd / lambda);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y; // aspect-correct
  float px = 1.0 / uResolution.y;
  float d = length(uv);
  float ang = atan(uv.y, uv.x);

  // radius fits the screen height; kicks wobble the outline (integer lobes: seamless)
  float R = 0.34 * (1.0 + uBass * 0.02 + uBeat * 0.035 * sin(3.0 * ang + uTime * 2.0));

  // --- dark backdrop with a soft palette wash and a halo around the bubble ---
  vec3 bg = mix(uPrimary * 0.07, uAccent * 0.05, uv.y + 0.5);
  bg *= 1.0 - 0.5 * dot(uv, uv);
  vec3 col = bg + mix(uPrimary, uAccent, 0.5) * exp(-max(d - R, 0.0) * 10.0) * (0.08 + uBeat * 0.12);

  float inside = smoothstep(R + px, R - px, d);
  if (inside > 0.0) {
    vec2 rn = uv / R;                                   // unit disk
    float s2 = min(dot(rn, rn), 1.0);
    float cosT = sqrt(1.0 - s2);
    vec3 N = vec3(rn, cosT);

    // film flow: rotate into the swirling surface frame, then one domain-warp step
    float ca = cos(uSpin), sa = sin(uSpin);
    vec2 q = vec2(ca * rn.x - sa * rn.y, sa * rn.x + ca * rn.y) * 1.6;
    vec2 warp = vec2(noise(q * 1.3 + vec2(0.0, uFlow)), noise(q * 1.3 + vec2(5.2, -uFlow)));
    float swirl = noise(q * 2.0 + warp * 2.4 + uFlow * 0.3) * 0.75 + noise(q * 4.3 - warp) * 0.25;

    // kick ring: a band of extra thickness rippling outward over the surface
    float kr = length(rn) - uKickAge * 1.5;
    float kick = exp(-kr * kr * 40.0) * exp(-uKickAge * 2.2);

    // thickness (nm): drains thin at the top, so the colors form horizontal bands;
    // the swirl bends those bands, the kick ring pushes them, bass adds a small bias
    float yy = N.y + (swirl - 0.5) * 0.7 - kick * 0.25;
    float thickness = mix(140.0, 640.0, 0.5 - 0.5 * yy) + (swirl - 0.5) * 60.0 + uBass * 30.0;
    // optical path inside the film (n = 1.33), refraction-corrected for the view angle
    float cosR = sqrt(1.0 - s2 / 1.77);
    float opd = 2.0 * 1.33 * thickness * cosR;
    vec3 spec = vec3(thinFilm(opd, 650.0), thinFilm(opd, 540.0), thinFilm(opd, 450.0));

    // palette tint so the bubble follows the theme
    vec3 tint = mix(uPrimary, uAccent, spec.g);
    vec3 film = mix(spec, tint * 1.2, 0.35);

    // reflectance: Schlick Fresnel, but soap films stay visible across the whole face
    float fres = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
    float refl = (0.42 + 0.58 * fres) * (0.85 + uLevel * 0.2 + uBeat * 0.55 + kick * 0.5);
    vec3 bubble = bg * 0.9 + film * refl;

    // window highlights (soft rounded rectangle upper-left, small glint lower-right)
    vec2 hp = rn - vec2(-0.42, 0.46);
    float win = smoothstep(0.1, 0.0, length(max(abs(hp) - vec2(0.11, 0.05), 0.0)));
    win *= 0.55 + 0.45 * smoothstep(-0.12, 0.08, hp.y);   // brighter toward its top edge
    float glint = smoothstep(0.12, 0.0, length(rn - vec2(0.5, -0.52)));
    bubble += vec3(1.0) * (win * 0.75 + glint * 0.3) * (0.85 + uBeat * 0.3 + uTreble * 0.1);
    // crisp bright rim
    bubble += mix(film, vec3(1.0), 0.5) * smoothstep(0.86, 1.0, sqrt(s2)) * 0.35;

    col = mix(col, bubble, inside);
  }

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uSpin', 'uFlow', 'uKickAge', 'uLevel', 'uBass', 'uTreble', 'uBeat',
  'uPrimary', 'uAccent',
] as const;

export function createThinFilmBubble(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let spin = 0; // film swirl angle (audio modulates the rate; only ever increases)
  let flow = 0; // film flow phase (audio modulates the rate; only ever increases)
  let prevBeat = 0;
  let kickAge = 99; // seconds since the last kick (rising edge of the beat pulse)

  return {
    id: 'thin-film-bubble',
    name: 'Thin-Film Soap Bubble',
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
      const a = frame.audio;
      spin += (0.08 + a.level * 0.12 + a.beat * 0.25) * frame.dt;
      flow += (0.12 + a.mid * 0.15 + a.beat * 0.4) * frame.dt;
      kickAge += frame.dt;
      if (a.beat > 0.85 && prevBeat <= 0.85 && kickAge > 0.1) kickAge = 0;
      prevBeat = a.beat;
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uTime, frame.time);
      gl.uniform1f(u.uSpin, spin);
      gl.uniform1f(u.uFlow, flow);
      gl.uniform1f(u.uKickAge, kickAge);
      gl.uniform1f(u.uLevel, a.level);
      gl.uniform1f(u.uBass, a.bass);
      gl.uniform1f(u.uTreble, a.treble);
      gl.uniform1f(u.uBeat, a.beat);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
    },
  };
}
