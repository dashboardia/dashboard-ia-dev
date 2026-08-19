"use client";

import { CheckCircle2, LoaderCircle, MessageSquareText, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ExecutionConversation({ executionId, status, messages, expiresAt, adjustmentCount, maxAdjustments }) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const available = status === "AWAITING_CLIENT";

  async function sendAdjustment(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/executions/${executionId}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Não foi possível enviar o ajuste");
      setContent("");
      router.refresh();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setLoading(false);
    }
  }

  async function completeExecution() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/executions/${executionId}/complete`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Não foi possível concluir a execução");
      router.refresh();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setLoading(false);
    }
  }

  return <section className="form-card detail-card full-card execution-conversation">
    <div className="card-heading"><div><h2>Interação da execução</h2><p>Peça ajustes no mesmo contexto, branch e Pull Request antes de concluir.</p></div><MessageSquareText size={20} /></div>
    <div className="execution-message-list">{messages.map((message) => <article className={`execution-message ${message.role.toLowerCase()}`} key={message.id}><header><strong>{message.role === "USER" ? "Cliente" : message.role === "AGENT" ? "Agente" : "Sistema"}</strong><time>{new Date(message.createdAt).toLocaleString("pt-BR")}</time></header><p>{message.content}</p></article>)}{!messages.length && <div className="list-empty">A interação será liberada após a abertura do Pull Request.</div>}</div>
    {available && <form className="execution-reply-form" onSubmit={sendAdjustment}><textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="Descreva o ajuste ou informe uma mudança de contexto..." minLength={3} maxLength={12000} required /><div className="execution-conversation-actions"><small>{adjustmentCount}/{maxAdjustments} ajustes · sessão até {new Date(expiresAt).toLocaleString("pt-BR")}</small><div className="form-actions"><button type="button" onClick={completeExecution} disabled={loading}><CheckCircle2 size={16} />Concluir execução</button><button className="primary" type="submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}{loading ? "Processando..." : "Enviar ajuste"}</button></div></div></form>}
    {!available && status === "SUCCEEDED" && <div className="form-success"><CheckCircle2 size={15} />Execução concluída. O histórico foi preservado.</div>}
    {error && <div className="form-error">{error}</div>}
  </section>;
}
