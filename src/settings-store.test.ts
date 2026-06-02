import { describe, it, expect } from 'vitest';
import { parseSettings } from './settings-store';

describe('parseSettings', () => {
  it('returns an empty object for non-objects', () => {
    expect(parseSettings(null)).toEqual({});
    expect(parseSettings('nope')).toEqual({});
    expect(parseSettings(42)).toEqual({});
  });

  it('keeps a fully valid settings object', () => {
    const s = {
      selectedIds: ['a', 'b'],
      colorSource: 'manual',
      manualColor: '#ff0080',
      rotationIntervalSec: 30,
      rotationPaused: true,
    };
    expect(parseSettings(s)).toEqual(s);
  });

  it('drops malformed fields', () => {
    const s = parseSettings({
      selectedIds: ['ok', 5], // contains a non-string → dropped
      colorSource: 'bogus', // not a valid id → dropped
      manualColor: 'red', // not hex → dropped
      rotationIntervalSec: 9000, // out of range → dropped
      rotationPaused: 'yes', // not boolean → dropped
    });
    expect(s).toEqual({});
  });

  it('validates the color-source enum and interval range', () => {
    expect(parseSettings({ colorSource: 'screen' })).toEqual({ colorSource: 'screen' });
    expect(parseSettings({ rotationIntervalSec: 2 })).toEqual({}); // below min
    expect(parseSettings({ rotationIntervalSec: 3 })).toEqual({ rotationIntervalSec: 3 });
    expect(parseSettings({ manualColor: '4f7cff' })).toEqual({ manualColor: '4f7cff' }); // hash optional
  });
});
