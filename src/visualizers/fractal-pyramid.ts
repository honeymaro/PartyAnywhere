import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Audio-reactive adaptation of "Fractal Pyramid" by bradjamesgrant
// (https://www.shadertoy.com/view/tsXBzS) — a kaleidoscopic IFS fold raymarched with
// glow accumulation. Reworked for GLSL ES 3.00 (int raymarch loop), colored from the
// live palette, and driven by accumulated phase uniforms so the music changes the
// morph/orbit RATE one-directionally (no piston/wobble) while beats brighten the glow.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uMorph;   // accumulated fold-rotation phase (audio modulates the rate)
uniform float uOrbit;   // accumulated camera-orbit phase
uniform float uBass;
uniform float uBeat;
uniform float uLevel;
uniform vec3 uPrimary;
uniform vec3 uAccent;

vec3 palette(float d){
  return mix(uPrimary, uAccent, clamp(d, 0.0, 1.0));
}

vec2 rot(vec2 p, float c, float s){
  return p * mat2(c, s, -s, c);
}

// Distance estimate of the folded pyramid. All 8 folds share one rotation angle per
// frame, so cos/sin are computed once and reused (identical result, far fewer trig ops).
float map(vec3 p){
  float ca = cos(uMorph), sa = sin(uMorph);
  float cb = cos(uMorph * 1.89), sb = sin(uMorph * 1.89);
  for(int i = 0; i < 8; i++){
    p.xz = rot(p.xz, ca, sa);
    p.xy = rot(p.xy, cb, sb);
    p.xz = abs(p.xz);
    p.xz -= 0.5;
  }
  return dot(sign(p), p) / 5.0;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.x;

  // Camera orbits the fractal and looks at its center.
  vec3 ro = vec3(0.0, 0.0, -50.0);
  ro.xz = rot(ro.xz, cos(uOrbit), sin(uOrbit));
  vec3 cf = normalize(-ro);
  vec3 cs = normalize(cross(cf, vec3(0.0, 1.0, 0.0)));
  vec3 cu = normalize(cross(cf, cs));
  vec3 target = ro + cf * 3.0 + uv.x * cs + uv.y * cu;
  vec3 rd = normalize(target - ro);

  // Glow raymarch: accumulate palette color inversely proportional to the distance,
  // so thin folds bloom. Bass/beat shrink the divisor -> brighter glow on the kick.
  float glowDiv = 400.0 / (1.0 + uBass * 1.6 + uBeat * 2.5);
  float t = 0.0;
  vec3 col = vec3(0.0);
  for(int i = 0; i < 64; i++){
    vec3 p = ro + rd * t;
    float d = map(p) * 0.5;
    if(d < 0.02) break;
    if(d > 100.0) break;
    col += palette(length(p) * 0.1) / (glowDiv * d);
    t += d;
  }

  // Overall exposure lifts slightly with energy + beat (brightness only, no motion).
  col *= 0.9 + uLevel * 0.3 + uBeat * 0.4;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = ['uResolution', 'uMorph', 'uOrbit', 'uBass', 'uBeat', 'uLevel', 'uPrimary', 'uAccent'] as const;

export function createFractalPyramid(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let morph = 0; // fold-rotation phase (rate rides the mids; only ever increases)
  let orbit = 0; // camera-orbit phase (rate rides overall level; only ever increases)
  return {
    id: 'fractal-pyramid',
    name: 'Fractal Pyramid',
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
      morph += (0.2 + frame.audio.mid * 0.6 + frame.audio.beat * 0.8) * frame.dt;
      orbit += (0.18 + frame.audio.level * 0.35) * frame.dt;
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uMorph, morph);
      gl.uniform1f(u.uOrbit, orbit);
      gl.uniform1f(u.uBass, frame.audio.bass);
      gl.uniform1f(u.uBeat, frame.audio.beat);
      gl.uniform1f(u.uLevel, frame.audio.level);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
    },
  };
}
