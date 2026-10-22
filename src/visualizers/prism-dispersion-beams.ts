import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { RenderFrame } from '../core/types';

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uLevel;
uniform float uBass;
uniform float uTreble;
uniform float uBeat;
uniform vec3 uPrimary;
uniform vec3 uAccent;
uniform sampler2D uSpectrum;
// prism geometry, computed once per frame on the CPU
uniform vec2 uV0; // apex
uniform vec2 uV1; // bottom-left corner
uniform vec2 uV2; // bottom-right corner
uniform vec2 uHit; // where the white beam enters the left face
uniform vec2 uExit; // where the dispersed fan leaves the right face
uniform vec2 uInDir; // incoming beam direction
uniform float uFanAngle; // fan center direction (radians)
uniform float uSpread; // fan opening angle (radians)
uniform float uBeamW; // beam half-width in screen units
uniform float uFlare; // overall beam intensity (kick flare)
uniform float uDrift; // accumulated dust drift along the beams

const int BEAMS = 12;

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// signed distance to a triangle (negative inside)
float sdTriangle(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
  vec2 v0 = p - p0, v1 = p - p1, v2 = p - p2;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                   vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                   vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Beam color across the fan: the live palette carries the hue, a light spectral tint keeps
// the prism read (a pure hard-coded rainbow would ignore the palette).
vec3 beamColor(float fi) {
  vec3 base = mix(uPrimary, uAccent, fi);
  vec3 rainbow = clamp(abs(fract(fi * 0.75 + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return mix(base, rainbow * max(max(base.r, base.g), base.b), 0.3);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  float px = 1.0 / min(uResolution.x, uResolution.y);

  // dark backdrop with a faint palette glow around the prism
  vec3 col = mix(uPrimary, uAccent, 0.5) * 0.03 * smoothstep(1.4, 0.0, length(uv - uV0 * 0.5));

  // ---- dispersed fan: one beam per spectrum band (low bands at the top) ----
  vec2 v = uv - uExit;
  float rv = length(v);
  float ang = atan(v.y, v.x) - uFanAngle;
  float uf = ang / uSpread + 0.5; // 0..1 across the fan
  float fanLight = 0.0;
  if (uf > -0.15 && uf < 1.15 && rv > 0.0) {
    float bi = uf * float(BEAMS) - 0.5;
    float i0 = floor(bi);
    float fr = bi - i0;
    float fade = smoothstep(0.0, 0.03, rv) * exp(-rv * 0.35);
    float w = uBeamW * (1.0 + rv * 0.8);
    // the two nearest beams cover this pixel (their glows overlap near the exit point)
    for (int k = 0; k < 2; k++) {
      float idx = i0 + float(k);
      if (idx < 0.0 || idx > float(BEAMS - 1)) continue;
      float off = (fr - float(k)) * (uSpread / float(BEAMS)) * rv; // across-beam distance
      float fi = idx / float(BEAMS - 1);
      float e = texture(uSpectrum, vec2(mix(0.03, 0.8, fi), 0.5)).r;
      float g = exp(-off * off / (w * w));
      float inten = g * (0.12 + e * e * 1.4) * fade;
      fanLight += inten;
      col += beamColor(fi) * inten * uFlare;
    }
    // soft haze filling the fan so it reads as one spread of light
    float fanMask = smoothstep(-0.08, 0.04, uf) * smoothstep(1.08, 0.96, uf);
    col += beamColor(clamp(uf, 0.0, 1.0)) * fanMask * fade * 0.07 * uFlare;

    // dust motes drifting outward along the beams: round, jittered dots in fan coordinates
    // (replaces the old square hash grid). Only visible where beam light falls on them.
    vec2 cell = vec2(rv * 14.0 - uDrift, uf * float(BEAMS) * 1.5);
    vec2 id = floor(cell);
    id.x = mod(id.x, 1000.0); // uDrift wraps at 1000 on the CPU: keep every mote's identity
    vec2 f = fract(cell);
    float h = hash12(id + 17.0);
    vec2 jit = vec2(hash12(id + 3.1), hash12(id + 7.7)) * 0.6 + 0.2;
    vec2 dd = vec2((f.x - jit.x) / 14.0, (f.y - jit.y) * (uSpread / (float(BEAMS) * 1.5)) * rv);
    float mr = 0.0025 + px;
    float mote = step(0.55, h) * exp(-dot(dd, dd) / (mr * mr));
    float tw = 0.5 + 0.5 * sin(uTime * (2.0 + h * 5.0) + h * 30.0);
    col += mix(uAccent, vec3(1.0), 0.5) * mote * (fanLight * 2.0 + fanMask * fade * 0.15)
         * (0.35 + uTreble * 1.2) * tw;
  }

  // ---- incoming white beam and its path through the glass ----
  float dIn = sdSegment(uv, uHit - uInDir * 3.0, uHit);
  float wIn = uBeamW * 0.9;
  float inBeam = exp(-dIn * dIn / (wIn * wIn)) + 0.25 * exp(-dIn / (wIn * 4.0));
  col += mix(vec3(1.0), uPrimary, 0.25) * inBeam * (0.55 + uLevel * 0.25) * uFlare;
  float dMid = sdSegment(uv, uHit, uExit);
  col += mix(vec3(1.0), mix(uPrimary, uAccent, 0.5), 0.4) * exp(-dMid * dMid / (wIn * wIn * 1.8)) * 0.6 * uFlare;

  // ---- the prism: glassy body, bright rim, flash on the kick ----
  float sd = sdTriangle(uv, uV0, uV1, uV2);
  float inside = step(sd, 0.0);
  vec3 glass = mix(uPrimary, uAccent, clamp((uv.y - uV1.y) * 2.0, 0.0, 1.0));
  col += glass * inside * (0.05 + 0.1 * exp(sd * 18.0)) * (1.0 + uBeat * 0.8);
  float rim = exp(-abs(sd) / (0.0025 + px));
  col += mix(glass, vec3(1.0), 0.55) * rim * (0.45 + uLevel * 0.2 + uBeat * 1.0);
  // light pooling at the entry and exit points
  col += vec3(1.0) * exp(-length(uv - uHit) * 30.0) * 0.35 * uFlare;
  col += mix(vec3(1.0), uAccent, 0.3) * exp(-rv * 22.0) * (0.3 + uBeat * 1.0);

  // vignette and soft tone map (keeps overlapping beams from clipping flat)
  col *= 1.0 - smoothstep(0.8, 1.6, length(uv));
  col = 1.0 - exp(-col * 1.3);
  fragColor = vec4(col, 1.0);
}
`;

const NAMES = [
  'uResolution', 'uTime', 'uLevel', 'uBass', 'uTreble', 'uBeat', 'uPrimary', 'uAccent', 'uSpectrum',
  'uV0', 'uV1', 'uV2', 'uHit', 'uExit', 'uInDir', 'uFanAngle', 'uSpread', 'uBeamW', 'uFlare', 'uDrift',
] as const;

export function createPrismDispersionBeams(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};
  let sway = 0; // accumulated phase of the slow prism rock (rate from the mids)
  let drift = 0; // accumulated dust drift

  return {
    id: 'prism-dispersion-beams',
    name: 'Prism Dispersion Beams',
    init(context: VisualizerContext) {
      ctx = context;
      gl = context.gl;
      program = context.compileFragment(FRAG);
      for (const name of NAMES) u[name] = gl.getUniformLocation(program, name);
    },
    resize() {},
    render(frame: RenderFrame) {
      const a = frame.audio;
      sway = (sway + (0.12 + a.mid * 0.1) * frame.dt) % (Math.PI * 2);
      drift = (drift + (0.4 + a.level * 0.8 + a.beat * 2.0) * frame.dt) % 1000;
      // prism geometry: equilateral triangle, apex up, rocking gently (bounded oscillation
      // driven by an accumulated phase, so the audio never jerks it back and forth)
      const theta = 0.1 * Math.sin(sway);
      const px = -0.32, py = 0.02, R = 0.27;
      const vx: number[] = [], vy: number[] = [];
      for (let k = 0; k < 3; k++) {
        const ang = Math.PI / 2 + theta + (k * 2 * Math.PI) / 3;
        vx.push(px + R * Math.cos(ang));
        vy.push(py + R * Math.sin(ang));
      }
      // vertex 1 = bottom-left, vertex 2 = bottom-right
      const hx = vx[0] + (vx[1] - vx[0]) * 0.55, hy = vy[0] + (vy[1] - vy[0]) * 0.55;
      const ex = vx[0] + (vx[2] - vx[0]) * 0.6, ey = vy[0] + (vy[2] - vy[0]) * 0.6;
      const inAng = -0.2 + theta * 0.5;
      // light bends toward the base; the fan deviation follows the prism's rock
      const fanAngle = -0.3 - theta * 1.3;
      // kicks open the fan slightly and fatten/brighten the beams (all return to rest)
      const spread = 0.46 * (1 + a.beat * 0.05);
      const beamW = 0.0055 * (1 + a.bass * 0.35 + a.beat * 0.6);
      const flare = 0.65 + a.level * 0.35 + a.beat * 1.3;

      gl.useProgram(program);
      ctx.quad.bind(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, ctx.spectrumTex);
      gl.uniform1i(u.uSpectrum, 0);
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uTime, frame.time);
      gl.uniform1f(u.uLevel, a.level);
      gl.uniform1f(u.uBass, a.bass);
      gl.uniform1f(u.uTreble, a.treble);
      gl.uniform1f(u.uBeat, a.beat);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.uniform2f(u.uV0, vx[0], vy[0]);
      gl.uniform2f(u.uV1, vx[1], vy[1]);
      gl.uniform2f(u.uV2, vx[2], vy[2]);
      gl.uniform2f(u.uHit, hx, hy);
      gl.uniform2f(u.uExit, ex, ey);
      gl.uniform2f(u.uInDir, Math.cos(inAng), Math.sin(inAng));
      gl.uniform1f(u.uFanAngle, fanAngle);
      gl.uniform1f(u.uSpread, spread);
      gl.uniform1f(u.uBeamW, beamW);
      gl.uniform1f(u.uFlare, flare);
      gl.uniform1f(u.uDrift, drift);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
    },
  };
}
