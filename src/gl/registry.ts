import type { VisualizerFactory, Visualizer } from './visualizer';

export interface VisualizerInfo {
  id: string;
  name: string;
}

interface Entry extends VisualizerInfo {
  factory: VisualizerFactory;
}

/** Holds visualizer factories so they can be listed, added, and removed at runtime. */
export class VisualizerRegistry {
  private entries = new Map<string, Entry>();
  private order: string[] = [];

  register(info: VisualizerInfo, factory: VisualizerFactory): void {
    if (this.entries.has(info.id)) throw new Error(`Visualizer already registered: ${info.id}`);
    this.entries.set(info.id, { ...info, factory });
    this.order.push(info.id);
  }

  unregister(id: string): void {
    if (this.entries.delete(id)) {
      this.order = this.order.filter((x) => x !== id);
    }
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  list(): VisualizerInfo[] {
    return this.order.map((id) => {
      const e = this.entries.get(id)!;
      return { id: e.id, name: e.name };
    });
  }

  create(id: string): Visualizer {
    const e = this.entries.get(id);
    if (!e) throw new Error(`Unknown visualizer: ${id}`);
    return e.factory();
  }
}
