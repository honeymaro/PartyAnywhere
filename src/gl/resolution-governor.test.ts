import { describe, it, expect } from 'vitest';
import { ResolutionGovernor } from './resolution-governor';

const run = (g: ResolutionGovernor, dt: number, seconds: number): void => {
  for (let t = 0; t < seconds; t += dt) g.update(dt);
};

describe('ResolutionGovernor', () => {
  it('starts from the pixel budget on a large screen', () => {
    const g = new ResolutionGovernor({ pixelBudget: 1920 * 1080 });
    g.setNativeSize(3840, 2160);
    expect(g.value).toBeCloseTo(0.5);
  });

  it('starts at full scale when the screen fits the budget', () => {
    const g = new ResolutionGovernor({ pixelBudget: 1920 * 1080 });
    g.setNativeSize(1280, 720);
    expect(g.value).toBe(1);
  });

  it('steps down when frames run well over the refresh interval', () => {
    const g = new ResolutionGovernor();
    g.setNativeSize(1920, 1080);
    g.begin('heavy');
    run(g, 1 / 60, 1); // learn the refresh interval
    run(g, 1 / 25, 2); // GPU-bound at 25 fps
    expect(g.value).toBeLessThan(1);
  });

  it('probes back up when there is sustained headroom', () => {
    const g = new ResolutionGovernor({ pixelBudget: 640 * 360 });
    g.setNativeSize(1920, 1080);
    g.begin('light');
    const start = g.value;
    run(g, 1 / 60, 6);
    expect(g.value).toBeGreaterThan(start);
  });

  it('never leaves the configured range', () => {
    const g = new ResolutionGovernor({ minScale: 0.4, maxScale: 1 });
    g.setNativeSize(3840, 2160);
    g.begin('x');
    run(g, 1 / 60, 1);
    run(g, 1 / 5, 20);
    expect(g.value).toBeGreaterThanOrEqual(0.4);
  });

  it('remembers the learned scale per visualizer id', () => {
    const g = new ResolutionGovernor();
    g.setNativeSize(1920, 1080);
    g.begin('heavy');
    run(g, 1 / 60, 1);
    run(g, 1 / 25, 2);
    const learned = g.value;
    g.begin('other');
    expect(g.value).toBe(1);
    g.begin('heavy');
    expect(g.value).toBe(learned);
  });

  it('does not re-probe a scale that stalled when the visualizer comes back', () => {
    const g = new ResolutionGovernor();
    g.setNativeSize(1920, 1080);
    const frame = (): number => (g.value > 0.9 ? 1 / 25 : 1 / 60); // keeps up only below 0.9
    const runFor = (seconds: number): number => {
      let peak = 0;
      for (let t = 0; t < seconds; ) {
        const dt = frame();
        g.update(dt);
        t += dt;
        peak = Math.max(peak, g.value);
      }
      return peak;
    };
    g.begin('heavy');
    runFor(5); // stalls once at 1.0, then settles below it
    g.begin('other');
    g.begin('heavy');
    const peak = runFor(15);
    expect(peak).toBeLessThanOrEqual(0.9); // never re-probes the scale that stalled
    expect(peak).toBeGreaterThan(0.6); // but still climbs to what it can sustain
  });

  it('backs off re-probing a scale that keeps stalling', () => {
    const g = new ResolutionGovernor();
    g.setNativeSize(1920, 1080);
    g.begin('heavy');
    // a GPU that only keeps up below 0.9: each probe back to 1.0 is a visible stall
    let stalls = 0;
    let wasSlow = false;
    for (let t = 0; t < 120; ) {
      const dt = g.value > 0.9 ? 1 / 25 : 1 / 60;
      const slow = dt > 1 / 30;
      if (slow && !wasSlow) stalls++;
      wasSlow = slow;
      g.update(dt);
      t += dt;
    }
    expect(stalls).toBeLessThanOrEqual(3); // 0 s, ~20 s, ~60 s (fixed 20 s waits would give 6)
  });

  it('ignores huge frame gaps (tab switches)', () => {
    const g = new ResolutionGovernor();
    g.setNativeSize(1920, 1080);
    g.begin('x');
    run(g, 1 / 60, 1);
    expect(g.update(2)).toBe(false);
    expect(g.value).toBe(1);
  });
});
