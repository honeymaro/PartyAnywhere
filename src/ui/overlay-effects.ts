import type { Palette, RGB } from '../core/types';

/** Per-frame input handed to each active overlay effect. */
export interface OverlayFrame {
  time: number; // accumulated seconds the overlay has been animating
  dt: number;
  level: number;
  treble: number;
  sBass: number; // smoothed bass 0..1
  beatPop: number; // smoothed kick pop 0..1
  palette: Palette;
}

/**
 * A transform/filter contribution. Effects return fragments instead of writing styles
 * directly so multiple effects can be composed (e.g. Spin + Pulse): the overlay joins
 * all active `transform` fragments and all `filter` fragments into one of each.
 */
export interface OverlayStyle {
  transform?: string;
  filter?: string;
}

export interface OverlayEffect {
  readonly id: string;
  readonly name: string;
  apply(frame: OverlayFrame): OverlayStyle;
  reset(): void; // clears any internal animation state (e.g. spin angle)
}

export type OverlayEffectFactory = () => OverlayEffect;

// --- pure helpers (unit-tested) ---

/** Scale for the Pulse effect: 1 at rest, gentle bass breathing + a big snappy kick pop. */
export function pulseScale(sBass: number, beatPop: number): number {
  return 1 + sBass * 0.1 + beatPop * 0.6;
}

/** Vertical offset (px) for the Bob effect: gentle float minus a beat-driven hop. */
export function bobOffset(time: number, beatPop: number): number {
  return Math.sin(time * 1.6) * 10 - beatPop * 14;
}

function rgbCss(c: RGB): string {
  const ch = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${ch(c[0])}, ${ch(c[1])}, ${ch(c[2])})`;
}

function createPulse(): OverlayEffect {
  return {
    id: 'pulse',
    name: 'Pulse',
    apply({ sBass, beatPop }: OverlayFrame) {
      return { transform: `scale(${pulseScale(sBass, beatPop)})` };
    },
    reset() {},
  };
}

function createGlow(): OverlayEffect {
  return {
    id: 'glow',
    name: 'Glow',
    apply({ sBass, beatPop, palette }: OverlayFrame) {
      const c = rgbCss(palette.primary);
      const wide = 16 + beatPop * 100 + sBass * 20; // outer halo punches hard on a kick
      const tight = 6 + beatPop * 40; // inner core glow
      return {
        filter: `drop-shadow(0 0 ${wide}px ${c}) drop-shadow(0 0 ${tight}px ${c}) brightness(${1 + beatPop * 1.0}) saturate(${1 + beatPop * 0.6})`,
      };
    },
    reset() {},
  };
}

function createSpin(): OverlayEffect {
  let angle = 0;
  return {
    id: 'spin',
    name: 'Spin',
    apply({ dt, level }: OverlayFrame) {
      angle += dt * (12 + level * 40);
      return { transform: `rotate(${angle}deg)` };
    },
    reset() {
      angle = 0;
    },
  };
}

function createBob(): OverlayEffect {
  return {
    id: 'bob',
    name: 'Bob',
    apply({ time, beatPop }: OverlayFrame) {
      return { transform: `translateY(${bobOffset(time, beatPop)}px)` };
    },
    reset() {},
  };
}

/** Composable effects, in the fixed order they are applied (transforms multiply left→right). */
export const OVERLAY_EFFECTS: { id: string; name: string; factory: OverlayEffectFactory }[] = [
  { id: 'pulse', name: 'Pulse', factory: createPulse },
  { id: 'glow', name: 'Glow', factory: createGlow },
  { id: 'spin', name: 'Spin', factory: createSpin },
  { id: 'bob', name: 'Bob', factory: createBob },
];
