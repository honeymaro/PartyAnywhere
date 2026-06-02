export interface Bands {
  bass: number;
  mid: number;
  treble: number;
  level: number;
}

/**
 * Reduce a raw frequency spectrum (0..255 magnitudes) to normalized band energies.
 * Bands are split by index fraction: bass = lowest 10%, mid = next 30%, treble = rest.
 * The 10%/40%/60% index split is an approximation of bass/mid/treble at the default
 * 44.1 kHz sample rate (e.g. with a 1024-point FFT, each bin is ~43 Hz wide).
 */
export function computeBands(spectrum: Uint8Array): Bands {
  const n = spectrum.length;
  if (n === 0) return { bass: 0, mid: 0, treble: 0, level: 0 };

  const bassEnd = Math.floor(n * 0.1);
  const midEnd = Math.floor(n * 0.4);

  const avg = (start: number, end: number): number => {
    const count = end - start;
    if (count <= 0) return 0;
    let sum = 0;
    for (let i = start; i < end; i++) sum += spectrum[i];
    return sum / count / 255;
  };

  return {
    bass: avg(0, bassEnd),
    mid: avg(bassEnd, midEnd),
    treble: avg(midEnd, n),
    level: avg(0, n),
  };
}
