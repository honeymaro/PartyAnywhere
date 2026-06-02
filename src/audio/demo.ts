import type { AudioFrame } from '../core/types';

const BINS = 64;

/** A deterministic, animated fake AudioFrame for driving gallery previews without live audio. */
export function demoAudioFrame(time: number): AudioFrame {
  const level = 0.4 + 0.3 * Math.sin(time * 1.3);
  const bass = 0.5 + 0.5 * Math.sin(time * 2.0);
  const mid = 0.4 + 0.4 * Math.sin(time * 1.7 + 1.0);
  const treble = 0.3 + 0.3 * Math.sin(time * 2.9 + 2.0);
  const beat = Math.max(0, Math.sin(time * 3.0));

  const spectrum = new Uint8Array(BINS);
  for (let i = 0; i < BINS; i++) {
    const f = i / BINS;
    const env = 1 - f; // more energy in low frequencies
    const v = (0.5 + 0.5 * Math.sin(time * 3.0 + f * 12.0)) * env * (0.4 + 0.6 * bass);
    spectrum[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  return { spectrum, bass, mid, treble, level, beat };
}
