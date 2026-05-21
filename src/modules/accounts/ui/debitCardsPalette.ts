import type { AppTheme } from '../../settings';

export type DebitCardsPalette = {
  background: string;
  border: string;
  card: string;
  danger: string;
  inverseText: string;
  muted: string;
  primary: string;
  secondary: string;
  tertiary: string;
  text: string;
};

export const debitCardsPalettes: Record<AppTheme, DebitCardsPalette> = {
  dark: {
    background: '#131314',
    border: 'rgba(255,255,255,0.12)',
    card: 'rgba(255,255,255,0.08)',
    danger: '#ffb4ab',
    inverseText: '#001d93',
    muted: '#c5c5d9',
    primary: '#bbc3ff',
    secondary: '#cdbdff',
    tertiary: '#00e475',
    text: '#f1f0ff',
  },
  light: {
    background: '#f8f7fb',
    border: 'rgba(35,42,65,0.12)',
    card: 'rgba(255,255,255,0.88)',
    danger: '#a93932',
    inverseText: '#ffffff',
    muted: '#686678',
    primary: '#2848ee',
    secondary: '#5203d5',
    tertiary: '#007f3e',
    text: '#19191d',
  },
};
