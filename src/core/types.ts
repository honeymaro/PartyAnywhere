/** sRGB-encoded RGB, each channel 0..1. */
export type RGB = [number, number, number];

/**
 * One frame of analyzed audio, all scalar fields normalized 0..1 and auto-gained (see
 * audio/features.ts): 0 in silence, and loud and quiet tabs read alike.
 */
export interface AudioFrame {
  // log-spaced bins, 30 Hz (index 0) .. 16 kHz, auto-gained to 0..255; uploaded to GL as a
  // data texture, so shaders sample it with x in 0..1
  spectrum: Uint8Array;
  bass: number; // 25-160 Hz: a steady bed sits ~0.3-0.5, each kick snaps toward 1
  mid: number; // 160-2500 Hz
  treble: number; // 2.5-12 kHz
  level: number; // overall loudness, slow-moving
  beat: number; // onset pulse: ~1 on a kick, lower on other onsets, decays in ~0.2 s
}

/** Current colors fed to the visualizer (already interpolated). */
export interface Palette {
  primary: RGB;
  accent: RGB;
}

/** Everything a visualizer receives each frame (read-only). */
export interface RenderFrame {
  time: number; // seconds since loop start
  dt: number; // seconds since previous frame
  resolution: [number, number]; // drawing-buffer pixels
  audio: AudioFrame;
  palette: Palette;
}
