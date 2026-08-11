"use client";

import { LoaderCircle, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function WebhookStatus({ projectId, configured, error }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(error ?? "");

  async function configure() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${projectId}/webhook`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível configurar o webhook");
      router.refresh();
    } catch (configureError) {
      setMessage(configureError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="webhook-status">
      <span className={`status-pill ${configured ? "active" : "disconnected"}`}>{configured ? "Sincronizado" : "Pendente"}</span>
      {!configured && <button className="secondary compact" disabled={loading} onClick={configure} type="button">{loading ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}Configurar</button>}
      {message && <small>{message}</small>}
    </div>
  );
}
