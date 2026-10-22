import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

// An old CRT playing a VHS tape of a retro LED spectrum analyzer: palette-colored
// segmented bars (with falling peak caps tracked on the CPU) over a slow plasma backdrop,
// seen through a fixed barrel-curved tube with scanlines, a phosphor triad mask, grain
// and a vignette. The VHS damage is driven by the kick: each kick fires a tracking tear
// (fresh row pattern per kick), a short vertical jump, a chromatic split and a bloom.
// The rolling tracking bar advances at a CPU-accumulated rate (one-way).
const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uRoll;       // accumulated tracking-bar position (audio = rate, one-way)
uniform float uSeed;       // kick counter: a new tear pattern for every kick
uniform float uLevel;
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;
uniform sampler2D uSpectrum;
uniform float uPeaks[24];  // falling peak caps per bar (CPU)

const float BARS = 24.0;

float hash(float n) { return fract(sin(n) * 43758.5453123); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// fixed tube curvature (the geometry never moves with the audio)
vec2 barrel(vec2 uv) {
  vec2 d = uv - 0.5;
  float r2 = dot(d, d);
  return uv + d * (0.2 * r2 + 0.04 * r2 * r2);
}

// What the tape shows: LED spectrum bars over a slow palette plasma.
vec3 tubeContent(vec2 uv) {
  vec2 p = uv * 2.0 - 1.0;
  float pl = sin(p.x * 2.6 + uTime * 0.45) + sin(p.y * 3.4 - uTime * 0.35)
           + sin((p.x + p.y) * 2.2 + uTime * 0.27);
  vec3 col = mix(uPrimary, uAccent, 0.5 + 0.5 * sin(pl * 1.3)) * (0.24 + uLevel * 0.06);
  // horizon glow behind the bars
  col += mix(uPrimary, uAccent, 0.5) * 0.12 * smoothstep(0.6, 0.1, uv.y);

  float x = (uv.x - 0.07) / 0.86;
  if (x > 0.0 && x < 1.0 && uv.y > 0.1) {
    float bi = floor(x * BARS);
    float bx = fract(x * BARS);
    float v = textureLod(uSpectrum, vec2(0.04 + (bi + 0.5) / BARS * 0.88, 0.5), 0.0).r;
    float top = 0.1 + v * 0.72;
    float yb = uv.y - 0.1;
    float inX = smoothstep(0.1, 0.16, bx) * smoothstep(0.9, 0.84, bx);
    float seg = smoothstep(0.2, 0.3, fract(yb * 42.0));         // LED segments
    float lit = inX * seg * smoothstep(top + 0.004, top - 0.004, uv.y);
    vec3 barCol = mix(uPrimary, uAccent, smoothstep(0.12, 0.75, uv.y));
    col = mix(col, barCol * 1.35, lit);
    // unlit segments still faintly visible (LED panel look)
    col += barCol * 0.1 * inX * seg * (1.0 - lit) * step(uv.y, 0.82);
    // falling peak cap
    float pk = 0.1 + uPeaks[int(bi)] * 0.72;
    col = mix(col, mix(barCol, vec3(1.0), 0.6), inX * smoothstep(0.008, 0.002, abs(uv.y - pk - 0.008)));
  }
  // blinking REC dot in the corner
  float rec = smoothstep(0.022, 0.016, length((uv - vec2(0.08, 0.9)) * vec2(1.6, 1.0)));
  col = mix(col, mix(uAccent, vec3(1.0), 0.2), rec * step(0.5, fract(uTime * 0.8)));
  return col;
}

void main() {
  vec2 fragUV = gl_FragCoord.xy / uResolution;
  float glitch = uBeat * uBeat;                      // sharp: big right on the kick, gone fast

  // short vertical "jump" of the picture on a kick (returns to rest as the pulse decays)
  vec2 distUV = barrel(fragUV);
  float inside = step(0.0, distUV.x) * step(distUV.x, 1.0) * step(0.0, distUV.y) * step(distUV.y, 1.0);
  if (inside < 0.5) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec2 picUV = distUV + vec2(0.0, glitch * 0.025);

  // --- tracking: rolling bad-track bar + per-kick tear bands ---
  float rowId = floor(distUV.y * 240.0);
  float tick = floor(uTime * 12.0);
  float barY = fract(uRoll);
  float inBar = smoothstep(0.06, 0.0, abs(distUV.y - barY) - 0.015);
  float trackShift = (hash(rowId * 0.31 + tick * 7.13) - 0.5) * (0.012 + 0.05 * glitch) * inBar;
  float band = floor(distUV.y * 18.0);
  float tearH = hash(band * 3.7 + uSeed * 11.3);
  float tear = step(0.7, tearH) * (tearH - 0.85) * 0.5 * glitch;
  vec2 tubeUV = vec2(picUV.x + trackShift + tear, fract(picUV.y));

  // --- content with chromatic aberration (split jumps on the kick) ---
  float aberr = 0.002 + 0.003 * uTreble + 0.018 * glitch;
  vec3 cR = tubeContent(tubeUV + vec2(aberr, 0.0));
  vec3 cG = tubeContent(tubeUV);
  vec3 cB = tubeContent(tubeUV - vec2(aberr, 0.0));
  vec3 content = vec3(cR.r, cG.g, cB.b);

  // --- scanlines (fixed count, slowly rolling) ---
  float scanLine = 0.5 + 0.5 * sin(distUV.y * 300.0 * 3.14159 - uTime * 2.0);
  content *= mix(1.0, scanLine, 0.4);

  // --- RGB phosphor triad mask ---
  float col3 = mod(gl_FragCoord.x, 3.0);
  vec3 mask = vec3(
    smoothstep(0.0, 0.5, 0.5 - abs(col3 - 0.5)),
    smoothstep(0.0, 0.5, 0.5 - abs(col3 - 1.5)),
    smoothstep(0.0, 0.5, 0.5 - abs(col3 - 2.5))
  ) * 0.3 + 0.7;
  content *= mask;

  // --- static grain (treble) ---
  float grain = hash2(floor(gl_FragCoord.xy) + vec2(uTime * 47.3, uTime * 31.7)) - 0.5;
  content += grain * (0.04 + 0.1 * uTreble);

  // --- vignette ---
  vec2 vd = distUV - 0.5;
  float vign = clamp(1.0 - dot(vd, vd) * 2.0, 0.0, 1.0);
  vec3 final = content * (0.35 + 0.65 * vign * vign);

  // phosphor bloom: the tube flares on the kick, glows a little with bass
  final *= 1.05 + uBass * 0.25 + glitch * 0.6;
  final += mix(uPrimary, uAccent, 0.5) * glitch * 0.08 * vign;

  // dropout scratches (treble) inside the tracking bar and on kicks
  float scratch = step(0.993, hash(floor(distUV.y * 400.0) + tick * 1.7));
  final += scratch * (uTreble * 0.4 * inBar + glitch * 0.6);

  fragColor = vec4(clamp(final, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uRoll', 'uSeed', 'uLevel', 'uBass', 'uTreble', 'uBeat',
  'uPrimary', 'uAccent', 'uSpectrum', 'uPeaks',
] as const;

const BARS = 24;

export function createCrtVhsTube(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let roll = 0; // tracking-bar position (audio modulates the rate; only ever increases)
  let seed = 0; // kick counter (rising edge of the beat pulse)
  let prevBeat = 0;
  let sinceKick = 99;
  const peaks = new Float32Array(BARS);

  return {
    id: 'crt-vhs-tube',
    name: 'CRT VHS Tube',
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
      roll += (0.08 + a.level * 0.06 + a.beat * 0.8) * frame.dt;
      sinceKick += frame.dt;
      if (a.beat > 0.85 && prevBeat <= 0.85 && sinceKick > 0.1) {
        seed++;
        sinceKick = 0;
      }
      prevBeat = a.beat;
      // peak caps: jump to the bar, then fall at a constant speed (same bins as the shader)
      const spec = a.spectrum;
      for (let i = 0; i < BARS; i++) {
        const x = 0.04 + ((i + 0.5) / BARS) * 0.88;
        const v = (spec[Math.min(spec.length - 1, Math.floor(x * spec.length))] ?? 0) / 255;
        peaks[i] = Math.max(v, peaks[i] - frame.dt * 0.35);
      }
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      // time and the kick counter feed float32 hashes (grain, tear rows); left unbounded they
      // lose precision after hours of uptime (the kick scratches vanish), so wrap them. The REC
      // blink stays seamless at the wrap; the backdrop plasma shifts once per hour.
      gl.uniform1f(u.uTime, frame.time % 3600);
      gl.uniform1f(u.uRoll, roll);
      gl.uniform1f(u.uSeed, seed % 256);
      gl.uniform1f(u.uLevel, a.level);
      gl.uniform1f(u.uBass, a.bass);
      gl.uniform1f(u.uTreble, a.treble);
      gl.uniform1f(u.uBeat, a.beat);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.uniform1fv(u.uPeaks, peaks);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
    },
  };
}
