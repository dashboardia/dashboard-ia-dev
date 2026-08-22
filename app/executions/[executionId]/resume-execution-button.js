"use client";

import { LoaderCircle, PlayCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ResumeExecutionButton({ executionId, processingEnabled = true }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function resume() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/executions/${executionId}/resume`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Não foi possível retomar a execução");
      router.refresh();
    } catch (resumeError) {
      setError(resumeError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="execution-action">
      <button className="primary" disabled={loading || !processingEnabled} onClick={resume} type="button">
        {loading ? <LoaderCircle className="spin" size={14} /> : <PlayCircle size={14} />}
        {loading ? "Reexecutando..." : processingEnabled ? "Reexecutar de onde parou" : "Processamento pausado"}
      </button>
      {error && <small>{error}</small>}
    </div>
  );
}
