export const THEMES = ["SYSTEM", "LIGHT", "GRAY", "DARK"];
export const LOCALES = ["pt-BR", "en", "es"];

export function normalizePreferences(input = {}) {
  return {
    theme: THEMES.includes(input.theme) ? input.theme : "SYSTEM",
    locale: LOCALES.includes(input.locale) ? input.locale : "pt-BR",
  };
}
