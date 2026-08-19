"use client";

import { CheckCircle2, LoaderCircle, MessageSquareText, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function ExecutionConversation({ executionId, status, messages, expiresAt, adjustmentCount, maxAdjustments }) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const messageListRef = useRef(null);
  const available = status === "AWAITING_CLIENT";
  const processing = ["QUEUED", "PREPARING", "RUNNING", "VALIDATING"].includes(status);

  useEffect(() => {
    const list = messageListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

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
    if (!window.confirm("Concluir esta execução? Depois disso, novos ajustes deverão ser enviados em uma nova demanda.")) return;
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
    <header className="execution-chat-header"><span className="execution-chat-icon"><MessageSquareText size={19} /></span><div><h2>Ajustes da execução</h2><p>Continue no mesmo contexto, branch e Pull Request.</p></div><em className={`execution-chat-status ${available ? "available" : processing ? "processing" : "closed"}`}>{available ? "Aguardando você" : processing ? "Agente trabalhando" : "Concluída"}</em></header>
    <div className="execution-message-list" ref={messageListRef}>{messages.map((message) => <article className={`execution-message ${message.role.toLowerCase()}`} key={message.id}><header><strong>{message.role === "USER" ? "Você" : message.role === "AGENT" ? "Agente" : "Sistema"}</strong><time>{new Date(message.createdAt).toLocaleString("pt-BR")}</time></header><p>{message.content}</p></article>)}{!messages.length && <div className="list-empty">O histórico de ajustes aparecerá aqui após a abertura do Pull Request.</div>}</div>
    {processing && <div className="execution-chat-processing"><LoaderCircle className="spin" size={16} /><span><strong>O agente está aplicando seu ajuste</strong><small>A tela será atualizada automaticamente quando ele terminar.</small></span></div>}
    {available && <form className="execution-reply-form" onSubmit={sendAdjustment}><label htmlFor="execution-adjustment">Novo ajuste</label><textarea id="execution-adjustment" value={content} onChange={(event) => setContent(event.target.value)} placeholder="Explique o que precisa mudar ou acrescente um novo contexto..." minLength={3} maxLength={12000} required /><div className="execution-conversation-actions"><small>{adjustmentCount}/{maxAdjustments} ajustes usados · disponível até {new Date(expiresAt).toLocaleString("pt-BR")}</small><div><button className="execution-complete-button" type="button" onClick={completeExecution} disabled={loading}><CheckCircle2 size={16} />Concluir</button><button className="primary compact" type="submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}{loading ? "Enviando..." : "Enviar ajuste"}</button></div></div></form>}
    {!available && status === "SUCCEEDED" && <div className="form-success"><CheckCircle2 size={15} />Execução concluída. O histórico foi preservado.</div>}
    {error && <div className="form-error">{error}</div>}
  </section>;
}
