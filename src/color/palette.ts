import type { RGB } from '../core/types';
import { rgbToOklab, oklabToRgb } from './oklab';

/** Rotate a color's hue by `radians` in the OKLab a/b plane (keeps lightness). */
export function rotateHue(rgb: RGB, radians: number): RGB {
  const [L, a, b] = rgbToOklab(rgb);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return oklabToRgb([L, a * cos - b * sin, a * sin + b * cos]);
}

/** The default accent for a seed color: hue-rotated ~126° in OKLab. */
export function deriveAccent(primary: RGB): RGB {
  return rotateHue(primary, Math.PI * 0.7);
}

