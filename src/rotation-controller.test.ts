import { describe, it, expect } from 'vitest';
import { RotationController } from './rotation-controller';

function track(rc: RotationController): string[] {
  const seen: string[] = [];
  rc.onChange((id) => seen.push(id));
  return seen;
}

describe('RotationController', () => {
  it('emits the first item when a pool is set', () => {
    const rc = new RotationController({ intervalSec: 10 });
    const seen = track(rc);
    rc.setPool(['a', 'b', 'c']);
    expect(rc.current()).toBe('a');
    expect(seen).toEqual(['a']);
  });

  it('auto-advances after the interval elapses', () => {
    const rc = new RotationController({ intervalSec: 10 });
    const seen = track(rc);
    rc.setPool(['a', 'b', 'c']);
    rc.update(10);
    expect(rc.current()).toBe('b');
    expect(seen).toEqual(['a', 'b']);
  });

  it('does not advance while paused or with a single-item pool', () => {
    const rc = new RotationController({ intervalSec: 10 });
    rc.setPool(['a', 'b']);
    rc.setPaused(true);
    rc.update(100);
    expect(rc.current()).toBe('a');

    const solo = new RotationController({ intervalSec: 10 });
    solo.setPool(['only']);
    solo.update(100);
    expect(solo.current()).toBe('only');
  });

  it('next/prev advance and wrap, resetting the timer', () => {
    const rc = new RotationController({ intervalSec: 10 });
    rc.setPool(['a', 'b', 'c']);
    rc.prev();
    expect(rc.current()).toBe('c'); // wraps backward
    rc.next();
    expect(rc.current()).toBe('a'); // wraps forward
  });

  it('keeps the current item when setPool still contains it', () => {
    const rc = new RotationController({ intervalSec: 10 });
    const seen = track(rc);
    rc.setPool(['a', 'b', 'c']);
    rc.next(); // now 'b'
    rc.setPool(['a', 'b']); // 'b' still present
    expect(rc.current()).toBe('b');
    expect(seen).toEqual(['a', 'b']); // no spurious re-emit
  });

  it('resets to the first item when setPool drops the current item', () => {
    const rc = new RotationController({ intervalSec: 10 });
    rc.setPool(['a', 'b', 'c']);
    rc.next(); // 'b'
    const seen = track(rc);
    rc.setPool(['a', 'c']); // 'b' gone
    expect(rc.current()).toBe('a');
    expect(seen).toEqual(['a']);
  });
});
