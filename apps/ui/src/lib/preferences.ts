export const languageKey = 'courtplus.uiLanguage';
const themeKey = 'courtplus.theme';

export type UiLanguage = 'en' | 'hi';
export type Theme = 'day' | 'night';

export const UI_LANGUAGES: ReadonlyArray<readonly [UiLanguage, string]> = [
  ['en', 'English'],
  ['hi', 'हिन्दी'],
];

export function readPreference(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writePreference(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* The current window still uses the selection. */ }
}

export const readTheme = (): Theme => readPreference(themeKey) === 'night' ? 'night' : 'day';

export function applyTheme(theme: Theme, remember = false) {
  document.documentElement.dataset.theme = theme;
  if (remember) writePreference(themeKey, theme);
}
