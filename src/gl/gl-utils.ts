import type { VisualizerContext } from './visualizer';

/** Shared fullscreen geometry: one oversized triangle that covers the whole clip space. */
export interface QuadGeometry {
  buffer: WebGLBuffer;
  /** Binds the vertex buffer to the program's `aPos` attribute. */
  bind(program: WebGLProgram): void;
  /** Releases the GPU buffer. */
  dispose(): void;
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}

export function compileProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
): WebGLProgram {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram()!;
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log}`);
  }
  return program;
}

const QUAD_VERTS = new Float32Array([-1, -1, 3, -1, -1, 3]);

export function createFullscreenQuad(gl: WebGL2RenderingContext): QuadGeometry {
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTS, gl.STATIC_DRAW);
  // WeakMap so cache entries for disposed programs are collectible (no leak over many activations).
  const locCache = new WeakMap<WebGLProgram, number>();
  return {
    buffer,
    bind(program: WebGLProgram) {
      let loc = locCache.get(program);
      if (loc === undefined) {
        loc = gl.getAttribLocation(program, 'aPos');
        locCache.set(program, loc);
      }
      if (loc === -1) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    },
    dispose() {
      gl.deleteBuffer(buffer);
    },
  };
}

export function createSpectrumTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/** Uploads the spectrum as a 1-row single-channel (R8) texture. No-op on an empty array. */
export function uploadSpectrum(
  gl: WebGL2RenderingContext,
  tex: WebGLTexture,
  spectrum: Uint8Array,
): void {
  if (spectrum.length === 0) return;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, spectrum.length, 1, 0, gl.RED, gl.UNSIGNED_BYTE, spectrum);
}

/** Shared vertex shader: passes the fullscreen-triangle position straight through. */
export const FULLSCREEN_VERT_SRC = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/** Build a VisualizerContext (shared quad, spectrum texture, fragment compiler) for a GL context. */
export function createVisualizerContext(gl: WebGL2RenderingContext): {
  ctx: VisualizerContext;
  quad: QuadGeometry;
  spectrumTex: WebGLTexture;
} {
  const quad = createFullscreenQuad(gl);
  const spectrumTex = createSpectrumTexture(gl);
  const ctx: VisualizerContext = {
    gl,
    quad,
    spectrumTex,
    compileFragment: (fragSrc: string) => compileProgram(gl, FULLSCREEN_VERT_SRC, fragSrc),
  };
  return { ctx, quad, spectrumTex };
}
