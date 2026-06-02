import { describe, it, expect } from 'vitest';
import { computeBands } from './bands';

describe('computeBands', () => {
  it('returns zeros for an empty spectrum', () => {
    expect(computeBands(new Uint8Array(0))).toEqual({ bass: 0, mid: 0, treble: 0, level: 0 });
  });

  it('normalizes a full-scale spectrum to ~1', () => {
    const spec = new Uint8Array(100).fill(255);
    const b = computeBands(spec);
    expect(b.bass).toBeCloseTo(1);
    expect(b.mid).toBeCloseTo(1);
    expect(b.treble).toBeCloseTo(1);
    expect(b.level).toBeCloseTo(1);
  });

  it('reports more bass when energy sits in low bins', () => {
    const spec = new Uint8Array(100).fill(0);
    for (let i = 0; i < 10; i++) spec[i] = 255;
    const b = computeBands(spec);
    expect(b.bass).toBeGreaterThan(b.treble);
  });
});
