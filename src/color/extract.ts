import type { RGB, Palette } from '../core/types';
import { rgbToOklab } from './oklab';
import { deriveAccent } from './palette';

export interface ExtractOptions {
  stride?: number; // sample every Nth pixel for speed (default 4)
  bits?: number; // bits per channel for color binning (default 3 → 8 levels)
}

interface Bins {
  weightSum: Float64Array;
  rSum: Float64Array;
  gSum: Float64Array;
  bSum: Float64Array;
  binCount: number;
}

/** Build the saturation²·lightness-weighted color histogram (shared by both extractors). */
function binize(data: Uint8ClampedArray, opts: ExtractOptions): Bins {
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
  return { weightSum, rSum, gSum, bSum, binCount };
}

/** Brightness-normalized average color of a bin (lifts dark colors to a vivid value). */
function binColor(bins: Bins, i: number): RGB {
  const w = bins.weightSum[i];
  let r = bins.rSum[i] / w / 255;
  let g = bins.gSum[i] / w / 255;
  let b = bins.bSum[i] / w / 255;
  const maxc = Math.max(r, g, b);
  if (maxc > 0) {
    const boost = Math.max(1, 0.85 / maxc);
    r = Math.min(1, r * boost);
    g = Math.min(1, g * boost);
    b = Math.min(1, b * boost);
  }
  return [r, g, b];
}

function heaviestBin(bins: Bins): number {
  let best = -1;
  let bestWeight = 0;
  for (let i = 0; i < bins.binCount; i++) {
    if (bins.weightSum[i] > bestWeight) {
      bestWeight = bins.weightSum[i];
      best = i;
    }
  }
  return best;
}

/**
 * Find the dominant *saturated* color in an RGBA pixel buffer, brightness-normalized
 * so a dark source still yields a vivid primary. Returns null when none is saturated.
 */
export function extractDominantColor(data: Uint8ClampedArray, opts: ExtractOptions = {}): RGB | null {
  const bins = binize(data, opts);
  const best = heaviestBin(bins);
  return best < 0 ? null : binColor(bins, best);
}

const HUE_THRESHOLD = 0.7; // ~40° in OKLab hue — minimum separation for a distinct accent
const CHROMA_MIN = 0.04; // reject near-gray bins as the accent

/**
 * Extract a two-color palette: the dominant color (primary) plus the heaviest bin whose
 * OKLab hue differs enough and that isn't near-gray (accent). Falls back to a derived
 * accent when no distinct second color exists. Returns null when there's no primary.
 */
export function extractPalette(data: Uint8ClampedArray, opts: ExtractOptions = {}): Palette | null {
  const bins = binize(data, opts);
  const best = heaviestBin(bins);
  if (best < 0) return null;

  const primary = binColor(bins, best);
  const pLab = rgbToOklab(primary);
  const primaryHue = Math.atan2(pLab[2], pLab[1]);

  let accentColor: RGB | null = null;
  let accentWeight = 0;
  for (let i = 0; i < bins.binCount; i++) {
    if (i === best || bins.weightSum[i] <= accentWeight) continue;
    const color = binColor(bins, i);
    const lab = rgbToOklab(color);
    const chroma = Math.hypot(lab[1], lab[2]);
    if (chroma < CHROMA_MIN) continue;
    let dHue = Math.abs(Math.atan2(lab[2], lab[1]) - primaryHue);
    if (dHue > Math.PI) dHue = 2 * Math.PI - dHue;
    if (dHue < HUE_THRESHOLD) continue;
    accentWeight = bins.weightSum[i];
    accentColor = color;
  }

  const accent = accentColor ?? deriveAccent(primary);
  return { primary, accent };
}
