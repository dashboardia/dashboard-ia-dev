"use client";

import { FolderPlus, LoaderCircle, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function StartAnalysisButton({ demandId }) {
  const router = useRouter();
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
      if (data.code === "EMPTY_PROJECT_BRANCH") {
        setEmptyRepository(true);
        setError("Esta branch está vazia. Para continuar, confirme a criação do projeto a partir desta branch.");
      } else setError(data.error ?? "Não foi possível enfileirar a execução");
      setLoading(false);
      return;
    }
    router.refresh();
    setLoading(false);
  }

  return (
    <div className="action-stack">
      {error && <small className="inline-error">{error}</small>}
      <button className="primary" type="button" onClick={start} disabled={loading}>
        {loading ? <LoaderCircle className="spin" size={15} /> : emptyRepository ? <FolderPlus size={15} /> : <Sparkles size={15} />}
        {loading ? "Enfileirando..." : emptyRepository ? "Confirmar criação do projeto" : "Iniciar execução"}
      </button>
    </div>
  );
}
