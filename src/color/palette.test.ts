import { describe, it, expect } from 'vitest';
import { rotateHue, deriveAccent } from './palette';
import type { RGB } from '../core/types';

describe('rotateHue', () => {
  it('returns ~the same color when rotating by 0', () => {
    const c: RGB = [0.8, 0.2, 0.2];
    const r = rotateHue(c, 0);
    for (let i = 0; i < 3; i++) expect(Math.abs(r[i] - c[i])).toBeLessThan(0.02);
  });
});

describe('deriveAccent', () => {
  it('returns a hue-rotated color distinct from the primary', () => {
    const primary: RGB = [0.8, 0.2, 0.2];
    const accent = deriveAccent(primary);
    const differs = accent.some((v, i) => Math.abs(v - primary[i]) > 0.05);
    expect(differs).toBe(true);
  });
});
