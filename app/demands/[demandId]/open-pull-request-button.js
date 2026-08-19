"use client";

import { GitPullRequest, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function OpenPullRequestButton({ executionId, pullRequest = null }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function openPullRequest() {
    setLoading(true);
    setError("");
    const response = await fetch(`/api/executions/${executionId}/pull-request`, { method: "POST" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(result.error ?? "Não foi possível abrir o Pull Request");
      setLoading(false);
      return;
    }
    router.refresh();
    setLoading(false);
  }

  if (pullRequest) {
    return <div className="execution-action"><a href={pullRequest.url} target="_blank" rel="noreferrer"><GitPullRequest size={14} />Abrir Pull Request #{pullRequest.externalNumber}</a></div>;
  }

  return <div className="execution-action"><button onClick={openPullRequest} disabled={loading} type="button">{loading ? <LoaderCircle className="spin" size={14} /> : <GitPullRequest size={14} />}{loading ? "Abrindo..." : "Abrir PR"}</button>{error && <small>{error}</small>}</div>;
}
