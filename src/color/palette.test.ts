import { describe, it, expect } from 'vitest';
import { rotateHue, derivePalette } from './palette';
import type { RGB } from '../core/types';

describe('rotateHue', () => {
  it('returns ~the same color when rotating by 0', () => {
    const c: RGB = [0.8, 0.2, 0.2];
    const r = rotateHue(c, 0);
    for (let i = 0; i < 3; i++) expect(Math.abs(r[i] - c[i])).toBeLessThan(0.02);
  });
});

describe('derivePalette', () => {
  it('keeps the primary and produces a different accent', () => {
    const primary: RGB = [0.8, 0.2, 0.2];
    const p = derivePalette(primary);
    expect(p.primary).toEqual(primary);
    const differs = p.accent.some((v, i) => Math.abs(v - primary[i]) > 0.05);
    expect(differs).toBe(true);
  });
});
