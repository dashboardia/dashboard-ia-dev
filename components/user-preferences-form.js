"use client";

import { Languages, MoonStar, Save } from "lucide-react";
import { useState } from "react";

import { usePreferences } from "./preferences-provider";

export default function UserPreferencesForm() {
  const { locale, setLocale, theme, setTheme, t } = usePreferences();
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setStatus("");
    try {
      const response = await fetch("/api/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale, theme }) });
      if (!response.ok) throw new Error();
      setStatus(t("saved"));
    } catch {
      setStatus("Não foi possível salvar as preferências.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="form-card detail-card preferences-card"><div className="card-heading"><div><h2>{t("preferences")}</h2><p>{t("preferencesHelp")}</p></div><Languages size={20} /></div><form onSubmit={save} className="preferences-form"><label><span><MoonStar size={15} />{t("theme")}</span><select value={theme} onChange={(event) => setTheme(event.target.value)}><option value="SYSTEM">{t("system")}</option><option value="LIGHT">{t("light")}</option><option value="DARK">{t("dark")}</option></select></label><label><span><Languages size={15} />{t("language")}</span><select value={locale} onChange={(event) => setLocale(event.target.value)}><option value="pt-BR">{t("portuguese")}</option><option value="en">{t("english")}</option><option value="es">{t("spanish")}</option></select></label><button className="primary" disabled={saving}><Save size={15} />{saving ? t("saving") : t("save")}</button>{status && <small className="preference-status">{status}</small>}</form></section>;
}
