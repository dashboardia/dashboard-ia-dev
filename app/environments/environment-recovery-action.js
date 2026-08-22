"use client";

import { ArrowRight, FilePlus2, LoaderCircle, MessageSquareText } from "lucide-react";
import { useEffect, useState } from "react";

const STORAGE_KEY = "dashboardia:environment-recovery";

async function loadRecoveryTarget(environmentId) {
  const response = await fetch(`/api/environments/${environmentId}/recovery`, { cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? "Não foi possível verificar como corrigir esta falha");
  return result;
}

export default function EnvironmentRecoveryAction({ environmentId }) {
  const [resolution, setResolution] = useState(null);
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setChecking(true);
    setError("");
    loadRecoveryTarget(environmentId)
      .then((result) => {
        if (active) setResolution(result);
      })
      .catch((recoveryError) => {
        if (active) setError(recoveryError.message);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => { active = false; };
  }, [environmentId]);

  async function recover() {
    setLoading(true);
    setError("");
    try {
      // Revalida no clique para não enviar o usuário a uma interação que acabou de fechar.
      const result = await loadRecoveryTarget(environmentId);
      setResolution(result);
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result.draft));
      window.location.assign(result.href);
    } catch (recoveryError) {
      setError(recoveryError.message);
      setLoading(false);
    }
  }

  if (checking) {
    return <section className="environment-recovery-card">
      <div className="environment-recovery-copy">
        <span className="environment-recovery-icon"><LoaderCircle className="spin" size={16} /></span>
        <div><strong>Verificando opção de correção</strong><small>Procurando uma interação aberta para esta mesma branch.</small></div>
      </div>
    </section>;
  }

  const hasOpenInteraction = resolution?.target === "INTERACTION";
  const Icon = hasOpenInteraction ? MessageSquareText : FilePlus2;
  const title = hasOpenInteraction ? "Corrigir na interação aberta" : "Criar demanda de correção";
  const description = hasOpenInteraction
    ? "Encontramos uma execução desta mesma branch aguardando interação. O erro será preparado diretamente nela."
    : "Não há uma execução desta branch aberta para interação. Abra uma nova demanda com a branch e os detalhes da falha já preenchidos.";
  const buttonLabel = hasOpenInteraction ? "Corrigir na interação" : "Abrir nova demanda";

  return <section className="environment-recovery-card">
    <div className="environment-recovery-copy">
      <span className="environment-recovery-icon"><Icon size={16} /></span>
      <div><strong>{title}</strong><small>{description}</small></div>
    </div>
    <button className="environment-recovery-button" type="button" onClick={recover} disabled={loading || !resolution}>
      {loading ? <LoaderCircle className="spin" size={15} /> : <Icon size={15} />}
      <span>{loading ? "Preparando..." : buttonLabel}</span>
      {!loading && <ArrowRight size={15} />}
    </button>
    {error && <small className="environment-recovery-error">{error}</small>}
  </section>;
}
