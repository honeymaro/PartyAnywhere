/** sRGB-encoded RGB, each channel 0..1. */
export type RGB = [number, number, number];

/** One frame of analyzed audio, all scalar fields normalized 0..1. */
export interface AudioFrame {
  spectrum: Uint8Array; // raw frequency magnitudes 0..255 (uploaded to GL as a data texture)
  bass: number;
  mid: number;
  treble: number;
  level: number; // overall energy (RMS-ish average)
  beat: number; // onset pulse 0..1, spikes on a beat
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
