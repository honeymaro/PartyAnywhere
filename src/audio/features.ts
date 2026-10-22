import type { AudioFrame } from '../core/types';
import { OnsetDetector } from './beat';

/** Number of log-spaced bins in the spectrum handed to visualizers (uploaded as the spectrum texture). */
export const SPECTRUM_BINS = 128;
const SPEC_MIN_HZ = 30;
const SPEC_MAX_HZ = 16000;
const SILENT_DB = -160;

/** Perceptual band edges in Hz. Bass covers kick + sub, treble covers hats/cymbals. */
const BASS_HZ: [number, number] = [25, 160];
const MID_HZ: [number, number] = [160, 2500];
const TREBLE_HZ: [number, number] = [2500, 12000];
const KICK_HZ: [number, number] = [35, 140];
const SNARE_HZ: [number, number] = [160, 3000];

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Automatic gain control in the dB domain. Tracks a slowly falling recent peak and maps the
 * `range` dB below it onto 0..1, so the output uses the full range at any playback volume
 * (a quiet tab and a loud tab both reach ~1 on their own peaks). The peak never drops below
 * `floor`, which keeps near-silence (noise floor) mapped to 0 instead of being amplified.
 */
export class DbAgc {
  private peak: number;
  private readonly range: number;
  private readonly floor: number;
  private readonly fall: number;

  /** @param fall dB per second the remembered peak relaxes */
  constructor(range: number, floor: number, fall: number) {
    this.range = range;
    this.floor = floor;
    this.fall = fall;
    this.peak = floor;
  }

  /** Feed one observation into the peak tracker. */
  track(db: number, dt: number): void {
    if (db > this.peak) this.peak = db;
    else this.peak = Math.max(this.floor, this.peak - this.fall * dt);
  }

  /** Map a dB value onto 0..1 relative to the tracked peak (does not update the peak). */
  map(db: number): number {
    return clamp01((db - (this.peak - this.range)) / this.range);
  }

  normalize(db: number, dt: number): number {
    this.track(db, dt);
    return this.map(db);
  }

  get peakDb(): number {
    return this.peak;
  }
}

export interface BandMeterOptions {
  floor: number; // dB; the remembered peak never drops below this (silence stays at 0)
  range: number; // dB below the recent peak that maps to 0 loudness
  gamma: number; // >1 pushes the steady bed down so hits stand out
  punchDb: number; // dB above the running bed that counts as a full hit
  punchMix: number; // 0..1 weight of the hit (transient) term vs the loudness term
}

/**
 * Normalizes one band's dB level to 0..1 as a blend of two cues:
 *  - loudness relative to the recent peak (quiet passages read low, the loudest moments ~1)
 *  - punch: how far the band jumps above its own running bed (kicks/snares spike, pads don't)
 * so a steady loud pad reads moderate while every hit reaches near 1.
 */
export class BandMeter {
  private readonly agc: DbAgc;
  private readonly o: BandMeterOptions;
  private bed: number;

  constructor(o: BandMeterOptions) {
    this.o = o;
    this.agc = new DbAgc(o.range, o.floor, 2);
    this.bed = o.floor - o.range;
  }

  update(db: number, dt: number): number {
    const loud = Math.pow(this.agc.normalize(db, dt), this.o.gamma);
    const punch = clamp01((db - this.bed) / this.o.punchDb);
    this.bed += (Math.max(db, this.o.floor - this.o.range) - this.bed) * (1 - Math.exp(-dt / 0.4));
    return clamp01(loud * (1 - this.o.punchMix) + punch * loud * this.o.punchMix * 1.5);
  }

  /** The tracked recent peak in dB (used to gate onset flux to bins that are actually audible). */
  get peakDb(): number {
    return this.agc.peakDb;
  }
}

/** Fast-attack / slow-release follower so values snap up on hits and glide down (no flicker). */
function follow(prev: number, target: number, dt: number, attack: number, release: number): number {
  const tau = target > prev ? attack : release;
  return prev + (target - prev) * (1 - Math.exp(-dt / tau));
}

interface BinRange {
  lo: number;
  hi: number; // exclusive
}

