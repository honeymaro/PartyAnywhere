import { describe, it, expect } from 'vitest';
import { ColorService } from './color-service';
import type { ColorSource } from './color-service';
import type { Palette } from '../core/types';

const RED: Palette = { primary: [1, 0, 0], accent: [0, 1, 0] };
const BLUE: Palette = { primary: [0, 0, 1], accent: [1, 1, 0] };

class FixedSource implements ColorSource {
  readonly id;
  private p: Palette | null;
  constructor(id: 'screen' | 'image' | 'manual', p: Palette | null) {
    this.id = id;
    this.p = p;
  }
  set(p: Palette | null) { this.p = p; }
  target(): Palette | null { return this.p; }
}

describe('ColorService', () => {
  it('interpolates the current palette toward the active source target', () => {
    const svc = new ColorService(RED, 'manual', 0.1);
    svc.addSource(new FixedSource('manual', BLUE));
    for (let i = 0; i < 200; i++) svc.update(0.1);
    const cur = svc.current();
    expect(Math.abs(cur.primary[2] - 1)).toBeLessThan(0.05); // approached blue
    expect(Math.abs(cur.primary[0])).toBeLessThan(0.05);
  });

  it('holds the current palette when the active source target is null', () => {
    const svc = new ColorService(RED, 'screen', 0.1);
    svc.addSource(new FixedSource('screen', null));
    svc.update(0.1);
    expect(svc.current().primary).toEqual([1, 0, 0]);
  });

  it('switches which source drives the palette via setActive', () => {
    const svc = new ColorService(RED, 'manual', 0.1);
    svc.addSource(new FixedSource('manual', RED));
    svc.addSource(new FixedSource('image', BLUE));
    svc.setActive('image');
    for (let i = 0; i < 200; i++) svc.update(0.1);
    expect(Math.abs(svc.current().primary[2] - 1)).toBeLessThan(0.05);
  });
});
