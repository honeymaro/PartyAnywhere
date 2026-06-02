import type { RGB, Palette } from '../core/types';
import { rgbToOklab, oklabToRgb } from './oklab';

/** Rotate a color's hue by `radians` in the OKLab a/b plane (keeps lightness). */
export function rotateHue(rgb: RGB, radians: number): RGB {
  const [L, a, b] = rgbToOklab(rgb);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return oklabToRgb([L, a * cos - b * sin, a * sin + b * cos]);
}

/** Build a primary+accent palette from a single seed color (accent = hue-rotated). */
export function derivePalette(primary: RGB): Palette {
  return { primary, accent: rotateHue(primary, Math.PI * 0.7) };
}
