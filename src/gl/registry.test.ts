import { describe, it, expect } from 'vitest';
import { VisualizerRegistry } from './registry';
import type { Visualizer } from './visualizer';

const fakeFactory = (): Visualizer => ({
  id: 'x',
  name: 'X',
  init() {},
  resize() {},
  render() {},
  dispose() {},
});

describe('VisualizerRegistry', () => {
  it('lists registered visualizers in registration order', () => {
    const r = new VisualizerRegistry();
    r.register({ id: 'a', name: 'A' }, fakeFactory);
    r.register({ id: 'b', name: 'B' }, fakeFactory);
    expect(r.list()).toEqual([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]);
  });

  it('throws on a duplicate id', () => {
    const r = new VisualizerRegistry();
    r.register({ id: 'a', name: 'A' }, fakeFactory);
    expect(() => r.register({ id: 'a', name: 'A2' }, fakeFactory)).toThrow();
  });

  it('removes a visualizer on unregister', () => {
    const r = new VisualizerRegistry();
    r.register({ id: 'a', name: 'A' }, fakeFactory);
    r.unregister('a');
    expect(r.has('a')).toBe(false);
    expect(r.list()).toEqual([]);
  });

  it('throws when creating an unknown id', () => {
    const r = new VisualizerRegistry();
    expect(() => r.create('nope')).toThrow();
  });
});
