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

// Convert cartesian to axial hex coordinates and return cell center in UV space
vec2 hexCenter(vec2 p, float size) {
  float q = (p.x * 2.0 / 3.0) / size;
  float r = (-p.x / 3.0 + sqrt(3.0) / 3.0 * p.y) / size;
  float s = -q - r;
  float rq = round(q); float rr = round(r); float rs = round(s);
  float dq = abs(rq - q); float dr = abs(rr - r); float ds = abs(rs - s);
  if (dq > dr && dq > ds) { rq = -rr - rs; }
  else if (dr > ds) { rr = -rq - rs; }
  // convert rounded axial back to cartesian center
  float cx = size * (rq * 2.0 / 3.0 + rr * (-1.0 / 3.0));
  float cy = size * (rr * sqrt(3.0) / 2.0 + rq * sqrt(3.0) / 4.0 - rq * sqrt(3.0) / 4.0);
  // simpler: use flat-top hex layout
  cx = size * (1.5 * rq);
  cy = size * (sqrt(3.0) * (rr + rq * 0.5));
  return vec2(cx, cy);
}

// Signed distance to a regular hexagon centered at origin, radius r
float hexSDF(vec2 p, float r) {
  const vec2 k = vec2(-0.866025, 0.5);
  p = abs(p);
  p -= 2.0 * min(dot(k, p), 0.0) * k;
  p -= vec2(clamp(p.x, -k.y * r, k.y * r), r);
  return length(p) * sign(p.y);
}

// Hash for per-cell flicker — returns pseudo-random float in [0,1)
float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 45.31);
  return fract(p.x * p.y);
}

void main() {
  vec2 fragUV = gl_FragCoord.xy / uResolution;
  // Aspect-corrected coords centered at screen middle
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 uv = (fragUV - 0.5) * aspect;

  float hexSize = 0.055;
  float sqrtThree = sqrt(3.0);

  // Flat-top hex grid tiling
  // Column and row indices
  float col = floor(uv.x / (1.5 * hexSize));
  float row = floor((uv.y - mod(col, 2.0) * hexSize * sqrtThree * 0.5) / (hexSize * sqrtThree));

  // Evaluate up to 3 candidate hex cells (the fragment's cell plus neighbours for edge accuracy)
  float bestDist = 1e9;
  vec2 bestCenter = vec2(0.0);

  for (int dc = -1; dc <= 1; dc++) {
    for (int dr = -1; dr <= 1; dr++) {
      float c = col + float(dc);
      float r = row + float(dr) + mod(c, 2.0) * 0.5 - mod(col, 2.0) * 0.5;
      vec2 center = vec2(c * 1.5 * hexSize, r * hexSize * sqrtThree);
      float d = length(uv - center);
      if (d < bestDist) {
        bestDist = d;
        bestCenter = center;
      }
    }
  }

  // Distance from screen center to cell center (drives ring phase)
  float cellDist = length(bestCenter);

  // Traveling ring activation — sum of two rings offset in time for density
  float speed = 3.0 + uMid * 4.0;
  float phase0 = cellDist * 6.0 - uTime * speed;
  float phase1 = cellDist * 6.0 - uTime * speed * 0.7 - 2.8;
  float wave0 = exp(-3.0 * abs(fract(phase0 * 0.159155) * 2.0 - 1.0));
  float wave1 = exp(-3.0 * abs(fract(phase1 * 0.159155) * 2.0 - 1.0));

  // Beat-triggered burst: add a sharp decaying ring seeded by uBeat
  float beatRing = uBeat * exp(-cellDist * 8.0) * exp(-mod(uTime, 3.14159) * 1.5);

  float activation = clamp(wave0 * 0.6 + wave1 * 0.4 + beatRing, 0.0, 1.0);

  // Per-cell pseudo-random flicker from uTreble
  float noise = hash21(bestCenter * 137.0);
  float flicker = 1.0 + uTreble * 0.4 * sin(uTime * 20.0 + noise * 6.283);

  // Hex SDF: interior vs. edge
  vec2 localUV = uv - bestCenter;
  float sdf = hexSDF(localUV, hexSize * 0.88);
  float edgeMask = 1.0 - smoothstep(-hexSize * 0.05, hexSize * 0.08, sdf);
  float interior = smoothstep(hexSize * 0.08, -hexSize * 0.02, sdf); // 1 inside

  // Cell brightness: inactive = dim primary, activated = flare accent
  float brightness = activation * uBass * flicker;
  vec3 cellColor = mix(uPrimary * 0.18, uAccent, smoothstep(0.0, 1.0, brightness));

  // Darken edges for hex-grid separation
  cellColor *= mix(0.35, 1.0, edgeMask);

  // Ambient glow even when audio is silent (pure uTime motion)
  float ambientWave = 0.5 + 0.5 * sin(cellDist * 10.0 - uTime * 2.0);
  cellColor = mix(uPrimary * 0.12 * ambientWave, cellColor, interior * 0.85 + 0.15);

  fragColor = vec4(cellColor, 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uBass', 'uMid', 'uTreble', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createHexpansionRipple(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'hexpansion-ripple',
    name: 'Hex Ripple Expansion',
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
