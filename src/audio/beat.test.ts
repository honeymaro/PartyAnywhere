import { describe, it, expect } from 'vitest';
import { OnsetDetector } from './beat';

const DT = 1 / 60;

describe('OnsetDetector', () => {
  it('fires a full pulse on a flux spike above the running baseline', () => {
    const d = new OnsetDetector();
    for (let i = 0; i < 60; i++) d.update(0.5, DT); // steady low flux baseline
    expect(d.update(12, DT)).toBe(1);
  });

  it('decays the pulse toward zero when flux stays flat', () => {
    const d = new OnsetDetector();
    for (let i = 0; i < 60; i++) d.update(0.5, DT);
    d.update(12, DT);
    let after = 0;
    for (let i = 0; i < 5; i++) after = d.update(0.5, DT); // past the short rise window
    expect(after).toBeLessThan(1);
    expect(after).toBeGreaterThan(0.5);
  });

  it('does not fire on the very first frame', () => {
    expect(new OnsetDetector().update(20, DT)).toBe(0);
  });

  it('ignores spikes below the absolute minimum flux', () => {
    const d = new OnsetDetector();
    for (let i = 0; i < 60; i++) d.update(0, DT);
    expect(d.update(0.5, DT)).toBe(0);
  });

  it('suppresses a second onset inside the refractory window', () => {
    const d = new OnsetDetector({ refractory: 0.2 });
    for (let i = 0; i < 60; i++) d.update(0.5, DT);
    d.update(12, DT);
    for (let i = 0; i < 5; i++) d.update(0.5, DT); // ~83 ms later, still inside 200 ms
    const second = d.update(12, DT);
    expect(second).toBeLessThan(1);
  });

  it('uses the given strength as the pulse height', () => {
    const d = new OnsetDetector();
    for (let i = 0; i < 60; i++) d.update(0.5, DT);
    expect(d.update(12, DT, 0.6)).toBeCloseTo(0.6);
  });

  it('lets a much stronger onset (a kick right after a hat) through the refractory window', () => {
    const d = new OnsetDetector({ refractory: 0.2 });
    for (let i = 0; i < 60; i++) d.update(0.5, DT);
    d.update(12, DT, 0.45); // weak onset (hat)
    for (let i = 0; i < 5; i++) d.update(0.5, DT, 0.45); // ~83 ms later, past the rise window
    expect(d.update(12, DT, 1)).toBe(1); // kick still fires
  });

  it('lets a strength that peaks just after the onset lift the pulse', () => {
    const d = new OnsetDetector();
    for (let i = 0; i < 60; i++) d.update(0.5, DT);
    d.update(12, DT, 0.6);
    expect(d.update(0.5, DT, 1)).toBe(1);
  });
});
