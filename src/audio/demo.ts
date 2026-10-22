import type { AudioFrame } from '../core/types';
import { SPECTRUM_BINS } from './features';

const BPM = 120;

/**
 * A deterministic, animated fake AudioFrame for driving gallery previews without live audio.
 * Mimics what the live analyser produces: a kick pulse every beat (beat + bass spike and decay),
 * a breathing mid/treble bed, and a log-spaced spectrum that thumps in the lows.
 */
export function demoAudioFrame(time: number): AudioFrame {
  const beatLen = 60 / BPM;
  const sinceBeat = time % beatLen;
  const beat = Math.exp(-sinceBeat / 0.16);
  const bass = Math.min(1, 0.25 + 0.75 * Math.exp(-sinceBeat / 0.14));
  const mid = 0.45 + 0.25 * Math.sin(time * 1.7 + 1.0);
  const treble = 0.35 + 0.25 * Math.sin(time * 5.3 + 2.0) * Math.sin(time * 0.9);
  const level = 0.55 + 0.2 * Math.sin(time * 0.6) + 0.15 * beat;

  const spectrum = new Uint8Array(SPECTRUM_BINS);
  for (let i = 0; i < SPECTRUM_BINS; i++) {
    const f = i / SPECTRUM_BINS;
    const kick = bass * Math.exp(-f * 9.0); // low bins thump with the kick
    const body = 0.55 + 0.25 * Math.sin(time * 2.3 + f * 14.0);
    const v = Math.max(kick, body * (0.9 - 0.45 * f) * (0.7 + 0.3 * mid));
    spectrum[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  return { spectrum, bass, mid, treble, level: Math.min(1, level), beat };
}