function binRange(hz: [number, number], binHz: number, binCount: number): BinRange {
  const lo = Math.min(binCount - 1, Math.max(1, Math.round(hz[0] / binHz)));
  const hi = Math.min(binCount, Math.max(lo + 1, Math.round(hz[1] / binHz)));
  return { lo, hi };
}

const finiteDb = (v: number): number => (Number.isFinite(v) ? v : SILENT_DB);

/** Power-average of a dB bin range, returned in dB. */
function bandDb(db: Float32Array, r: BinRange): number {
  let sum = 0;
  for (let k = r.lo; k < r.hi; k++) sum += Math.pow(10, finiteDb(db[k]) / 10);
  const mean = sum / (r.hi - r.lo);
  return mean > 0 ? 10 * Math.log10(mean) : SILENT_DB;
}

/**
 * Turns a raw FFT frame (dB per linear bin, as from AnalyserNode.getFloatFrequencyData) into the
 * normalized AudioFrame visualizers consume:
 *  - bass/mid/treble/level: perceptual bands, auto-gained, shaped so hits stand out from the bed
 *  - beat: onset pulse driven mainly by kick-band spectral flux (snare flux helps sparse mixes)
 *  - spectrum: SPECTRUM_BINS log-spaced bins (30 Hz..16 kHz), tilt-compensated and auto-gained
 */
export class AudioFeatureExtractor {
  private readonly bass: BinRange;
  private readonly mid: BinRange;
  private readonly treble: BinRange;
  private readonly full: BinRange;
  private readonly kick: BinRange;
  private readonly snare: BinRange;
  private readonly specLo = new Float32Array(SPECTRUM_BINS);
  private readonly specHi = new Float32Array(SPECTRUM_BINS);
  private readonly specTilt = new Float32Array(SPECTRUM_BINS);
  private readonly specDb = new Float32Array(SPECTRUM_BINS);
  private readonly specSmooth = new Float32Array(SPECTRUM_BINS);
  private readonly spectrum = new Uint8Array(SPECTRUM_BINS);
  private readonly prevDb: Float32Array;
  private readonly meterBass = new BandMeter({ floor: -55, range: 24, gamma: 2, punchDb: 6, punchMix: 0.5 });
  private readonly meterMid = new BandMeter({ floor: -60, range: 24, gamma: 1.5, punchDb: 6, punchMix: 0.4 });
  private readonly meterTreble = new BandMeter({ floor: -70, range: 24, gamma: 1.5, punchDb: 6, punchMix: 0.4 });
  private readonly meterLevel = new BandMeter({ floor: -55, range: 24, gamma: 1.5, punchDb: 6, punchMix: 0.25 });
  private readonly agcSpec = new DbAgc(42, -45, 4);
  private readonly onset = new OnsetDetector();
  private sBass = 0;
  private sMid = 0;
  private sTreble = 0;
  private sLevel = 0;
  private prevBass = 0;

  constructor(sampleRate: number, fftSize: number) {
    const binCount = fftSize / 2;
    const binHz = sampleRate / fftSize;
    this.prevDb = new Float32Array(binCount).fill(SILENT_DB);
    this.bass = binRange(BASS_HZ, binHz, binCount);
    this.mid = binRange(MID_HZ, binHz, binCount);
    this.treble = binRange(TREBLE_HZ, binHz, binCount);
    this.full = binRange([BASS_HZ[0], TREBLE_HZ[1]], binHz, binCount);
    this.kick = binRange(KICK_HZ, binHz, binCount);
    this.snare = binRange(SNARE_HZ, binHz, binCount);
    const ratio = SPEC_MAX_HZ / SPEC_MIN_HZ;
    for (let i = 0; i < SPECTRUM_BINS; i++) {
      const f0 = SPEC_MIN_HZ * Math.pow(ratio, i / SPECTRUM_BINS);
      const f1 = SPEC_MIN_HZ * Math.pow(ratio, (i + 1) / SPECTRUM_BINS);
      // fractional FFT-bin span; narrow low bins interpolate between neighbouring FFT bins
      this.specLo[i] = Math.min(binCount - 1, f0 / binHz);
      this.specHi[i] = Math.min(binCount - 1, f1 / binHz);
      // +3 dB/octave around 1 kHz so a typical (pink-ish) mix reads roughly flat across the bars
      this.specTilt[i] = 3 * Math.log2(Math.sqrt(f0 * f1) / 1000);
    }
  }

