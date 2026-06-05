import { describe, it, expect } from 'vitest';
import { hexToRgb, rgbToHex } from './color-utils';

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

describe('rgbToHex', () => {
  it('converts normalized rgb to hex', () => {
    expect(rgbToHex([1, 1, 1])).toBe('#ffffff');
    expect(rgbToHex([0, 0, 0])).toBe('#000000');
  });
  it('round-trips with hexToRgb', () => {
    expect(rgbToHex(hexToRgb('#4f7cff'))).toBe('#4f7cff');
    expect(rgbToHex(hexToRgb('#ff4fa3'))).toBe('#ff4fa3');
  });
});
