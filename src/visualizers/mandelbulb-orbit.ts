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

float mandelbulbDE(vec3 pos, float power) {
  vec3 z = pos;
  float dr = 1.0;
  float r = 0.0;
  float trap = 1e9;
  for (int i = 0; i < 6; i++) {
    r = length(z);
    if (r > 2.0) break;
    float theta = acos(clamp(z.z / r, -1.0, 1.0));
    float phi = atan(z.y, z.x);
    dr = pow(r, power - 1.0) * power * dr + 1.0;
    float zr = pow(r, power);
    theta *= power;
    phi *= power;
    z = zr * vec3(sin(theta)*cos(phi), sin(theta)*sin(phi), cos(theta)) + pos;
    trap = min(trap, min(abs(z.x), min(abs(z.y), abs(z.z))));
  }
  return 0.5 * log(max(r, 1e-9)) * r / dr;
}

vec3 calcNormal(vec3 p, float power) {
  float h = 0.002;
  vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * mandelbulbDE(p + k.xyy*h, power) +
    k.yyx * mandelbulbDE(p + k.yyx*h, power) +
    k.yxy * mandelbulbDE(p + k.yxy*h, power) +
    k.xxx * mandelbulbDE(p + k.xxx*h, power)
  );
}

vec3 cosPalette(float t, vec3 a, vec3 b) {
  return a + b * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

  float power = 8.0 + sin(uTime * 0.2) * 2.0 + uMid * 3.0 + uBeat * 2.0;

  float orbitR = 2.8 + uBass * 1.2;
  float angle = uTime * 0.3;
  vec3 camPos = vec3(orbitR * cos(angle), orbitR * 0.35 * sin(uTime * 0.17), orbitR * sin(angle));
  vec3 target = vec3(0.0);
  vec3 ww = normalize(target - camPos);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.6 * ww);

  float t = 0.0;
  float trap = 1e9;
  int steps = 0;
  for (int i = 0; i < 48; i++) {
    vec3 p = camPos + t * rd;
    vec3 z = p;
    float dr2 = 1.0;
    float r2 = 0.0;
    float localTrap = 1e9;
    for (int j = 0; j < 6; j++) {
      r2 = length(z);
      if (r2 > 2.0) break;
      float theta2 = acos(clamp(z.z / r2, -1.0, 1.0));
      float phi2 = atan(z.y, z.x);
      dr2 = pow(r2, power - 1.0) * power * dr2 + 1.0;
      float zr2 = pow(r2, power);
      theta2 *= power;
      phi2 *= power;
      z = zr2 * vec3(sin(theta2)*cos(phi2), sin(theta2)*sin(phi2), cos(theta2)) + p;
      localTrap = min(localTrap, min(abs(z.x), min(abs(z.y), abs(z.z))));
    }
    float d = 0.5 * log(max(r2, 1e-9)) * r2 / dr2;
    if (d < 0.001) { trap = localTrap; steps = i; break; }
    t += d;
    if (t > 8.0) break;
  }

  vec3 col = vec3(0.02, 0.02, 0.04);

  if (t < 8.0) {
    vec3 p = camPos + t * rd;
    vec3 n = calcNormal(p, power);
    float ao = 1.0 - float(steps) / 48.0;

    float trapT = clamp(trap * 2.5, 0.0, 1.0);
    vec3 iridescent = cosPalette(trapT + uTime * 0.05, uPrimary * 0.5, uAccent * 0.5);

    float fresnel = pow(1.0 - clamp(dot(-rd, n), 0.0, 1.0), 3.0);
    vec3 rimCol = mix(uAccent, vec3(1.0), 0.5) * fresnel * 1.5;

    float diff = clamp(dot(n, normalize(vec3(1.0, 1.5, 0.8))), 0.0, 1.0);
    float spec = pow(clamp(dot(reflect(rd, n), normalize(vec3(1.0, 1.5, 0.8))), 0.0, 1.0), 32.0);

    float trebleGlint = uTreble * spec * 2.0;

    col = iridescent * (0.3 + 0.7 * diff) * ao;
    col += rimCol * ao;
    col += vec3(trebleGlint);
    col = mix(col, col * 1.4, uBeat * 0.4);
  }

  fragColor = vec4(col, 1.0);
}
`;

const NAMES = ['uResolution', 'uTime', 'uBass', 'uMid', 'uTreble', 'uBeat', 'uPrimary', 'uAccent'] as const;

export function createMandelbulbOrbit(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  const u: Record<string, WebGLUniformLocation | null> = {};

  return {
    id: 'mandelbulb-orbit',
    name: 'Mandelbulb Alien Orbit',
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
