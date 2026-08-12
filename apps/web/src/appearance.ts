export type AccentColor = 'blue' | 'violet' | 'rose' | 'tangerine' | 'sage';
export type BackgroundTemplate = 'atmosphere' | 'aurora' | 'sunset' | 'cloud' | 'linen';
export type ConversationDensity = 'comfortable' | 'compact';
export type BubbleStyle = 'soft' | 'round' | 'flat';

export type AppearanceSettings = {
  accent: AccentColor;
  background: BackgroundTemplate;
  density: ConversationDensity;
  bubbles: BubbleStyle;
};

export const defaultAppearance: AppearanceSettings = {
  accent: 'blue',
  background: 'atmosphere',
  density: 'comfortable',
  bubbles: 'soft',
};

export function parseAppearance(serialized: string | null): AppearanceSettings {
  try {
    const value = JSON.parse(serialized ?? '{}') as Partial<AppearanceSettings>;
    return {
      accent: ['blue', 'violet', 'rose', 'tangerine', 'sage'].includes(value.accent ?? '')
        ? (value.accent as AccentColor)
        : defaultAppearance.accent,
      background: ['atmosphere', 'aurora', 'sunset', 'cloud', 'linen'].includes(
        value.background ?? '',
      )
        ? (value.background as BackgroundTemplate)
        : defaultAppearance.background,
      density: ['comfortable', 'compact'].includes(value.density ?? '')
        ? (value.density as ConversationDensity)
        : defaultAppearance.density,
      bubbles: ['soft', 'round', 'flat'].includes(value.bubbles ?? '')
        ? (value.bubbles as BubbleStyle)
        : defaultAppearance.bubbles,
    };
  } catch {
    return defaultAppearance;
  }
}
