import { describe, it, expect } from 'vitest';
import { hexToRgb, lerpRgb } from './color-utils';

describe('hexToRgb', () => {
  it('converts white and black', () => {
    expect(hexToRgb('#ffffff')).toEqual([1, 1, 1]);
    expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
  });
  it('ignores a missing leading hash', () => {
    expect(hexToRgb('ff0000')).toEqual([1, 0, 0]);
  });
  it('parses #ff0000 correctly', () => {
    expect(hexToRgb('#ff0000')).toEqual([1, 0, 0]);
  });
  it('throws on a 3-digit hex', () => {
    expect(() => hexToRgb('#fff')).toThrow('Invalid hex color: #fff');
  });
  it('throws on a non-hex string', () => {
    expect(() => hexToRgb('nothex')).toThrow('Invalid hex color: nothex');
  });
});

describe('lerpRgb', () => {
  it('returns endpoints at t=0 and t=1', () => {
    expect(lerpRgb([0, 0, 0], [1, 1, 1], 0)).toEqual([0, 0, 0]);
    expect(lerpRgb([0, 0, 0], [1, 1, 1], 1)).toEqual([1, 1, 1]);
  });
  it('interpolates the midpoint', () => {
    expect(lerpRgb([0, 0, 0], [1, 1, 1], 0.5)).toEqual([0.5, 0.5, 0.5]);
  });
});
