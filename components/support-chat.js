"use client";

import { ArrowUpRight, Bot, FileText, FolderKanban, ListTodo, MessageCircle, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { ATTACHMENT_ACCEPT, isImageAttachment, MAX_MESSAGE_ATTACHMENTS, validateAttachmentFiles } from "../lib/attachments";
import ChatComposer from "./chat-composer";
import { usePreferences } from "./preferences-provider";

const subscribeToClient = () => () => {};

function attachmentKey(file) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function AttachmentPreview({ attachment, compact = false }) {
  const file = attachment.file ?? attachment;
  const mimeType = file.type || attachment.mimeType;
  if (isImageAttachment(mimeType) && attachment.previewUrl) {
    return <Image unoptimized src={attachment.previewUrl} alt={file.name} width={compact ? 42 : 92} height={compact ? 42 : 64} />;
  }
  return <span className="support-file-preview"><FileText size={compact ? 18 : 22} /></span>;
}

const projectStatusLabels = { ACTIVE: "Ativo", ARCHIVED: "Arquivado", DISCONNECTED: "Desconectado" };
const healthLabels = { HEALTHY: "Saudável", DEGRADED: "Atenção", DOWN: "Indisponível", UNKNOWN: "Sem verificação" };
const executionStatusLabels = {
  QUEUED: "Na fila", PREPARING: "Preparando", RUNNING: "Em execução", VALIDATING: "Validando",
  WAITING_APPROVAL: "Aguardando aprovação", AWAITING_CLIENT: "Aguardando você", SUCCEEDED: "Concluída",
  FAILED: "Com falha", STOPPED: "Pausada", CANCELLED: "Cancelada",
};

function SupportNavigation({ links = [], projects = [] }) {
  if (!links.length && !projects.length) return null;
  return <div className="support-context-navigation">
    {projects.length > 0 && <div className="support-project-cards">{projects.map((project) => <article key={project.id}>
      <header><span><FolderKanban size={14} /><strong>{project.name}</strong></span><em className={project.health.toLowerCase()}>{healthLabels[project.health] ?? project.health}</em></header>
      <small>{project.repository}</small>
      <div><span>{projectStatusLabels[project.status] ?? project.status}</span><span>{project.demandCount} demanda{project.demandCount === 1 ? "" : "s"}</span>{project.latestExecution && <span>{executionStatusLabels[project.latestExecution.status] ?? project.latestExecution.status}</span>}</div>
      <div className="support-project-actions"><Link href={project.href}>Abrir projeto<ArrowUpRight size={12} /></Link>{project.demandHref && <Link href={project.demandHref}>Última demanda<ArrowUpRight size={12} /></Link>}{project.executionHref && <Link href={project.executionHref}>Execução<ArrowUpRight size={12} /></Link>}</div>
    </article>)}</div>}
    {links.length > 0 && <div className="support-quick-links">{links.map((link) => <Link href={link.href} key={link.href}>{link.label}<ArrowUpRight size={12} /></Link>)}</div>}
  </div>;
}

function SupportChatSession({ locale, pathname, t }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [attachmentError, setAttachmentError] = useState("");
  const activeRequest = useRef(null);
  const fileInput = useRef(null);
  const messageList = useRef(null);
  const previewUrls = useRef(new Set());

  useEffect(() => () => activeRequest.current?.abort(), []);
  useEffect(() => () => {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current.clear();
  }, []);
  useEffect(() => { messageList.current?.scrollTo({ top: messageList.current.scrollHeight, behavior: "smooth" }); }, [messages, loading]);

  function addAttachments(files) {
    setAttachmentError("");
    try {
      const existingKeys = new Set(attachments.map(({ file }) => attachmentKey(file)));
      const candidates = Array.from(files ?? []).filter((file) => !existingKeys.has(attachmentKey(file)));
      validateAttachmentFiles([...attachments.map(({ file }) => file), ...candidates]);
      const accepted = validateAttachmentFiles(candidates).map(({ file, mimeType }) => {
        const previewUrl = isImageAttachment(mimeType) ? URL.createObjectURL(file) : null;
        if (previewUrl) previewUrls.current.add(previewUrl);
        return { file, mimeType, previewUrl };
      });
      setAttachments((current) => [...current, ...accepted]);
    } catch (error) {
      setAttachmentError(error.message);
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
        previewUrls.current.delete(selected.previewUrl);
      }
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  }

  async function send(event) {
    event.preventDefault();
    const content = text.trim();
    if ((!content && !attachments.length) || loading) return;

    const submittedAttachments = attachments;
    const next = [...messages, {
      role: "user",
      content: content || "Analise os arquivos anexados.",
      attachments: submittedAttachments.map(({ file, mimeType, previewUrl }) => ({ name: file.name, mimeType, previewUrl })),
    }];
    const controller = new AbortController();
    const formData = new FormData();
    formData.set("locale", locale);
    formData.set("currentPath", pathname);
    formData.set("messages", JSON.stringify(next.slice(-12).map(({ role, content: value }) => ({ role, content: value }))));
    submittedAttachments.forEach(({ file }) => formData.append("attachments", file, file.name));
    activeRequest.current = controller;
    setMessages(next);
    setText("");
    setAttachments([]);
    setAttachmentError("");
    setLoading(true);

    try {
      const response = await fetch("/api/support/chat", { method: "POST", signal: controller.signal, body: formData });
      const payload = await response.json();
      setMessages((current) => [...current, {
        role: "assistant",
        content: payload.answer ?? t("supportUnavailable"),
        demandReference: payload.demandReference,
        links: payload.links ?? [],
        projects: payload.projects ?? [],
      }]);
    } catch (error) {
      if (error?.name !== "AbortError") setMessages((current) => [...current, { role: "assistant", content: `${t("supportUnavailable")} Para atendimento humano, envie um e-mail para suportdashboardia@gmail.com.` }]);
    } finally {
      activeRequest.current = null;
      setLoading(false);
    }
  }

  return <div className={`support-chat ${open ? "open" : ""}`}>
    {open && <aside className="support-panel" role="dialog" aria-label={t("support")}>
      <header className="support-panel-header"><span className="support-panel-brand"><i><Bot size={18} /></i><span><strong>Assistente Dashboard IA</strong><small>Projetos, demandas e suporte</small></span></span><button onClick={() => setOpen(false)} aria-label={t("close")}><X size={17} /></button></header>
      <div className="support-messages" ref={messageList}>
        {!messages.length && <div className="support-welcome"><span><ListTodo size={18} /></span><strong>Como posso ajudar?</strong><p>Posso analisar um print, explicar uma tela ou mostrar como estão seus projetos, demandas e execuções.</p><button type="button" onClick={() => setText("Como estão meus projetos e demandas?")}>Ver meu panorama</button></div>}
        {messages.map((message, index) => <div className={`${message.role}-message${message.attachments?.length ? " has-attachments" : ""}`} key={`${message.role}-${index}`}>{message.demandReference && <small className="support-demand-reference">Demanda {message.demandReference}</small>}<span>{message.content}</span>{message.attachments?.length > 0 && <div className="support-message-attachments">{message.attachments.map((attachment, attachmentIndex) => <span className={isImageAttachment(attachment.mimeType) ? "image" : "file"} title={attachment.name} key={`${attachment.name}-${attachmentIndex}`}><AttachmentPreview attachment={attachment} />{!isImageAttachment(attachment.mimeType) && <small>{attachment.name}</small>}</span>)}</div>}<SupportNavigation links={message.links} projects={message.projects} /></div>)}
        {loading && <div className="assistant-message typing">Analisando contexto e arquivos…</div>}
      </div>
      <div className="support-panel-form"><ChatComposer
        id="support-message"
        label="Mensagem para o assistente"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onPaste={pasteAttachments}
        onSubmit={send}
        placeholder="Pergunte ou cole uma imagem…"
        maxLength={4000}
        loading={loading}
        canSubmit={Boolean(text.trim() || attachments.length)}
        submitLabel={t("send")}
        attachments={attachments.map((attachment) => ({ ...attachment, key: attachmentKey(attachment.file), name: attachment.file.name }))}
        renderAttachment={(attachment) => <AttachmentPreview attachment={attachment} />}
        onRemoveAttachment={removeAttachment}
        fileInputRef={fileInput}
        accept={ATTACHMENT_ACCEPT}
        onFilesSelected={selectAttachments}
        attachmentDisabled={attachments.length >= MAX_MESSAGE_ATTACHMENTS}
        attachmentHint={`${attachments.length}/${MAX_MESSAGE_ATTACHMENTS}`}
        error={attachmentError}
        compact
      /></div>
    </aside>}
    <button className="support-launcher" onClick={() => setOpen((value) => !value)} aria-label={t("support")}><MessageCircle size={21} /></button>
  </div>;
}

export default function SupportChat({ disabled = false }) {
  const { locale, t } = usePreferences();
  const pathname = usePathname();
  const isClient = useSyncExternalStore(subscribeToClient, () => true, () => false);
  if (disabled || !isClient) return null;
  return createPortal(<SupportChatSession key={locale} locale={locale} pathname={pathname} t={t} />, document.body);
}
