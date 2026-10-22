import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// Audio-reactive adaptation of "Fractal Pyramid" by bradjamesgrant
// (https://www.shadertoy.com/view/tsXBzS): a kaleidoscopic IFS fold raymarched with
// glow accumulation. Reworked for GLSL ES 3.00 (int raymarch loop), colored from the
// live palette, and driven by accumulated phase uniforms so the music changes the
// morph/orbit RATE one-directionally (no piston/wobble) while beats brighten the glow.
//
// Cost: the fold rotation and the camera basis are built once per frame on the CPU; the
// march starts at a bounding sphere (the folded set lies within r = 5.9) and stops when it
// leaves it, so rays no longer burn 60+ steps escaping to infinity; the far glow those steps
// used to collect is replaced by an analytic halo. The DE (L1 norm / 5) is ~0.35-Lipschitz,
// so it is safe to step the full estimate (the original halved it), and the glow sum is
// doubled to match. Exposure goes through a soft tonemap so the core keeps its hue.
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform mat3 uFold;   // per-fold rotation (xz by the morph phase, then xy by 1.89x of it)
uniform vec3 uCamPos; // orbiting camera (accumulated orbit phase)
uniform mat3 uCamRot; // camera basis: right, up, forward
uniform float uBass;
uniform float uBeat;
uniform float uLevel;
uniform vec3 uPrimary;
uniform vec3 uAccent;

const float BOUND = 7.2; // bounding sphere of the folded set (surface max ~5.9)

// Distance estimate of the folded pyramid (L1 norm of the 8-times folded point).
float map(vec3 p){
  for(int i = 0; i < 8; i++){
    p = uFold * p;
    p.xz = abs(p.xz) - 0.5;
  }
  p = abs(p);
  return (p.x + p.y + p.z) * 0.2;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.x;
  vec3 ro = uCamPos;
  vec3 rd = normalize(uCamRot * vec3(uv, 3.0));

  // Ray vs bounding sphere (the fractal sits at the origin).
  float b = dot(ro, rd);
  float c = dot(ro, ro) - BOUND * BOUND;
  float h = b * b - c;

  // Glow march inside the sphere: accumulate 1/d (thin folds bloom) and a 1/d-weighted
  // radius that picks the palette color afterwards (one scalar sum instead of a vec3 mix).
  float glow = 0.0, glowR = 0.0;
  if (h > 0.0) {
    h = sqrt(h);
    float t = -b - h;
    float tEnd = -b + h;
    for(int i = 0; i < 32; i++){
      vec3 p = ro + rd * t;
      float d = map(p);
      if (d < 0.04) break;
      // the glow fades out toward the sphere so its rim never shows; the halo takes over
      float r = length(p);
      float w = smoothstep(BOUND, BOUND - 1.6, r) / d;
      glow += w;
      glowR += w * r;
      t += d;
      if (t > tEnd) break;
    }
  }

  // Analytic halo from the ray's closest approach to the center (replaces the far steps).
  float dmin = length(ro - rd * b);
  float halo = 0.09 / (1.0 + dmin * dmin * 0.1);

  float r = glowR / max(glow, 1e-4);
  vec3 pal = mix(uPrimary, uAccent, smoothstep(1.5, 5.5, r));

  // Kick: glow gain jumps (bloom), bass bed adds a little; exposure is tonemapped so the
  // brightest folds go toward a hot tint instead of flat white.
  float gain = 0.75 + uLevel * 0.25 + uBass * 0.45 + uBeat * 1.1;
  float g = glow * 0.0034 * gain;
  vec3 col = pal * (1.0 - exp(-g * 1.6));
  col += mix(pal, vec3(1.0), 0.6) * smoothstep(0.7, 2.6, g) * 0.35; // controlled hot core
  col += mix(uPrimary, uAccent, 0.4) * halo * (0.8 + uBass * 0.6 + uBeat * 1.4);
  col += uPrimary * 0.02;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uFold', 'uCamPos', 'uCamRot', 'uBass', 'uBeat', 'uLevel', 'uPrimary', 'uAccent',
] as const;

export function createFractalPyramid(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let morph = 0; // fold-rotation phase (rate rides the mids; only ever increases)
  let orbit = 0; // camera-orbit phase (rate rides overall level; only ever increases)
  const fold = new Float32Array(9);
  const camRot = new Float32Array(9);
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
      morph += (0.12 + frame.audio.mid * 0.3 + frame.audio.beat * 0.6) * frame.dt;
      orbit += (0.15 + frame.audio.level * 0.25 + frame.audio.beat * 0.5) * frame.dt;

      // Fold matrix (column-major): rotate xz by morph, then xy by morph * 1.89, matching
      // the original p.xz *= mat2(c, s, -s, c); p.xy *= mat2(...).
      const ca = Math.cos(morph), sa = Math.sin(morph);
      const cb = Math.cos(morph * 1.89), sb = Math.sin(morph * 1.89);
      const apply = (x: number, y: number, z: number, o: number) => {
        const x1 = x * ca + z * sa;
        const z1 = -x * sa + z * ca;
        fold[o] = x1 * cb + y * sb;
        fold[o + 1] = -x1 * sb + y * cb;
        fold[o + 2] = z1;
      };
      apply(1, 0, 0, 0);
      apply(0, 1, 0, 3);
      apply(0, 0, 1, 6);

      // Camera orbits at radius 50 in the xz plane and looks at the origin. The kick pushes
      // it in by up to ~6 % (a short punch that decays with the beat pulse, not a zoom drift).
      const dist = 50 * (1 - frame.audio.beat * 0.045 - frame.audio.bass * 0.015);
      const co = Math.cos(orbit), so = Math.sin(orbit);
      const px = -dist * so, pz = -dist * co; // (0,0,-dist) rotated like the original
      const fx = so, fz = co; // forward = normalize(-pos)
      // right = normalize(cross(f, up)), up' = cross(f, right) as in the original shader
      const rx = -fz, rz = fx; // cross((fx,0,fz),(0,1,0)) = (-fz, 0, fx)
      const ux = 0, uy = fz * rx - fx * rz, uz = 0; // cross((fx,0,fz),(rx,0,rz)) = (0, fz*rx - fx*rz, 0)
      camRot.set([rx, 0, rz, ux, uy, uz, fx, 0, fz]);

      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniformMatrix3fv(u.uFold, false, fold);
      gl.uniform3f(u.uCamPos, px, 0, pz);
      gl.uniformMatrix3fv(u.uCamRot, false, camRot);
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