  update(db: Float32Array, dt: number): AudioFrame {
    const step = Math.min(Math.max(dt, 1 / 240), 0.1);

    // --- bands: loudness vs recent peak blended with punch vs the running bed ---
    const bass = this.meterBass.update(bandDb(db, this.bass), step);
    const mid = this.meterMid.update(bandDb(db, this.mid), step);
    const treble = this.meterTreble.update(bandDb(db, this.treble), step);
    const level = this.meterLevel.update(bandDb(db, this.full), step);
    this.sBass = follow(this.sBass, bass, step, 0.012, 0.14);
    this.sMid = follow(this.sMid, mid, step, 0.02, 0.16);
    this.sTreble = follow(this.sTreble, treble, step, 0.012, 0.1);
    this.sLevel = follow(this.sLevel, level, step, 0.03, 0.25);

    // --- onset: rectified spectral flux (kick band dominant, snare band as a helper). Bins more
    // than 30 dB under the band's recent peak are ignored so noise-floor wiggle never triggers.
    const kickFlux = this.flux(db, this.kick, this.meterBass.peakDb - 30);
    const snareFlux = 0.35 * this.flux(db, this.snare, this.meterMid.peakDb - 30);
    // a kick also shows up as a sharp jump of the bass meter itself, which stays reliable when a
    // sustained bassline keeps the kick band busy (and its per-bin flux small)
    const bassJump = Math.max(0, bass - this.prevBass) * 10;
    this.prevBass = bass;
    const flux = kickFlux + snareFlux + bassJump;
    // the pulse height follows the (unsmoothed) bass punch, so a kick reaches ~1 while a snare
    // or an arpeggio note over a quiet low end pulses at roughly 0.5-0.7
    const beat = this.onset.update(flux, step, 0.45 + 0.55 * bass);
    for (let k = 0; k < this.prevDb.length; k++) this.prevDb[k] = finiteDb(db[k]);

    // --- log spectrum: one shared gain (driven by the loudest bar) keeps the spectral shape ---
    let maxDb = SILENT_DB;
    for (let i = 0; i < SPECTRUM_BINS; i++) {
      const v = this.specBinDb(db, this.specLo[i], this.specHi[i]) + this.specTilt[i];
      this.specDb[i] = v;
      if (v > maxDb) maxDb = v;
    }
    this.agcSpec.track(maxDb, step);
    for (let i = 0; i < SPECTRUM_BINS; i++) {
      this.specSmooth[i] = follow(this.specSmooth[i], this.agcSpec.map(this.specDb[i]), step, 0.01, 0.12);
      this.spectrum[i] = Math.round(this.specSmooth[i] * 255);
    }

    return {
      spectrum: this.spectrum,
      bass: this.sBass,
      mid: this.sMid,
      treble: this.sTreble,
      level: this.sLevel,
      beat,
    };
  }

  private flux(db: Float32Array, r: BinRange, gateDb: number): number {
    let sum = 0;
    for (let k = r.lo; k < r.hi; k++) {
      const cur = finiteDb(db[k]);
      const d = cur - Math.max(this.prevDb[k], gateDb);
      if (d > 0) sum += d;
    }
    return sum / (r.hi - r.lo);
  }

  /** Max dB over a fractional FFT-bin span (linear interpolation when the span is < 1 bin). */
  private specBinDb(db: Float32Array, lo: number, hi: number): number {
    const k0 = Math.floor(lo);
    const k1 = Math.floor(hi);
    if (k1 <= k0) {
      const f = (lo + hi) * 0.5 - k0;
      const a = finiteDb(db[k0]);
      const b = finiteDb(db[Math.min(k0 + 1, db.length - 1)]);
      return a + (b - a) * f;
    }
    let m = SILENT_DB;
    for (let k = k0; k <= k1; k++) m = Math.max(m, finiteDb(db[k]));
    return m;
  }
}
