"use client";

import { CheckCircle2, LoaderCircle, Save } from "lucide-react";
import { useState } from "react";

export default function GlobalSettingsForm({ initialSettings }) {
  const [form, setForm] = useState({
    timeZone: initialSettings.timeZone,
    nodeMemoryMb: String(initialSettings.nodeMemoryMb),
    commandTimeoutMinutes: String(initialSettings.commandTimeoutMinutes),
    agentTimeoutMinutes: String(initialSettings.agentTimeoutMinutes),
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const change = (event) => { setSaved(false); setForm((current) => ({ ...current, [event.target.name]: event.target.value })); };

  async function submit(event) {
    event.preventDefault(); setSaving(true); setSaved(false); setError("");
    try {
      const response = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.fields?.[0]?.message ?? result.error ?? "Não foi possível salvar");
      setSaved(true);
    } catch (submitError) { setError(submitError.message); } finally { setSaving(false); }
  }

  return <form className="form-card detail-card full-card" onSubmit={submit}><div className="card-heading"><div><h2>Execução global</h2><p>Padrões aplicados pelo worker a todos os projetos</p></div></div><div className="form-grid"><label><span>Fuso horário</span><select name="timeZone" value={form.timeZone} onChange={change}><option value="America/Sao_Paulo">Brasil — São Paulo</option><option value="UTC">UTC</option></select></label><label><span>Memória máxima do Node</span><select name="nodeMemoryMb" value={form.nodeMemoryMb} onChange={change}><option value="256">256 MB</option><option value="384">384 MB</option><option value="512">512 MB</option><option value="640">640 MB</option><option value="768">768 MB</option></select></label><label><span>Timeout de cada comando</span><input name="commandTimeoutMinutes" type="number" min="1" max="30" value={form.commandTimeoutMinutes} onChange={change} /><small>Minutos para instalação, lint, testes e build.</small></label><label><span>Timeout do agente</span><input name="agentTimeoutMinutes" type="number" min="1" max="15" value={form.agentTimeoutMinutes} onChange={change} /><small>Minutos máximos para implementação.</small></label></div>{error && <div className="form-error">{error}</div>}<div className="form-actions">{saved && <span className="form-success"><CheckCircle2 size={15} />Configurações salvas</span>}<button className="primary" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}{saving ? "Salvando..." : "Salvar configurações globais"}</button></div></form>;
}
