"use client";

import { GitPullRequest, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export default function AutoOpenPullRequest({ executionId }) {
  const requested = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    let cancelled = false;

    async function openPullRequest() {
      try {
        const response = await fetch(`/api/executions/${executionId}/pull-request`, { method: "POST" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error ?? "Não foi possível abrir o Pull Request automaticamente");
        if (!cancelled) window.location.reload();
      } catch (requestError) {
        if (!cancelled) setError(requestError.message);
      }
    }

    openPullRequest();
    return () => { cancelled = true; };
  }, [executionId]);

  return <div className={`execution-action ${error ? "error" : ""}`}>
    {error ? <TriangleAlert size={14} /> : <LoaderCircle className="spin" size={14} />}
    <span>{error || "Abrindo Pull Request automaticamente"}</span>
  </div>;
}
