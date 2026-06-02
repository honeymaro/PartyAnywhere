import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;

// Mobius transform: rotate in hyperbolic sense by complex multiply
vec2 mobius(vec2 z, vec2 a) {
  // (z - a) / (1 - conj(a)*z)  -- maps disk to disk
  vec2 num = vec2(z.x - a.x, z.y - a.y);
  vec2 denom = vec2(1.0 - (a.x*z.x + a.y*z.y), a.x*z.y - a.y*z.x);
  float d2 = dot(denom, denom);
  return vec2(dot(num, denom), num.y*denom.x - num.x*denom.y) / d2;
}

vec2 cmul(vec2 a, vec2 b) {
  return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x);
}

// Reflect z across circle centered at c with radius r
vec2 invertCircle(vec2 z, vec2 c, float r) {
  vec2 d = z - c;
  return c + r * r * d / dot(d, d);
}

// Signed distance to geodesic arc (circular arc in Poincare disk)
// Arc is the geodesic through two boundary points on the unit circle
float geodesicDist(vec2 p, vec2 a, vec2 b) {
  // Center of the orthogonal circle through a and b
  // For points on unit circle: center = intersection of perpendicular bisectors
  vec2 mid = (a + b) * 0.5;
  vec2 perp = vec2(-(b.y - a.y), b.x - a.x);
  // t such that mid + t*perp is equidistant from a: dot(mid+t*perp-a, perp)==0 already true
  // Find t such that |mid+t*perp|^2 = |a|^2=1
  float A = dot(perp, perp);
  float B = 2.0 * dot(mid, perp);
  float C = dot(mid, mid) - 1.0;
  float disc = B*B - 4.0*A*C;
  if (disc < 0.0 || A < 1e-6) return 1e6;
  float t = (-B - sign(dot(mid, perp)) * sqrt(disc)) / (2.0 * A);
  vec2 cen = mid + t * perp;
  float rad = length(cen - a);
  return abs(length(p - cen) - rad);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  float diskR = length(uv);
  if (diskR >= 0.98) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  // Slow Mobius drift driven by uTime + uMid
  float drift = uTime * 0.07 + uMid * 0.4;
  float driftR = 0.35 * (0.5 + 0.5 * sin(uTime * 0.11));
  vec2 driftA = driftR * vec2(cos(drift), sin(drift));
  vec2 z = mobius(uv, driftA);

  // Rotation in the disk (hyperbolic isometry: multiply by e^{it})
  float rotAngle = uTime * 0.15 + uMid * 1.2;
  z = cmul(z, vec2(cos(rotAngle), sin(rotAngle)));

  // Fundamental domain: triangle in Poincare disk for {4,5} tiling approximation
  // Use three generating circles whose inversion tiles the disk
  // Circle centers and radii defining the fundamental triangle boundary
  const int ITERS = 22;
  const float R = 0.7071067; // cos(pi/4) ~ sqrt(2)/2, circle radius for square tiling

  // Three reflection circles for a compact fundamental domain
  vec2 c0 = vec2( 1.0,  0.0) * 0.8507;
  vec2 c1 = vec2(-0.5257,  0.8090) * 0.8507;
  vec2 c2 = vec2(-0.5257, -0.8090) * 0.8507;
  float cr = 0.6498; // radius of each inversion circle

  // Beat snaps: small jolt to parity offset on beat
  float beatPhase = uBeat * 3.14159;

  int parity = 0;
  for (int i = 0; i < ITERS; i++) {
    bool reflected = false;
    float d0 = length(z - c0);
    if (d0 < cr) { z = invertCircle(z, c0, cr); parity++; reflected = true; }
    float d1 = length(z - c1);
    if (d1 < cr) { z = invertCircle(z, c1, cr); parity++; reflected = true; }
    float d2 = length(z - c2);
    if (d2 < cr) { z = invertCircle(z, c2, cr); parity++; reflected = true; }
    if (!reflected) break;
  }

  // Tile color by parity
  float p = mod(float(parity) + sin(beatPhase) * 0.5, 2.0);
  vec3 tileCol = mix(uPrimary, uAccent, clamp(p, 0.0, 1.0));

  // Geodesic edge glow: distance to the three bounding arcs of fundamental triangle
  // Approximate with distance to each inversion circle boundary
  float edgeDist = min(min(
    abs(length(z - c0) - cr),
    abs(length(z - c1) - cr)),
    abs(length(z - c2) - cr));

  float edgeThick = 0.012 + uBass * 0.04;
  float edgeGlow = exp(-edgeDist / edgeThick);
  // Treble adds shimmer to edges
  edgeGlow *= 1.0 + uTreble * 0.6 * sin(uTime * 8.0 + length(z) * 20.0);

  vec3 col = tileCol + edgeGlow * uAccent * (1.5 + uTreble * 0.8);

  // Fade near disk boundary
  float fade = 1.0 - smoothstep(0.88, 0.98, diskR);
  col *= fade;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uBass', 'uMid', 'uTreble', 'uBeat', 'uPrimary', 'uAccent',
] as const;

export function createHyperbolicPoincare(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'hyperbolic-poincare',
    name: 'Hyperbolic Poincare Tiling',
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
      gl.uniform1f(u.uBass, frame.audio.bass);
      gl.uniform1f(u.uMid, frame.audio.mid);
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
