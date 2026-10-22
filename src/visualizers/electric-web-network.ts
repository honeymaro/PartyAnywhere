import type { Visualizer, VisualizerContext } from '../gl/visualizer';
import type { AudioFrame, RenderFrame } from '../core/types';

// A drifting web of nodes joined by thin electric links. All the graph work happens on
// the CPU once per frame: node positions (jittered grid + slow accumulated drift), the
// set of nearby pairs (faded in/out by length so links never pop), and a "discharge"
// for every detected onset: it starts at a hub node and races outward hop by hop
// (breadth-first over the current links), firing bright pulses along each link, making
// each link crackle as it passes and flaring every node it reaches.
// The shader only visits the links and nodes that can reach its screen tile: the CPU
// bins them into a coarse tile grid and uploads per-tile bit masks (an RGBA32UI texture:
// 64 link bits + 15 node bits), so each pixel walks a handful of items, not all of them.
const COLS = 5;
const ROWS = 3;
const NODES = COLS * ROWS;
const MAX_E = 40; // must stay <= 64 (two 32-bit masks per tile)
const LINK_DIST = 0.55; // max link length (uv units, screen height = 1)
const HOP_SPEED = 6.0; // discharge speed in hops per second
const DISCHARGES = 2;
const REACH = 0.05; // how far a link's glow reaches (uv units)
const TX = 32; // tile grid
const TY = 18;

