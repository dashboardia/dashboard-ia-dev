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
        setError("A branch está sem código. Confirme abaixo para o Dashboardia criar o projeto completo do zero.");
      } else setError(data.error ?? "Não foi possível enfileirar a execução");
      setLoading(false);
      return;
    }
    router.refresh();
    setLoading(false);
  }

  return <div className="action-stack"><button className="primary" type="button" onClick={start} disabled={loading}>{loading ? <LoaderCircle className="spin" size={15} /> : emptyRepository ? <FolderPlus size={15} /> : <Sparkles size={15} />} {loading ? "Enfileirando..." : emptyRepository ? "Criar projeto do zero" : "Iniciar execução"}</button>{error && <small className="inline-error">{error}</small>}</div>;
}
