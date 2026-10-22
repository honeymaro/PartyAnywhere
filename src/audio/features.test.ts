import { describe, it, expect } from 'vitest';
import { AudioFeatureExtractor, DbAgc, SPECTRUM_BINS } from './features';

const SR = 48000;
const FFT = 2048;
const BINS = FFT / 2;
const DT = 1 / 60;

/** A dB frame with a flat floor and a raised region [loHz, hiHz). */
function frame(floorDb: number, loHz = 0, hiHz = 0, peakDb = floorDb): Float32Array {
  const f = new Float32Array(BINS).fill(floorDb);
  const binHz = SR / FFT;
  for (let k = 0; k < BINS; k++) if (k * binHz >= loHz && k * binHz < hiHz) f[k] = peakDb;
  return f;
}

describe('DbAgc', () => {
  it('maps the tracked peak to 1 and range-below-peak to 0', () => {
    const agc = new DbAgc(30, -60, 2);
    expect(agc.normalize(-20, DT)).toBe(1);
    expect(agc.map(-50)).toBe(0);
    expect(agc.map(-35)).toBeCloseTo(0.5);
  });

  it('never lets the peak fall below the floor', () => {
    const agc = new DbAgc(30, -60, 100);
    for (let i = 0; i < 600; i++) agc.track(-140, DT);
    expect(agc.peakDb).toBe(-60);
    expect(agc.map(-140)).toBe(0);
  });
});

describe('AudioFeatureExtractor', () => {
  it('reports silence as all zeros', () => {
    const fx = new AudioFeatureExtractor(SR, FFT);
    let f = fx.update(new Float32Array(BINS).fill(-Infinity), DT);
    for (let i = 0; i < 30; i++) f = fx.update(new Float32Array(BINS).fill(-Infinity), DT);
    expect([f.bass, f.mid, f.treble, f.level, f.beat]).toEqual([0, 0, 0, 0, 0]);
    expect(f.spectrum.length).toBe(SPECTRUM_BINS);
    expect(Math.max(...f.spectrum)).toBe(0);
  });

  it('reads more bass than treble for low-frequency energy', () => {
    const fx = new AudioFeatureExtractor(SR, FFT);
    let f = fx.update(frame(-110), DT);
    for (let i = 0; i < 30; i++) f = fx.update(frame(-110, 30, 150, -20), DT);
    expect(f.bass).toBeGreaterThan(0.5);
    expect(f.treble).toBe(0);
  });

  it('fires a beat on a kick-band hit after a quiet bed', () => {
    const fx = new AudioFeatureExtractor(SR, FFT);
    for (let i = 0; i < 90; i++) fx.update(frame(-110, 30, 150, -40), DT);
    const hit = fx.update(frame(-110, 30, 150, -15), DT);
    expect(hit.beat).toBeGreaterThan(0.9);
  });

  it('keeps every value within 0..1 (spectrum within 0..255)', () => {
    const fx = new AudioFeatureExtractor(SR, FFT);
    for (let i = 0; i < 120; i++) {
      const f = fx.update(frame(-90 + (i % 7) * 10, 20, 16000, -5 - (i % 5) * 8), DT);
      for (const v of [f.bass, f.mid, f.treble, f.level, f.beat]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      for (const v of f.spectrum) expect(v).toBeLessThanOrEqual(255);
    }
  });

  it('auto-gains: a quieter copy of the same signal reads about the same', () => {
    const run = (offset: number) => {
      const fx = new AudioFeatureExtractor(SR, FFT);
      let f = fx.update(frame(-120), DT);
      for (let i = 0; i < 240; i++) {
        const hit = i % 30 === 0 ? 0 : -8;
        f = fx.update(frame(-120, 30, 4000, -20 + hit + offset), DT);
      }
      return f;
    };
    const loud = run(0);
    const quiet = run(-12);
    expect(Math.abs(loud.bass - quiet.bass)).toBeLessThan(0.05);
    expect(Math.abs(loud.mid - quiet.mid)).toBeLessThan(0.05);
  });
});
