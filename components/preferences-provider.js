"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { translate } from "../lib/i18n";
import { normalizePreferences } from "../lib/user-preferences";

const PreferencesContext = createContext(null);

export function PreferencesProvider({ children, initialLocale, initialTheme }) {
  const initial = normalizePreferences({ locale: initialLocale, theme: initialTheme });
  const [locale, setLocale] = useState(initial.locale);
  const [theme, setTheme] = useState(initial.theme);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = theme === "SYSTEM" ? (media.matches ? "dark" : "light") : theme.toLowerCase();
      document.documentElement.dataset.theme = resolved;
      document.documentElement.lang = locale;
      document.documentElement.style.colorScheme = resolved === "gray" ? "dark" : resolved;
      localStorage.setItem("dashboardia.preferences", JSON.stringify({ locale, theme }));
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [locale, theme]);

  const value = useMemo(() => ({ locale, setLocale, theme, setTheme, t: (key) => translate(locale, key) }), [locale, theme]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error("usePreferences must be used inside PreferencesProvider");
  return context;
}
