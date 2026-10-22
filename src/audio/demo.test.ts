import { describe, it, expect } from 'vitest';
import { demoAudioFrame } from './demo';
import { SPECTRUM_BINS } from './features';

describe('demoAudioFrame', () => {
  it('produces a SPECTRUM_BINS-wide spectrum with byte values', () => {
    const f = demoAudioFrame(1.0);
    expect(f.spectrum.length).toBe(SPECTRUM_BINS);
    for (const v of f.spectrum) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of f.spectrum) expect(v).toBeLessThanOrEqual(255);
  });

  it('keeps all scalar bands within 0..1', () => {
    for (const t of [0, 0.5, 1.3, 7.7]) {
      const f = demoAudioFrame(t);
      for (const v of [f.bass, f.mid, f.treble, f.level, f.beat]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('animates over time (not constant)', () => {
    expect(demoAudioFrame(0).level).not.toBe(demoAudioFrame(2).level);
  });
});
