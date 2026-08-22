"use client";

import { ArrowRight, LoaderCircle, Sparkles } from "lucide-react";
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

  return <section className="environment-recovery-card">
    <div className="environment-recovery-copy">
      <span className="environment-recovery-icon"><Sparkles size={16} /></span>
      <div>
        <strong>Corrigir falha com IA</strong>
        <small>Se esta branch tiver uma interação aberta, continuamos nela. Caso contrário, preparamos uma nova demanda com a branch e o erro já preenchidos.</small>
      </div>
    </div>
    <button className="environment-recovery-button" type="button" onClick={recover} disabled={loading}>
      {loading ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}
      <span>{loading ? "Preparando correção..." : "Corrigir com IA"}</span>
      {!loading && <ArrowRight size={15} />}
    </button>
    {error && <small className="environment-recovery-error">{error}</small>}
  </section>;
}
