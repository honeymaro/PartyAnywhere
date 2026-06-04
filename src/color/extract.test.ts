import { describe, it, expect } from 'vitest';
import { extractDominantColor, extractPalette } from './extract';

// Build an RGBA buffer of `count` pixels all set to (r,g,b,255).
function fill(count: number, r: number, g: number, b: number, a = 255): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(r, g, b, a);
  return out;
}

describe('extractDominantColor', () => {
  it('returns null for a fully gray image (no saturation)', () => {
    const data = new Uint8ClampedArray(fill(100, 128, 128, 128));
    expect(extractDominantColor(data, { stride: 1 })).toBeNull();
  });

  it('returns a reddish color when red dominates over gray', () => {
    const data = new Uint8ClampedArray([...fill(80, 220, 20, 20), ...fill(20, 128, 128, 128)]);
    const c = extractDominantColor(data, { stride: 1 })!;
    expect(c).not.toBeNull();
    expect(c[0]).toBeGreaterThan(c[1]);
    expect(c[0]).toBeGreaterThan(c[2]);
  });

  it('ignores transparent pixels', () => {
    const data = new Uint8ClampedArray([...fill(50, 220, 20, 20, 0), ...fill(50, 20, 20, 220, 255)]);
    const c = extractDominantColor(data, { stride: 1 })!;
    expect(c[2]).toBeGreaterThan(c[0]); // blue wins; red was transparent
  });

  it('returns null for an empty buffer', () => {
    expect(extractDominantColor(new Uint8ClampedArray(0))).toBeNull();
  });

  it('brightens a dark but saturated source into a vivid primary', () => {
    // A dark screen whose only color is a dark blue (0,0,60).
    const data = new Uint8ClampedArray(fill(100, 0, 0, 60));
    const c = extractDominantColor(data, { stride: 1 })!;
    expect(c).not.toBeNull();
    expect(c[2]).toBeGreaterThan(0.6); // lifted from ~0.24 to vivid
    expect(c[2]).toBeGreaterThan(c[0]);
    expect(c[2]).toBeGreaterThan(c[1]);
  });

  it('stride option still finds the dominant color', () => {
    // 200 pixels: 160 saturated blue + 40 gray
    const data = new Uint8ClampedArray([...fill(160, 20, 20, 220), ...fill(40, 128, 128, 128)]);
    const c = extractDominantColor(data, { stride: 4 })!;
    expect(c).not.toBeNull();
    expect(c[2]).toBeGreaterThan(c[0]); // blue channel is greatest
    expect(c[2]).toBeGreaterThan(c[1]);
  });
});

describe('extractPalette', () => {
  it('returns two distinct colors for a two-hue image', () => {
    // 60 red pixels (dominant) + 40 blue pixels.
    const data = new Uint8ClampedArray([...fill(60, 220, 20, 20), ...fill(40, 20, 20, 220)]);
    const pal = extractPalette(data, { stride: 1 })!;
    expect(pal).not.toBeNull();
    expect(pal.primary[0]).toBeGreaterThan(pal.primary[2]); // primary is reddish
    expect(pal.accent[2]).toBeGreaterThan(pal.accent[0]); // accent is bluish
  });

  it('falls back to a derived accent for a single-hue image', () => {
    const data = new Uint8ClampedArray(fill(100, 220, 20, 20));
    const pal = extractPalette(data, { stride: 1 })!;
    expect(pal).not.toBeNull();
    const maxDiff = Math.max(...pal.accent.map((v, i) => Math.abs(v - pal.primary[i])));
    expect(maxDiff).toBeGreaterThan(0.15); // accent is a distinct derived color
  });

  it('returns null for a fully gray image', () => {
    const data = new Uint8ClampedArray(fill(100, 128, 128, 128));
    expect(extractPalette(data, { stride: 1 })).toBeNull();
  });

  it('returns null for an empty buffer', () => {
    expect(extractPalette(new Uint8ClampedArray(0))).toBeNull();
  });
});
