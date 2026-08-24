"use client";

import { CheckCircle2, FileText, LoaderCircle, MessageSquareText, Sparkles } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ATTACHMENT_ACCEPT, isImageAttachment, MAX_MESSAGE_ATTACHMENTS, validateAttachmentFiles } from "../../../lib/attachments";
import ChatComposer from "../../../components/chat-composer";

const ENVIRONMENT_RECOVERY_STORAGE_KEY = "dashboardia:environment-recovery";

function fileKey(file) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function StoredAttachment({ attachment }) {
  const url = `/api/execution-message-attachments/${attachment.id}`;
  if (isImageAttachment(attachment.mimeType)) {
    return <a aria-label={`Abrir imagem ${attachment.name}`} className="execution-message-image" href={url} target="_blank" rel="noreferrer" title={attachment.name}><Image unoptimized src={url} alt={attachment.name} width={220} height={150} /></a>;
  }
  return <a className="execution-message-file" href={url}><FileText size={18} /><span><strong>{attachment.name}</strong><small>{Math.max(1, Math.ceil(attachment.sizeBytes / 1024)).toLocaleString("pt-BR")} KB</small></span></a>;
}

function messageAuthor(message) {
  if (message.role === "AGENT") return "Agente";
  if (message.role === "SYSTEM") return "Sistema";
  return message.authorId ? "Você" : "Dashboard IA";
}

