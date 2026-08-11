"use client";

import { LoaderCircle, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function StartAnalysisButton({ demandId }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setLoading(true);
    setError("");
    const response = await fetch(`/api/demands/${demandId}/executions`, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error ?? "Não foi possível enfileirar a execução");
      setLoading(false);
      return;
    }
    router.refresh();
    setLoading(false);
  }

  return <div className="action-stack"><button className="primary" type="button" onClick={start} disabled={loading}>{loading ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />} {loading ? "Enfileirando..." : "Iniciar execução"}</button>{error && <small className="inline-error">{error}</small>}</div>;
}
