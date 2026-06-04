import { describe, it, expect } from 'vitest';
import { ManualColorSource } from './sources';
import type { Palette } from '../core/types';

// ManualColorSource is pure (no canvas/DOM), so it can be unit-tested directly.
const INIT: Palette = { primary: [1, 0, 0], accent: [0, 0, 1] };

describe('ManualColorSource', () => {
  it('sets the primary without touching the accent', () => {
    const s = new ManualColorSource(INIT);
    s.setPrimary([0, 1, 0]);
    expect(s.target()).toEqual({ primary: [0, 1, 0], accent: [0, 0, 1] });
  });

  it('sets the accent without touching the primary', () => {
    const s = new ManualColorSource(INIT);
    s.setAccent([1, 1, 0]);
    expect(s.target()).toEqual({ primary: [1, 0, 0], accent: [1, 1, 0] });
  });

  it('does not mutate the initial palette passed in', () => {
    const init: Palette = { primary: [1, 0, 0], accent: [0, 0, 1] };
    const s = new ManualColorSource(init);
    s.setPrimary([0, 1, 0]);
    s.setAccent([1, 1, 0]);
    expect(init).toEqual({ primary: [1, 0, 0], accent: [0, 0, 1] });
  });
});
