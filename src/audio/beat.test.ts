import { describe, it, expect } from 'vitest';
import { BeatDetector } from './beat';

describe('BeatDetector', () => {
  it('fires a strong pulse on a sudden energy spike', () => {
    const d = new BeatDetector();
    for (let i = 0; i < 20; i++) d.update(0.2); // establish baseline
    const pulse = d.update(0.9); // spike
    expect(pulse).toBeGreaterThan(0.9);
  });

  it('decays the pulse toward zero when energy stays flat', () => {
    const d = new BeatDetector();
    for (let i = 0; i < 20; i++) d.update(0.2);
    d.update(0.9); // fire
    const after = d.update(0.2); // flat frame
    expect(after).toBeLessThan(1);
    expect(after).toBeGreaterThan(0);
  });

  it('does not fire on the very first frame', () => {
    const d = new BeatDetector();
    expect(d.update(0.9)).toBe(0);
  });
});
