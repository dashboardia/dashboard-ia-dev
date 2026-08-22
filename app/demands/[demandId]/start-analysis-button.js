"use client";

import { FolderPlus, LoaderCircle, Sparkles } from "lucide-react";
import { useState } from "react";

export default function StartAnalysisButton({ demandId }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [emptyRepository, setEmptyRepository] = useState(false);

  async function start() {
    setLoading(true);
    setError("");
    const response = await fetch(`/api/demands/${demandId}/executions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowEmptyRepository: emptyRepository }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (data.executionId) {
        window.location.assign(`/executions/${data.executionId}`);
        return;
      }
      if (data.code === "EMPTY_PROJECT_BRANCH") {
        setEmptyRepository(true);
        setError("Esta branch está vazia. Para continuar, confirme a criação do projeto a partir desta branch.");
      } else setError(data.error ?? "Não foi possível enfileirar a execução");
      setLoading(false);
      return;
    }
    const executionId = data.execution?.id ?? data.executionId;
    if (!executionId) {
      setError("A execução foi criada, mas não foi possível abrir o acompanhamento.");
      setLoading(false);
      return;
    }
    window.location.assign(`/executions/${executionId}`);
  }

  return (
    <div className="action-stack">
      {error && <small className="inline-error">{error}</small>}
      <button className="primary" type="button" onClick={start} disabled={loading}>
        {loading ? <LoaderCircle className="spin" size={15} /> : emptyRepository ? <FolderPlus size={15} /> : <Sparkles size={15} />}
        {loading ? "Iniciando..." : emptyRepository ? "Confirmar criação do projeto" : "Iniciar execução"}
      </button>
    </div>
  );
}
