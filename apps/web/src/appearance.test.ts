import { describe, expect, it } from 'vitest';
import { defaultAppearance, parseAppearance } from './appearance';

describe('appearance preferences', () => {
  it('uses defaults when no saved preferences exist', () => {
    expect(parseAppearance(null)).toEqual(defaultAppearance);
  });

  it('restores a complete valid preference set', () => {
    expect(
      parseAppearance(
        JSON.stringify({
          accent: 'violet',
          background: 'aurora',
          density: 'compact',
          bubbles: 'round',
        }),
      ),
    ).toEqual({
      accent: 'violet',
      background: 'aurora',
      density: 'compact',
      bubbles: 'round',
    });
  });

  it('falls back field-by-field for unsupported values', () => {
    expect(
      parseAppearance(
        JSON.stringify({
          accent: 'neon',
          background: 'sunset',
          density: 'tiny',
          bubbles: 'flat',
        }),
      ),
    ).toEqual({
      ...defaultAppearance,
      background: 'sunset',
      bubbles: 'flat',
    });
  });

  it('recovers from malformed storage data', () => {
    expect(parseAppearance('{not-json')).toEqual(defaultAppearance);
  });
});