const FRAG = `#version 300 es
precision highp float;
precision highp usampler2D;
out vec4 fragColor;
uniform vec2 uResolution;
uniform float uBass;
uniform float uBeat;
uniform float uSurge;  // instant whole-web surge on each onset, decays in ~0.15 s
uniform vec3 uPrimary;
uniform vec3 uAccent;
uniform vec4 uNodes[${NODES}];  // xy position, z flare 0..1+, w halo reach
uniform vec4 uEdge[${MAX_E}];   // start a.xy, unit direction a -> b (discharges travel a -> b)
uniform vec4 uEdgeP[${MAX_E}];  // fade, ambient pulse position, charged trail, length
uniform vec4 uEdgeK[${MAX_E}];  // discharge pulses: (pos, amp) x 2
uniform usampler2D uTiles;      // per-tile masks: r = links 0..31, g = links 32..63, b = nodes

const float REACH = ${REACH};

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  float aa = 1.2 / min(uResolution.x, uResolution.y);

  vec3 col = vec3(0.012, 0.012, 0.03) + mix(uPrimary, uAccent, 0.5) * (0.025 + uBeat * 0.02 + uSurge * 0.04);
  float surge = 1.0 + uSurge * 1.3;
  vec3 hot = mix(uAccent, vec3(1.0), 0.55);

  ivec2 tile = ivec2(min(gl_FragCoord.xy / uResolution * vec2(${TX}.0, ${TY}.0), vec2(${TX - 1}.0, ${TY - 1}.0)));
  uvec4 mask = texelFetch(uTiles, tile, 0);
  for (int w = 0; w < 2; w++) {
    uint bits = w == 0 ? mask.r : mask.g;
    for (int it = 0; it < 32; it++) {
      if (bits == 0u) break;
      uint low = bits & (~bits + 1u); // lowest set bit
      bits ^= low;
      int e = w * 32 + int(log2(float(low)) + 0.5);

      vec4 E = uEdge[e];
      vec2 ap = uv - E.xy;
      // cheap rejection: too far across the line, or beyond either end
      float side = ap.x * E.w - ap.y * E.z; // signed distance across the link
      if (abs(side) > REACH) continue;
      vec4 P = uEdgeP[e];
      float len = P.w;
      float tl = dot(ap, E.zw); // distance along the link
      if (tl < -REACH || tl > len + REACH) continue;

      vec4 K = uEdgeK[e];
      float t = clamp(tl / len, 0.0, 1.0);
      // a charged link crackles: a zigzag across it that settles back as the charge fades
      float charge = P.z;
      float jag = (0.0015 + charge * 0.008) * sin(t * 3.14159265)
                * (0.6 * sin(t * len * 95.0 + len * 13.0) + 0.4 * sin(t * len * 41.0 - len * 29.0));
      float d = (tl < 0.0 || tl > len) ? length(ap - E.zw * (t * len)) : abs(side - jag);

      float fade = P.x;
      float lw = 0.0012 + charge * 0.0015;
      float core = smoothstep(lw + aa, lw - aa, d);
      float glow = exp(-d * 55.0) * smoothstep(REACH, REACH * 0.5, d);
      float lineI = fade * (core * (0.8 + charge * 1.5) + glow * (0.14 + uBass * 0.14 + charge * 0.7));
      col += mix(uPrimary, hot, charge * 0.6 + uSurge * 0.3) * lineI * surge;

      // pulses: an ambient spark plus the discharge fronts (sized in world units)
      float sa = (t - P.y) * len / 0.025;
      float s1 = (t - K.x) * len / 0.03;
      float s2 = (t - K.z) * len / 0.03;
      float pulse = exp(-sa * sa) * 0.6 + exp(-s1 * s1) * K.y * 2.5 + exp(-s2 * s2) * K.w * 2.5;
      col += hot * pulse * fade * (exp(-d * 140.0) + exp(-d * 35.0) * 0.25);
    }
  }

  // nodes: crisp cores with a halo; they flare when a discharge reaches them
  uint nbits = mask.b;
  for (int it = 0; it < ${NODES}; it++) {
    if (nbits == 0u) break;
    uint low = nbits & (~nbits + 1u);
    nbits ^= low;
    vec4 N = uNodes[int(log2(float(low)) + 0.5)];
    float d = length(uv - N.xy);
    float flare = N.z;
    float rr = 0.0075 + min(flare, 1.5) * 0.009;
    float core = smoothstep(rr + aa, rr - aa, d);
    // the halo ends smoothly at the node's reach (the radius it was binned with)
    float halo = exp(-d * (36.0 - min(flare, 1.5) * 12.0)) * (0.2 + flare * 0.8)
               * smoothstep(N.w, N.w * 0.6, d);
    col += mix(uAccent, vec3(1.0), 0.3 + min(flare, 1.0) * 0.5) * core;
    col += uAccent * halo;
  }

  // subtle vignette
  col *= 1.0 - smoothstep(0.55, 1.25, length(uv)) * 0.7;
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const NAMES = [
  'uResolution', 'uBass', 'uBeat', 'uSurge', 'uPrimary', 'uAccent',
  'uNodes', 'uEdge', 'uEdgeP', 'uEdgeK', 'uTiles',
] as const;

/** Deterministic 0..1 hash (stable node layout across sessions). */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function createElectricWebNetwork(): Visualizer {
  let gl: WebGL2RenderingContext;
  let ctx: VisualizerContext;
  let program: WebGLProgram;
  let tileTex: WebGLTexture;
  const u: Record<string, WebGLUniformLocation | null> = {};

  const nodes = new Float32Array(NODES * 4);
  const edges = new Float32Array(MAX_E * 4);
  const edgeP = new Float32Array(MAX_E * 4);
  const edgeK = new Float32Array(MAX_E * 4);
  const tileMask = new Uint32Array(TX * TY * 4);
  const px = new Float32Array(NODES);
  const py = new Float32Array(NODES);
  const pairs: { a: number; b: number; d: number }[] = [];
  const hops: Int32Array[] = [];
  for (let k = 0; k < DISCHARGES; k++) hops.push(new Int32Array(NODES));
  const adj: number[][] = Array.from({ length: NODES }, () => []);
  const queue = new Int32Array(NODES);

  let drift = 0; // node wander phase (audio sets the rate; only ever increases)
  let sparkClock = 0; // ambient spark travel (audio sets the rate; only ever increases)
  // Discharges, newest first: age (s), strength, hub node.
  const dAge = new Float32Array(DISCHARGES).fill(99);
  const dAmp = new Float32Array(DISCHARGES);
  const dHub = new Int32Array(DISCHARGES);
  let onsetCount = 0;
  let prevBeat = 0;
  let prevBass = 0;

  function trackKicks(a: AudioFrame, dt: number): void {
    for (let i = 0; i < DISCHARGES; i++) dAge[i] += dt;
    const onset = (a.beat - prevBeat > 0.25 && a.beat > 0.6) || (a.bass - prevBass > 0.18 && a.bass > 0.7);
    const amp = Math.min(1, 0.3 + 0.7 * a.bass);
    if (onset && dAge[0] > 0.1) {
      dAge.copyWithin(1, 0);
      dAmp.copyWithin(1, 0);
      dHub.copyWithin(1, 0);
      onsetCount++;
      dAge[0] = 0;
      dAmp[0] = amp;
      dHub[0] = Math.floor(hash(onsetCount * 7.31) * NODES) % NODES;
    } else if (onset) {
      dAmp[0] = Math.max(dAmp[0], amp); // bass landed a frame after the onset
    }
    prevBeat = a.beat;
    prevBass = a.bass;
  }

  /** Breadth-first hop counts from `hub` over the current links (-1 = unreachable). */
  function bfs(hub: number, out: Int32Array): void {
    out.fill(-1);
    out[hub] = 0;
    let head = 0;
    let tail = 0;
    queue[tail++] = hub;
    while (head < tail) {
      const n = queue[head++];
      for (const m of adj[n]) {
        if (out[m] < 0) {
          out[m] = out[n] + 1;
          queue[tail++] = m;
        }
      }
    }
  }

  /** Bins links and nodes into the screen tiles their glow (plus crackle) can touch. */
  function binTiles(count: number, w: number, h: number): void {
    tileMask.fill(0);
    const m = Math.min(w, h);
    const tw = w / TX / m; // tile size in uv units
    const th = h / TY / m;
    const x0 = (-0.5 * w) / m;
    const y0 = (-0.5 * h) / m;
    const tileR = 0.5 * Math.hypot(tw, th);
    // marks every tile within `pad` of the segment a -> a + dir * len (len 0 = a point)
    const mark = (ax: number, ay: number, dx: number, dy: number, len: number, pad: number, word: number, bit: number) => {
      const bx = ax + dx * len;
      const by = ay + dy * len;
      // only the tiles under the padded bounding box can qualify
      const tx0 = Math.max(0, Math.floor((Math.min(ax, bx) - pad - x0) / tw));
      const tx1 = Math.min(TX - 1, Math.floor((Math.max(ax, bx) + pad - x0) / tw));
      const ty0 = Math.max(0, Math.floor((Math.min(ay, by) - pad - y0) / th));
      const ty1 = Math.min(TY - 1, Math.floor((Math.max(ay, by) + pad - y0) / th));
      for (let ty = ty0; ty <= ty1; ty++) {
        const cy = y0 + (ty + 0.5) * th;
        for (let tx = tx0; tx <= tx1; tx++) {
          const cx = x0 + (tx + 0.5) * tw;
          const t = Math.min(len, Math.max(0, (cx - ax) * dx + (cy - ay) * dy));
          if (Math.hypot(cx - ax - dx * t, cy - ay - dy * t) <= pad) {
            tileMask[(ty * TX + tx) * 4 + word] |= bit;
          }
        }
      }
    };
    const linkPad = REACH + 0.012 + tileR; // glow + crackle + tile radius
    for (let e = 0; e < count; e++) {
      mark(edges[e * 4], edges[e * 4 + 1], edges[e * 4 + 2], edges[e * 4 + 3], edgeP[e * 4 + 3], linkPad, e >> 5, 1 << (e & 31));
    }
    for (let i = 0; i < NODES; i++) {
      mark(nodes[i * 4], nodes[i * 4 + 1], 1, 0, 0, nodes[i * 4 + 3] + tileR, 2, 1 << i);
    }
  }

  function update(frame: RenderFrame): void {
    const a = frame.audio;
    const aspect = frame.resolution[0] / Math.max(1, frame.resolution[1]);
    trackKicks(a, frame.dt);
    drift += (0.16 + a.mid * 0.12 + a.beat * 0.25) * frame.dt;
    sparkClock += (0.25 + a.level * 0.35) * frame.dt;

    // nodes: jittered grid spread over the screen, each wandering on its own slow orbit
    const cw = (aspect * 0.92) / COLS;
    const ch = 0.9 / ROWS;
    for (let i = 0; i < NODES; i++) {
      const c = i % COLS;
      const r = Math.floor(i / COLS);
      const hx = hash(i * 3.7 + 1.1);
      const hy = hash(i * 5.3 + 2.9);
      const bx = -aspect * 0.46 + (c + 0.5) * cw + (hx - 0.5) * cw * 0.5;
      const by = -0.45 + (r + 0.5) * ch + (hy - 0.5) * ch * 0.5;
      px[i] = bx + Math.sin(drift * (0.6 + hx * 0.8) + i * 2.39996) * cw * 0.22;
      py[i] = by + Math.cos(drift * (0.5 + hy * 0.7) + i * 1.61803) * ch * 0.22;
    }

    // links: nearby pairs, shortest first, capped
    pairs.length = 0;
    for (let i = 0; i < NODES; i++) {
      for (let j = i + 1; j < NODES; j++) {
        const d = Math.hypot(px[i] - px[j], py[i] - py[j]);
        if (d < LINK_DIST) pairs.push({ a: i, b: j, d });
      }
    }
    pairs.sort((p, q) => p.d - q.d);
    const count = Math.min(MAX_E, pairs.length);
    for (let i = 0; i < NODES; i++) adj[i].length = 0;
    for (let e = 0; e < count; e++) {
      adj[pairs[e].a].push(pairs[e].b);
      adj[pairs[e].b].push(pairs[e].a);
    }
    for (let k = 0; k < DISCHARGES; k++) bfs(dHub[k], hops[k]);

    // node flare: peaks as a discharge front reaches the node, plus a small beat lift
    for (let i = 0; i < NODES; i++) {
      let flare = a.beat * 0.35;
      for (let k = 0; k < DISCHARGES; k++) {
        const h = hops[k][i];
        if (h < 0 || dAge[k] > 5) continue;
        const x = (dAge[k] * HOP_SPEED - h) * 1.6;
        flare += dAmp[k] * Math.exp(-x * x) * Math.exp(-dAge[k] * 0.9) * 1.4;
      }
      nodes[i * 4] = px[i];
      nodes[i * 4 + 1] = py[i];
      nodes[i * 4 + 2] = flare;
      // halo reach: where exp(-d * k) * strength drops below ~0.003
      const fl = Math.min(flare, 1.5);
      nodes[i * 4 + 3] = Math.min(0.4, Math.log((0.2 + flare * 0.8) / 0.003) / (36 - fl * 12));
    }

    for (let e = 0; e < count; e++) {
      let { a: na, b: nb } = pairs[e];
      // orient each link along the newest discharge (lower hop count first)
      const h0 = hops[0];
      if (h0[nb] >= 0 && (h0[na] < 0 || h0[nb] < h0[na])) [na, nb] = [nb, na];
      const d = Math.max(pairs[e].d, 1e-4);
      const fade = 1 - d / LINK_DIST;
      edges[e * 4] = px[na];
      edges[e * 4 + 1] = py[na];
      edges[e * 4 + 2] = (px[nb] - px[na]) / d;
      edges[e * 4 + 3] = (py[nb] - py[na]) / d;
      const eh = hash(na * 31.7 + nb * 7.3);
      edgeP[e * 4] = fade * fade * (3 - 2 * fade); // smooth fade-in as a link forms
      edgeP[e * 4 + 1] = (sparkClock * (0.6 + eh * 0.6) + eh) % 1;
      let charge = 0;
      for (let k = 0; k < DISCHARGES; k++) {
        const ha = hops[k][na];
        const hb = hops[k][nb];
        let pos = -9;
        let amp = 0;
        if (ha >= 0 && hb >= 0 && dAge[k] < 5) {
          const from = Math.min(ha, hb);
          const dir = hb >= ha ? 1 : -1;
          const s = dAge[k] * HOP_SPEED - from; // 0..1 while the front crosses this link
          pos = dir > 0 ? s : 1 - s;
          amp = s > -0.2 && s < 1.2 ? dAmp[k] * Math.exp(-dAge[k] * 0.8) : 0;
          charge += dAmp[k] * Math.exp(-dAge[k] * 2.2) * Math.min(1, Math.max(0, s));
        }
        edgeK[e * 4 + k * 2] = pos;
        edgeK[e * 4 + k * 2 + 1] = amp;
      }
      edgeP[e * 4 + 2] = Math.min(charge, 1.5);
      edgeP[e * 4 + 3] = d;
    }
    binTiles(count, frame.resolution[0], frame.resolution[1]);
  }

  return {
    id: 'electric-web-network',
    name: 'Electric Node Network',
    init(context: VisualizerContext) {
      ctx = context;
      gl = context.gl;
      program = context.compileFragment(FRAG);
      for (const name of NAMES) u[name] = gl.getUniformLocation(program, name);
      tileTex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tileTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, TX, TY, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, tileMask);
    },
    resize() {},
    render(frame: RenderFrame) {
      update(frame);
      gl.useProgram(program);
      ctx.quad.bind(program);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tileTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TX, TY, gl.RGBA_INTEGER, gl.UNSIGNED_INT, tileMask);
      gl.uniform1i(u.uTiles, 1);
      gl.activeTexture(gl.TEXTURE0); // leave unit 0 active for the host's spectrum upload
      gl.uniform2f(u.uResolution, frame.resolution[0], frame.resolution[1]);
      gl.uniform1f(u.uBass, frame.audio.bass);
      gl.uniform1f(u.uBeat, frame.audio.beat);
      let surge = 0;
      for (let k = 0; k < DISCHARGES; k++) surge += dAmp[k] * Math.exp(-dAge[k] * 7);
      gl.uniform1f(u.uSurge, surge);
      gl.uniform3f(u.uPrimary, frame.palette.primary[0], frame.palette.primary[1], frame.palette.primary[2]);
      gl.uniform3f(u.uAccent, frame.palette.accent[0], frame.palette.accent[1], frame.palette.accent[2]);
      gl.uniform4fv(u.uNodes, nodes);
      gl.uniform4fv(u.uEdge, edges);
      gl.uniform4fv(u.uEdgeP, edgeP);
      gl.uniform4fv(u.uEdgeK, edgeK);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteProgram(program);
      gl.deleteTexture(tileTex);
    },
  };
}
