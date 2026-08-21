"use client";

import { CheckCircle2, FileText, LoaderCircle, MessageSquareText, Paperclip, Send, Trash2 } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ATTACHMENT_ACCEPT, isImageAttachment, MAX_MESSAGE_ATTACHMENTS, validateAttachmentFiles } from "../../../lib/attachments";

function fileKey(file) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function StoredAttachment({ attachment }) {
  const url = `/api/execution-message-attachments/${attachment.id}`;
  if (isImageAttachment(attachment.mimeType)) {
    return <a className="execution-message-image" href={url} target="_blank" rel="noreferrer"><Image unoptimized src={url} alt={attachment.name} width={180} height={110} /><small>{attachment.name}</small></a>;
  }
  return <a className="execution-message-file" href={url}><FileText size={18} /><span><strong>{attachment.name}</strong><small>{Math.max(1, Math.ceil(attachment.sizeBytes / 1024)).toLocaleString("pt-BR")} KB</small></span></a>;
}

export default function ExecutionConversation({ executionId, status, messages, expiresAt, adjustmentCount, maxAdjustments }) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const messageListRef = useRef(null);
  const fileInputRef = useRef(null);
  const previewUrlsRef = useRef(new Set());
  const available = status === "AWAITING_CLIENT";
  const processing = ["QUEUED", "PREPARING", "RUNNING", "VALIDATING"].includes(status);

  useEffect(() => {
    const list = messageListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length]);
  useEffect(() => () => {
    previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrlsRef.current.clear();
  }, []);

  function addAttachments(files) {
    setError("");
    try {
      const existing = new Set(attachments.map(({ file }) => fileKey(file)));
      const candidates = Array.from(files ?? []).filter((file) => !existing.has(fileKey(file)));
      validateAttachmentFiles([...attachments.map(({ file }) => file), ...candidates]);
      const validated = validateAttachmentFiles(candidates).map(({ file, mimeType }) => {
        const previewUrl = isImageAttachment(mimeType) ? URL.createObjectURL(file) : null;
        if (previewUrl) previewUrlsRef.current.add(previewUrl);
        return { file, mimeType, previewUrl };
      });
      setAttachments((current) => [...current, ...validated]);
    } catch (attachmentError) {
      setError(attachmentError.message);
    }
  }

  function selectAttachments(event) {
    addAttachments(event.target.files);
    event.target.value = "";
  }

  function pasteAttachments(event) {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (!files.length) return;
    event.preventDefault();
    addAttachments(files);
  }

  function removeAttachment(index) {
    setAttachments((current) => {
      const selected = current[index];
      if (selected?.previewUrl) {
        URL.revokeObjectURL(selected.previewUrl);
        previewUrlsRef.current.delete(selected.previewUrl);
      }
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  }

  async function sendAdjustment(event) {
    event.preventDefault();
    if (!content.trim() && !attachments.length) return;
    setLoading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.set("content", content);
      attachments.forEach(({ file }) => formData.append("attachments", file, file.name));
      const response = await fetch(`/api/executions/${executionId}/messages`, { method: "POST", body: formData });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Não foi possível enviar o ajuste");
      attachments.forEach((attachment) => {
        if (!attachment.previewUrl) return;
        URL.revokeObjectURL(attachment.previewUrl);
        previewUrlsRef.current.delete(attachment.previewUrl);
      });
      setContent("");
      setAttachments([]);
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
    <div className="execution-message-list" ref={messageListRef}>{messages.map((message) => <article className={`execution-message ${message.role.toLowerCase()}`} key={message.id}><header><strong>{message.role === "USER" ? "Você" : message.role === "AGENT" ? "Agente" : "Sistema"}</strong><time>{new Date(message.createdAt).toLocaleString("pt-BR")}</time></header><p>{message.content}</p>{message.attachments?.length > 0 && <div className="execution-message-attachments">{message.attachments.map((attachment) => <StoredAttachment attachment={attachment} key={attachment.id} />)}</div>}</article>)}{!messages.length && <div className="list-empty">O histórico de ajustes aparecerá aqui após a abertura do Pull Request.</div>}</div>
    {processing && <div className="execution-chat-processing"><LoaderCircle className="spin" size={16} /><span><strong>O agente está aplicando seu ajuste</strong><small>A tela será atualizada automaticamente quando ele terminar.</small></span></div>}
    {available && <form className="execution-reply-form" onSubmit={sendAdjustment}><label htmlFor="execution-adjustment">Novo ajuste</label><textarea id="execution-adjustment" value={content} onPaste={pasteAttachments} onChange={(event) => setContent(event.target.value)} placeholder="Explique o ajuste, cole um print ou anexe arquivos..." maxLength={12000} />{attachments.length > 0 && <div className="execution-pending-attachments">{attachments.map((attachment, index) => <span key={fileKey(attachment.file)}>{attachment.previewUrl ? <Image unoptimized src={attachment.previewUrl} alt={attachment.file.name} width={42} height={42} /> : <FileText size={18} />}<small>{attachment.file.name}</small><button type="button" onClick={() => removeAttachment(index)} aria-label={`Remover ${attachment.file.name}`}><Trash2 size={13} /></button></span>)}</div>}<div className="execution-attachment-tools"><input ref={fileInputRef} hidden type="file" accept={ATTACHMENT_ACCEPT} multiple onChange={selectAttachments} /><button type="button" onClick={() => fileInputRef.current?.click()} disabled={loading || attachments.length >= MAX_MESSAGE_ATTACHMENTS}><Paperclip size={15} />Anexar arquivos</button><small>Até 4 arquivos · 5 MB cada · imagens, PDF, Word, Excel, CSV ou TXT</small></div><div className="execution-conversation-actions"><small>{adjustmentCount}/{maxAdjustments} ajustes usados · cobrança pelo uso medido · expira somente após 24h sem sua interação{expiresAt ? ` (${new Date(expiresAt).toLocaleString("pt-BR")})` : ""}</small><div><button className="execution-complete-button" type="button" onClick={completeExecution} disabled={loading}><CheckCircle2 size={16} />Concluir</button><button className="primary compact" type="submit" disabled={loading || (!content.trim() && !attachments.length)}>{loading ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}{loading ? "Enviando..." : "Enviar ajuste"}</button></div></div></form>}
    {!available && status === "SUCCEEDED" && <div className="form-success"><CheckCircle2 size={15} />Execução concluída. O histórico foi preservado.</div>}
    {error && <div className="form-error">{error}</div>}
  </section>;
}