export default function ExecutionConversation({ executionId, status, messages, expiresAt, adjustmentCount, conversationReady = false, creditBlocked = false }) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [controlState, setControlState] = useState(null);
  const messageListRef = useRef(null);
  const fileInputRef = useRef(null);
  const previewUrlsRef = useRef(new Set());

  useEffect(() => {
    let cancelled = false;
    async function loadControlState() {
      try {
        const response = await fetch(`/api/executions/${encodeURIComponent(executionId)}/control-state`, { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (!cancelled && response.ok) setControlState(result);
      } catch {
        if (!cancelled) setControlState(null);
      }
    }
    loadControlState();
    const timer = window.setInterval(loadControlState, 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [executionId]);

  const effectiveStatus = controlState?.status ?? status;
  const effectiveCreditBlocked = controlState?.creditBlocked ?? creditBlocked;
  const paused = effectiveStatus === "STOPPED";
  const available = !effectiveCreditBlocked && Boolean(controlState?.interactionAvailable ?? (paused || ["FAILED", "AWAITING_CLIENT"].includes(effectiveStatus)));
  const processing = !effectiveCreditBlocked && ["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL"].includes(effectiveStatus);
  const chatTitle = effectiveCreditBlocked
    ? "Histórico preservado"
    : available
    ? paused ? "Processos pausados · converse com a IA" : "Converse com a IA"
    : processing
        ? (conversationReady ? "A IA está aplicando seu ajuste" : "A IA está executando a demanda")
        : "Histórico da conversa";
  const chatDescription = effectiveCreditBlocked
    ? "Adicione créditos para retomar a IA nesta mesma branch e neste mesmo Pull Request."
    : available
    ? paused
      ? "Você pode pedir um novo ajuste agora ou reexecutar a execução sem perder este histórico."
      : "Escreva o que deseja mudar. A IA aplica na mesma branch e no mesmo Pull Request."
    : processing
        ? (conversationReady ? "Acompanhe a execução ao lado. Quando terminar, você pode pedir outro ajuste aqui." : "Assim que a primeira implementação terminar, você poderá pedir ajustes sem sair desta execução.")
        : "As decisões e ajustes desta execução ficam preservados aqui.";

  useEffect(() => {
    const list = messageListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    if (!available) return;
    let frame = null;
    try {
      const stored = window.sessionStorage.getItem(ENVIRONMENT_RECOVERY_STORAGE_KEY);
      if (!stored) return;
      const draft = JSON.parse(stored);
      if (draft?.target !== "INTERACTION" || draft?.executionId !== executionId || !draft?.interactionMessage) return;
      window.sessionStorage.removeItem(ENVIRONMENT_RECOVERY_STORAGE_KEY);
      frame = window.requestAnimationFrame(() => {
        setContent((current) => current.trim() ? current : String(draft.interactionMessage).slice(0, 12_000));
        document.getElementById("execution-adjustment")?.focus();
      });
    } catch {
      window.sessionStorage.removeItem(ENVIRONMENT_RECOVERY_STORAGE_KEY);
    }
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [available, executionId]);

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

  return <section className="form-card detail-card execution-conversation">
    <header className="execution-chat-header"><span className="execution-chat-icon"><MessageSquareText size={19} /></span><div><h2>{chatTitle}</h2><p>{chatDescription}</p></div><em className={`execution-chat-status ${available ? "available" : processing ? "processing" : "closed"}`}>{effectiveCreditBlocked ? "Aguardando créditos" : available ? paused ? "Pausada · escreva aqui" : "Escreva aqui" : processing ? "IA trabalhando" : "Concluída"}</em></header>
    {available && <div className="execution-chat-guidance"><Sparkles size={16} /><span><strong>{paused ? "Processos pausados — você pode decidir o próximo passo" : "Peça mudanças em linguagem natural"}</strong><small>{paused ? "Envie um ajuste para a IA e a execução será retomada automaticamente, ou use Reexecutar de onde parou para continuar sem um novo pedido." : "Você pode pedir para corrigir um erro, mudar uma tela, adicionar uma função ou colar um print. A IA continua exatamente deste ponto."}</small></span></div>}
    <div className="execution-message-list" ref={messageListRef}>{messages.map((message) => {
      const hasAttachments = message.attachments?.length > 0;
      const attachmentOnly = hasAttachments && !message.content?.trim();
      return <article className={`execution-message ${message.role.toLowerCase()}${message.role === "USER" && !message.authorId ? " automatic" : ""}${hasAttachments ? " has-attachments" : ""}${attachmentOnly ? " attachment-only" : ""}`} key={message.id}>
        <header><strong>{messageAuthor(message)}</strong><time>{new Date(message.createdAt).toLocaleString("pt-BR")}</time></header>
        {!attachmentOnly && <p>{message.content}</p>}
        {hasAttachments && <div className="execution-message-attachments">{message.attachments.map((attachment) => <StoredAttachment attachment={attachment} key={attachment.id} />)}</div>}
      </article>;
    })}{!messages.length && <div className="list-empty">{conversationReady ? "O histórico dos seus ajustes aparecerá aqui." : "A conversa ficará disponível assim que a primeira implementação e o ambiente terminarem."}</div>}</div>
    {processing && <div className="execution-chat-processing"><LoaderCircle className="spin" size={16} /><span><strong>{conversationReady ? "A IA está aplicando seu ajuste" : "A IA está trabalhando na implementação"}</strong><small>Acompanhe as etapas ao lado. A tela atualiza automaticamente.</small></span></div>}
    {available && <div className="execution-modern-reply"><ChatComposer
      id="execution-adjustment"
      label="O que você quer que a IA faça agora?"
      value={content}
      onChange={(event) => setContent(event.target.value)}
      onPaste={pasteAttachments}
      onSubmit={sendAdjustment}
      placeholder="Descreva a alteração ou cole uma imagem aqui…"
      loading={loading}
      canSubmit={Boolean(content.trim() || attachments.length)}
      submitLabel={paused ? "Enviar e retomar" : "Enviar ajuste"}
      attachments={attachments.map((attachment) => ({ ...attachment, key: fileKey(attachment.file), name: attachment.file.name }))}
      renderAttachment={(attachment) => attachment.previewUrl ? <Image unoptimized src={attachment.previewUrl} alt={attachment.file.name} width={112} height={72} /> : <FileText size={20} />}
      onRemoveAttachment={removeAttachment}
      fileInputRef={fileInputRef}
      accept={ATTACHMENT_ACCEPT}
      onFilesSelected={selectAttachments}
      attachmentDisabled={attachments.length >= MAX_MESSAGE_ATTACHMENTS}
      attachmentHint={`${attachments.length}/${MAX_MESSAGE_ATTACHMENTS} arquivos`}
      compact
      error={error}
      footer={<><span>{adjustmentCount} ajuste{adjustmentCount === 1 ? "" : "s"} · disponível enquanto houver créditos{expiresAt ? ` · expira após 24h sem interação` : ""}</span><button className="execution-complete-button" type="button" onClick={completeExecution} disabled={loading || paused}><CheckCircle2 size={16} />Concluir execução</button></>}
    /></div>}
    {!available && effectiveStatus === "SUCCEEDED" && <div className="form-success"><CheckCircle2 size={15} />Execução concluída. O histórico foi preservado.</div>}
    {error && !available && <div className="form-error">{error}</div>}
  </section>;
}
