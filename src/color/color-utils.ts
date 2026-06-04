import type { RGB, Palette } from '../core/types';

export function hexToRgb(hex: string): RGB {
  const h = hex.replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`Invalid hex color: ${hex}`);
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

export function rgbToHex(c: RGB): string {
  const ch = (v: number): string =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${ch(c[0])}${ch(c[1])}${ch(c[2])}`;
}

// used by Plan 2 color interpolation
export function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export const DEFAULT_PALETTE: Palette = {
  primary: hexToRgb('#4f7cff'),
  accent: hexToRgb('#ff4fa3'),
};
