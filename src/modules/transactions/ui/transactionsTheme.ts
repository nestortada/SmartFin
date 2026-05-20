import type { AppTheme } from '../../settings';
import type { CreditCardsPalette } from '../../creditCards/ui/creditCardUiTypes';

export type TransactionsThemeColors = {
  background: string;
  border: string;
  card: string;
  danger: string;
  glassBorder: string;
  muted: string;
  primary: string;
  tertiary: string;
  text: string;
};

export function getTransactionsThemeColors(activeTheme: AppTheme): TransactionsThemeColors {
  const isDark = activeTheme === 'dark';

  return {
    background: isDark ? '#0d0b14' : '#f4f3f8',
    text: isDark ? '#f1f0ff' : '#19191d',
    muted: isDark ? '#c5c5d9' : '#686678',
    border: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(35, 42, 65, 0.12)',
    card: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.72)',
    primary: isDark ? '#bbc3ff' : '#2848ee',
    tertiary: '#00e475',
    danger: isDark ? '#ffb4ab' : '#ba1a1a',
    glassBorder: 'rgba(255, 255, 255, 0.12)',
  };
}

export function getCreditCardPaletteForTransactions(
  activeTheme: AppTheme,
  themeColors: TransactionsThemeColors,
): CreditCardsPalette {
  const isDark = activeTheme === 'dark';

  return {
    background: themeColors.background,
    border: themeColors.border,
    card: themeColors.card,
    cardStrong: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.94)',
    danger: themeColors.danger,
    dangerSoft: isDark ? 'rgba(255, 180, 171, 0.12)' : 'rgba(186, 26, 26, 0.10)',
    inverseText: isDark ? '#001d93' : '#ffffff',
    muted: themeColors.muted,
    primary: themeColors.primary,
    primaryStrong: isDark ? '#3d5afe' : '#2848ee',
    secondary: isDark ? '#cdbdff' : '#5203d5',
    surface: isDark ? '#201f20' : '#ffffff',
    tertiary: themeColors.tertiary,
    text: themeColors.text,
  };
}
