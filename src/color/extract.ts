import type { RGB } from '../core/types';

export interface ExtractOptions {
  stride?: number; // sample every Nth pixel for speed (default 4)
  bits?: number; // bits per channel for color binning (default 3 → 8 levels)
}

/**
 * Find the dominant *saturated* color in an RGBA pixel buffer.
 * Pixels are weighted by saturation² and a mid-lightness window, so near-black,
 * near-white, and gray UI chrome (e.g. Spotify's dark background) are down-weighted.
 * Pixels are binned by quantized color; the heaviest bin's weighted average is returned,
 * then brightness-normalized so a dark source still yields a vivid primary.
 * Returns null when no sufficiently saturated color exists.
 */
export function extractDominantColor(data: Uint8ClampedArray, opts: ExtractOptions = {}): RGB | null {
  const stride = opts.stride ?? 4;
  const bits = opts.bits ?? 3;
  const shift = 8 - bits;
  const levels = 1 << bits;
  const binCount = levels * levels * levels;

  const weightSum = new Float64Array(binCount);
  const rSum = new Float64Array(binCount);
  const gSum = new Float64Array(binCount);
  const bSum = new Float64Array(binCount);

  const step = stride * 4;
  for (let i = 0; i + 3 < data.length; i += step) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const alpha = data[i + 3];
    if (alpha < 128) continue;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 510; // 0..1
    const sat = max === 0 ? 0 : (max - min) / max; // 0..1
    // Lenient lightness window: still favors mid-tones but keeps dark, saturated colors
    // in play (a dark screen's only color is dark — don't penalize it away).
    const lightWindow = 1 - Math.abs(lightness - 0.5) * 2 * 0.45; // floor 0.55
    const weight = sat * sat * lightWindow;
    if (weight <= 0.0001) continue;

    const bin = ((r >> shift) * levels + (g >> shift)) * levels + (b >> shift);
    weightSum[bin] += weight;
    rSum[bin] += r * weight;
    gSum[bin] += g * weight;
    bSum[bin] += b * weight;
  }

  let best = -1;
  let bestWeight = 0;
  for (let i = 0; i < binCount; i++) {
    if (weightSum[i] > bestWeight) {
      bestWeight = weightSum[i];
      best = i;
    }
  }
  if (best < 0) return null;
  const w = weightSum[best];
  let r = rSum[best] / w / 255;
  let g = gSum[best] / w / 255;
  let b = bSum[best] / w / 255;

  // Normalize brightness so a dark-but-saturated source yields a vivid, usable primary.
  // Scale the value up toward a target (never down), preserving hue — the max channel
  // lands at ~0.85 and the others scale proportionally (no clamping/hue shift).
  const maxc = Math.max(r, g, b);
  if (maxc > 0) {
    const boost = Math.max(1, 0.85 / maxc);
    r = Math.min(1, r * boost);
    g = Math.min(1, g * boost);
    b = Math.min(1, b * boost);
  }
  return [r, g, b];
}
