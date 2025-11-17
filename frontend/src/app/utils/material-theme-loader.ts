import themeJson from '../../assets/material-theme.json';

export interface MaterialThemePalette {
  [key: string]: string;
}

export interface MaterialThemeScheme {
  primary: string;
  surfaceTint: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  tertiary: string;
  onTertiary: string;
  tertiaryContainer: string;
  onTertiaryContainer: string;
  error: string;
  onError: string;
  errorContainer: string;
  onErrorContainer: string;
  background: string;
  onBackground: string;
  surface: string;
  onSurface: string;
  surfaceVariant: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;
  shadow: string;
  scrim: string;
  inverseSurface: string;
  inverseOnSurface: string;
  inversePrimary: string;
  primaryFixed: string;
  onPrimaryFixed: string;
  primaryFixedDim: string;
  onPrimaryFixedVariant: string;
  secondaryFixed: string;
  onSecondaryFixed: string;
  secondaryFixedDim: string;
  onSecondaryFixedVariant: string;
  tertiaryFixed: string;
  onTertiaryFixed: string;
  tertiaryFixedDim: string;
  onTertiaryFixedVariant: string;
  surfaceDim: string;
  surfaceBright: string;
  surfaceContainerLowest: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
}

export interface MaterialTheme {
  description: string;
  seed: string;
  coreColors: {
    primary: string;
  };
  extendedColors: any[];
  schemes: {
    light: MaterialThemeScheme;
    'light-medium-contrast': MaterialThemeScheme;
    'light-high-contrast': MaterialThemeScheme;
    dark: MaterialThemeScheme;
    'dark-medium-contrast': MaterialThemeScheme;
    'dark-high-contrast': MaterialThemeScheme;
  };
  palettes: {
    primary: MaterialThemePalette;
    secondary: MaterialThemePalette;
    tertiary: MaterialThemePalette;
    neutral: MaterialThemePalette;
    'neutral-variant': MaterialThemePalette;
  };
}

export const materialTheme: MaterialTheme = themeJson as MaterialTheme;

/**
 * Converts Material Theme Builder palette to Angular Material palette format
 * Material Design 3 uses tonal palettes with specific key values
 */
export function convertPaletteToMaterialFormat(palette: MaterialThemePalette): Record<string, string> {
  // Angular Material expects keys like 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100
  // Material Theme Builder provides 0, 5, 10, 15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 90, 95, 98, 99, 100
  // We'll map the closest values
  return {
    '0': palette['0'] || '#000000',
    '10': palette['10'] || palette['5'] || '#000000',
    '20': palette['20'] || palette['15'] || '#000000',
    '30': palette['30'] || palette['25'] || '#000000',
    '40': palette['40'] || palette['35'] || '#000000',
    '50': palette['50'] || '#000000',
    '60': palette['60'] || '#000000',
    '70': palette['70'] || '#000000',
    '80': palette['80'] || '#000000',
    '90': palette['90'] || '#000000',
    '95': palette['95'] || palette['98'] || '#FFFFFF',
    '100': palette['100'] || '#FFFFFF',
  };
}

/**
 * Gets the primary color from the theme (typically the seed color or primary 40)
 */
export function getPrimaryColor(): string {
  return materialTheme.coreColors.primary || materialTheme.palettes.primary['40'] || '#7AC4FF';
}

/**
 * Gets the light scheme colors as CSS custom properties
 */
