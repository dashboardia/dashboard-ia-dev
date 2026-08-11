"use client";

import { LoaderCircle, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function CancelExecutionButton({ executionId }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function cancel() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/executions/${executionId}/cancel`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Não foi possível cancelar a execução");
      router.refresh();
    } catch (cancelError) {
      setError(cancelError.message);
    } finally {
      setLoading(false);
    }
  }

  return <div className="execution-action"><button className="danger" disabled={loading} onClick={cancel} type="button">{loading ? <LoaderCircle className="spin" size={14} /> : <XCircle size={14} />}{loading ? "Cancelando..." : "Cancelar execução"}</button>{error && <small>{error}</small>}</div>;
}
