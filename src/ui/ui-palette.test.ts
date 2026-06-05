import { describe, it, expect } from 'vitest';
import { uiTextOn } from './ui-palette';
import type { RGB } from '../core/types';

describe('uiTextOn', () => {
  it('returns dark text on light colors', () => {
    expect(uiTextOn([1, 1, 1] as RGB)).toBe('#111'); // white
    expect(uiTextOn([1, 1, 0] as RGB)).toBe('#111'); // yellow (high luma)
  });
  it('returns light text on dark / saturated colors', () => {
    expect(uiTextOn([0, 0, 0] as RGB)).toBe('#fff'); // black
    expect(uiTextOn([0, 0, 0.5] as RGB)).toBe('#fff'); // navy
    expect(uiTextOn([0.5, 0.5, 0.5] as RGB)).toBe('#fff'); // mid gray (luma 0.5 < 0.6)
  });
});