export function getLightSchemeCSSVariables(): Record<string, string> {
  const scheme = materialTheme.schemes.light;
  return {
    '--mat-sys-primary': scheme.primary,
    '--mat-sys-on-primary': scheme.onPrimary,
    '--mat-sys-primary-container': scheme.primaryContainer,
    '--mat-sys-on-primary-container': scheme.onPrimaryContainer,
    '--mat-sys-secondary': scheme.secondary,
    '--mat-sys-on-secondary': scheme.onSecondary,
    '--mat-sys-secondary-container': scheme.secondaryContainer,
    '--mat-sys-on-secondary-container': scheme.onSecondaryContainer,
    '--mat-sys-tertiary': scheme.tertiary,
    '--mat-sys-on-tertiary': scheme.onTertiary,
    '--mat-sys-tertiary-container': scheme.tertiaryContainer,
    '--mat-sys-on-tertiary-container': scheme.onTertiaryContainer,
    '--mat-sys-error': scheme.error,
    '--mat-sys-on-error': scheme.onError,
    '--mat-sys-error-container': scheme.errorContainer,
    '--mat-sys-on-error-container': scheme.onErrorContainer,
    '--mat-sys-background': scheme.background,
    '--mat-sys-on-background': scheme.onBackground,
    '--mat-sys-surface': scheme.surface,
    '--mat-sys-on-surface': scheme.onSurface,
    '--mat-sys-surface-variant': scheme.surfaceVariant,
    '--mat-sys-on-surface-variant': scheme.onSurfaceVariant,
    '--mat-sys-outline': scheme.outline,
    '--mat-sys-outline-variant': scheme.outlineVariant,
    '--mat-sys-shadow': scheme.shadow,
    '--mat-sys-scrim': scheme.scrim,
    '--mat-sys-inverse-surface': scheme.inverseSurface,
    '--mat-sys-inverse-on-surface': scheme.inverseOnSurface,
    '--mat-sys-inverse-primary': scheme.inversePrimary,
    '--mat-sys-surface-dim': scheme.surfaceDim,
    '--mat-sys-surface-bright': scheme.surfaceBright,
    '--mat-sys-surface-container-lowest': scheme.surfaceContainerLowest,
    '--mat-sys-surface-container-low': scheme.surfaceContainerLow,
    '--mat-sys-surface-container': scheme.surfaceContainer,
    '--mat-sys-surface-container-high': scheme.surfaceContainerHigh,
    '--mat-sys-surface-container-highest': scheme.surfaceContainerHighest,
  };
}

/**
 * Gets the dark scheme colors as CSS custom properties
 */
export function getDarkSchemeCSSVariables(): Record<string, string> {
  const scheme = materialTheme.schemes.dark;
  return {
    '--mat-sys-primary': scheme.primary,
    '--mat-sys-on-primary': scheme.onPrimary,
    '--mat-sys-primary-container': scheme.primaryContainer,
    '--mat-sys-on-primary-container': scheme.onPrimaryContainer,
    '--mat-sys-secondary': scheme.secondary,
    '--mat-sys-on-secondary': scheme.onSecondary,
    '--mat-sys-secondary-container': scheme.secondaryContainer,
    '--mat-sys-on-secondary-container': scheme.onSecondaryContainer,
    '--mat-sys-tertiary': scheme.tertiary,
    '--mat-sys-on-tertiary': scheme.onTertiary,
    '--mat-sys-tertiary-container': scheme.tertiaryContainer,
    '--mat-sys-on-tertiary-container': scheme.onTertiaryContainer,
    '--mat-sys-error': scheme.error,
    '--mat-sys-on-error': scheme.onError,
    '--mat-sys-error-container': scheme.errorContainer,
    '--mat-sys-on-error-container': scheme.onErrorContainer,
    '--mat-sys-background': scheme.background,
    '--mat-sys-on-background': scheme.onBackground,
    '--mat-sys-surface': scheme.surface,
    '--mat-sys-on-surface': scheme.onSurface,
    '--mat-sys-surface-variant': scheme.surfaceVariant,
    '--mat-sys-on-surface-variant': scheme.onSurfaceVariant,
    '--mat-sys-outline': scheme.outline,
    '--mat-sys-outline-variant': scheme.outlineVariant,
    '--mat-sys-shadow': scheme.shadow,
    '--mat-sys-scrim': scheme.scrim,
    '--mat-sys-inverse-surface': scheme.inverseSurface,
    '--mat-sys-inverse-on-surface': scheme.inverseOnSurface,
    '--mat-sys-inverse-primary': scheme.inversePrimary,
    '--mat-sys-surface-dim': scheme.surfaceDim,
    '--mat-sys-surface-bright': scheme.surfaceBright,
    '--mat-sys-surface-container-lowest': scheme.surfaceContainerLowest,
    '--mat-sys-surface-container-low': scheme.surfaceContainerLow,
    '--mat-sys-surface-container': scheme.surfaceContainer,
    '--mat-sys-surface-container-high': scheme.surfaceContainerHigh,
    '--mat-sys-surface-container-highest': scheme.surfaceContainerHighest,
  };
}

