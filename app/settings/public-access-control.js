"use client";

import { LoaderCircle, ShieldCheck } from "lucide-react";
import { useState } from "react";

export default function PublicAccessControl({ initialEnabled }) {
  const [enabled, setEnabled] = useState(Boolean(initialEnabled));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function toggle(event) {
    const nextEnabled = event.target.checked;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/settings/public-access", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Não foi possível atualizar o acesso dos clientes");
      setEnabled(Boolean(result.enabled));
    } catch (toggleError) {
      setError(toggleError.message);
    } finally {
      setSaving(false);
    }
  }

  return <section className="form-card detail-card full-card">
    <div className="card-heading">
      <div>
        <h2>Acesso operacional dos clientes</h2>
        <p>Controla se usuários comuns podem iniciar demandas e subir ambientes. Administradores continuam com acesso.</p>
      </div>
      <ShieldCheck size={20} />
    </div>
    <label className="financial-shadow-toggle">
      <input type="checkbox" checked={enabled} onChange={toggle} disabled={saving} />
      <span>{saving ? <><LoaderCircle className="spin" size={14} /> Salvando...</> : enabled ? "Execuções e ambientes liberados" : "Execuções e ambientes bloqueados"}</span>
    </label>
    <small>Esta chave atua em tempo real. As variáveis de infraestrutura continuam sendo a trava de segurança máxima e não são alteradas por esta tela.</small>
    {error && <div className="form-error">{error}</div>}
  </section>;
}
