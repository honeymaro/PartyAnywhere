import { describe, it, expect } from 'vitest';
import { pulseScale, bobOffset, OVERLAY_EFFECTS } from './overlay-effects';

describe('pulseScale', () => {
  it('is 1 at rest and grows with bass and beat', () => {
    expect(pulseScale(0, 0)).toBe(1);
    expect(pulseScale(1, 0)).toBeCloseTo(1.1);
    expect(pulseScale(0, 1)).toBeCloseTo(1.6);
    expect(pulseScale(1, 1)).toBeGreaterThan(pulseScale(0.5, 0.5));
  });
});

describe('bobOffset', () => {
  it('is 0 at t=0 with no beat, and pulled up (negative Y) by beat', () => {
    expect(bobOffset(0, 0)).toBeCloseTo(0);
    expect(bobOffset(0, 1)).toBeCloseTo(-14);
  });
  it('stays within the float amplitude when no beat', () => {
    for (const t of [0.3, 1.1, 2.7, 5.0]) {
      expect(Math.abs(bobOffset(t, 0))).toBeLessThanOrEqual(10.0001);
    }
  });
});

describe('OVERLAY_EFFECTS', () => {
  it('lists the four composable effects (no Static — none-checked is static)', () => {
    expect(OVERLAY_EFFECTS.map((e) => e.id)).toEqual(['pulse', 'glow', 'spin', 'bob']);
  });
  it('each factory builds an effect whose id matches its entry', () => {
    for (const e of OVERLAY_EFFECTS) expect(e.factory().id).toBe(e.id);
  });
});
