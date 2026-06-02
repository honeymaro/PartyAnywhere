import { describe, it, expect } from 'vitest';
import { rgbToOklab, oklabToRgb, lerpOklab } from './oklab';
import type { RGB } from '../core/types';

const close = (a: RGB, b: RGB, eps = 0.01) => {
  for (let i = 0; i < 3; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(eps);
};

describe('oklab round-trip', () => {
  it('round-trips primary colors within tolerance', () => {
    for (const c of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1], [0, 0, 0], [0.3, 0.6, 0.2]] as RGB[]) {
      close(oklabToRgb(rgbToOklab(c)), c);
    }
  });
});

describe('lerpOklab', () => {
  it('returns endpoints at t=0 and t=1', () => {
    close(lerpOklab([0, 0, 0], [1, 1, 1], 0), [0, 0, 0]);
    close(lerpOklab([0, 0, 0], [1, 1, 1], 1), [1, 1, 1]);
  });
  it('midpoint lies strictly between the endpoints', () => {
    const mid = lerpOklab([0, 0, 0], [1, 1, 1], 0.5);
    expect(mid[0]).toBeGreaterThan(0);
    expect(mid[0]).toBeLessThan(1);
  });
});
