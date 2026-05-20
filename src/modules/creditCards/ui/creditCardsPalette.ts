import type { AppTheme } from '../../settings';
import type { CreditCardsPalette } from './creditCardUiTypes';

export const creditCardsPalettes: Record<AppTheme, CreditCardsPalette> = {
  dark: {
    background: '#131314',
    border: 'rgba(255, 255, 255, 0.14)',
    card: 'rgba(255, 255, 255, 0.08)',
    cardStrong: 'rgba(255, 255, 255, 0.12)',
    danger: '#ffb4ab',
    dangerSoft: 'rgba(255, 180, 171, 0.12)',
    inverseText: '#001d93',
    muted: '#c5c5d9',
    primary: '#bbc3ff',
    primaryStrong: '#3d5afe',
    secondary: '#cdbdff',
    surface: '#201f20',
    tertiary: '#00e475',
    text: '#f1f0ff',
  },
  light: {
    background: '#f8f7fb',
    border: 'rgba(30, 36, 60, 0.12)',
    card: 'rgba(255, 255, 255, 0.78)',
    cardStrong: 'rgba(255, 255, 255, 0.94)',
    danger: '#a9362e',
    dangerSoft: 'rgba(169, 54, 46, 0.1)',
    inverseText: '#ffffff',
    muted: '#686678',
    primary: '#2848ee',
    primaryStrong: '#3d5afe',
    secondary: '#5203d5',
    surface: '#ffffff',
    tertiary: '#007f3e',
    text: '#18191f',
  },
};
