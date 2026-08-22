"use client";

import { LoaderCircle, Sparkles } from "lucide-react";
import { useState } from "react";

const STORAGE_KEY = "dashboardia:environment-recovery";

export default function EnvironmentRecoveryAction({ environmentId }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function recover() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/environments/${environmentId}/recovery`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Não foi possível preparar a correção");
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result.draft));
      window.location.assign(result.href);
    } catch (recoveryError) {
      setError(recoveryError.message);
      setLoading(false);
    }
  }

  return <section className="environment-credentials data_only">
    <div><Sparkles size={16} /><span><strong>Corrigir esta falha com IA</strong><small>Se esta branch tiver uma interação aberta, o erro será preparado nela. Caso contrário, o Dashboard IA abrirá uma nova demanda já vinculada à branch e com os detalhes técnicos preenchidos.</small></span></div>
    <div className="environment-actions"><button className="primary compact" type="button" onClick={recover} disabled={loading}>{loading ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}{loading ? "Preparando correção..." : "Preparar correção"}</button></div>
    {error && <small className="field-warning">{error}</small>}
  </section>;
}
