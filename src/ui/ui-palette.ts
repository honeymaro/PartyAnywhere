import type { RGB } from '../core/types';
import { rgbToHex } from '../color/color-utils';

/**
 * Readable text color (#111 or #fff) for text placed on a `primary`-colored fill.
 * Inputs are gamma-encoded sRGB (0..1), so BT.601 luma coefficients are intentional.
 */
export function uiTextOn(primary: RGB): string {
  const luma = 0.299 * primary[0] + 0.587 * primary[1] + 0.114 * primary[2];
  return luma > 0.6 ? '#111' : '#fff';
}

let lastPrimaryHex = '';
let lastAccentHex = '';

/**
 * Push the live palette into the CSS custom properties used by the control styling.
 * Called every frame while sharing — skips the DOM writes when the color is unchanged
 * (the palette eases smoothly, so most frames repeat the previous hex).
 */
export function applyUiPalette(el: HTMLElement, primary: RGB, accent: RGB): void {
  const primaryHex = rgbToHex(primary);
  const accentHex = rgbToHex(accent);
  if (primaryHex === lastPrimaryHex && accentHex === lastAccentHex) return;
  lastPrimaryHex = primaryHex;
  lastAccentHex = accentHex;
  el.style.setProperty('--ui-primary', primaryHex);
  el.style.setProperty('--ui-accent', accentHex);
  el.style.setProperty('--ui-on-primary', uiTextOn(primary));
}
