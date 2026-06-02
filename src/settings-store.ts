import type { ColorSourceId } from './color/color-service';

/** User settings persisted across reloads (excludes per-session things like the shared stream). */
export interface Settings {
  selectedIds?: string[];
  colorSource?: ColorSourceId;
  manualColor?: string; // hex, e.g. "#4f7cff"
  rotationIntervalSec?: number;
  rotationPaused?: boolean;
}

const KEY = 'music-visualizer:settings:v1';

/** Validate/normalize an unknown parsed value into Settings, dropping any malformed fields. */
export function parseSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return {};
  const o = raw as Record<string, unknown>;
  const out: Settings = {};

  if (Array.isArray(o.selectedIds) && o.selectedIds.every((x) => typeof x === 'string')) {
    out.selectedIds = o.selectedIds as string[];
  }
  if (o.colorSource === 'screen' || o.colorSource === 'image' || o.colorSource === 'manual') {
    out.colorSource = o.colorSource;
  }
  if (typeof o.manualColor === 'string' && /^#?[0-9a-fA-F]{6}$/.test(o.manualColor)) {
    out.manualColor = o.manualColor;
  }
  if (typeof o.rotationIntervalSec === 'number' && o.rotationIntervalSec >= 3 && o.rotationIntervalSec <= 600) {
    out.rotationIntervalSec = o.rotationIntervalSec;
  }
  if (typeof o.rotationPaused === 'boolean') {
    out.rotationPaused = o.rotationPaused;
  }
  return out;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    return parseSettings(JSON.parse(raw));
  } catch {
    return {}; // unavailable storage or corrupt JSON → fall back to defaults
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // localStorage unavailable (private mode / disabled) — ignore
  }
}
