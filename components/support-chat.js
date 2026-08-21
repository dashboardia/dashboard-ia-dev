"use client";

import { Bot, FileText, MessageCircle, Paperclip, Send, Trash2, X } from "lucide-react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { ATTACHMENT_ACCEPT, isImageAttachment, MAX_MESSAGE_ATTACHMENTS, validateAttachmentFiles } from "../lib/attachments";
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
      setMessages((current) => [...current, { role: "assistant", content: payload.answer ?? t("supportUnavailable"), demandReference: payload.demandReference }]);
    } catch (error) {
      if (error?.name !== "AbortError") setMessages((current) => [...current, { role: "assistant", content: `${t("supportUnavailable")} Para atendimento humano, envie um e-mail para suportdashboardia@gmail.com.` }]);
    } finally {
      activeRequest.current = null;
      setLoading(false);
    }
  }

  return <div className={`support-chat ${open ? "open" : ""}`}>
    {open && <aside className="support-panel" role="dialog" aria-label={t("support")}>
      <header className="support-panel-header"><span><Bot size={18} /><strong>{t("support")}</strong></span><button onClick={() => setOpen(false)} aria-label={t("close")}><X size={17} /></button></header>
      <div className="support-messages" ref={messageList}>
        {!messages.length && <div className="assistant-message">Sou o agente de suporte do Dashboardia. Explique o problema, cole um print ou anexe um arquivo pequeno para eu analisar.</div>}
        {messages.map((message, index) => <div className={`${message.role}-message`} key={`${message.role}-${index}`}>{message.demandReference && <small className="support-demand-reference">Demanda {message.demandReference}</small>}<span>{message.content}</span>{message.attachments?.length > 0 && <div className="support-message-attachments">{message.attachments.map((attachment, attachmentIndex) => <span key={`${attachment.name}-${attachmentIndex}`}><AttachmentPreview attachment={attachment} /><small>{attachment.name}</small></span>)}</div>}</div>)}
        {loading && <div className="assistant-message typing">Analisando contexto e arquivos…</div>}
      </div>
      <form className="support-panel-form" onSubmit={send}>
        {attachments.length > 0 && <div className="support-attachment-list">{attachments.map((attachment, index) => <span key={attachmentKey(attachment.file)}><AttachmentPreview attachment={attachment} compact /><small>{attachment.file.name}</small><button type="button" onClick={() => removeAttachment(index)} aria-label={`Remover ${attachment.file.name}`}><Trash2 size={12} /></button></span>)}</div>}
        {attachmentError && <small className="support-attachment-error">{attachmentError}</small>}
        <div className="support-composer"><input ref={fileInput} hidden type="file" accept={ATTACHMENT_ACCEPT} multiple onChange={selectAttachments} /><button className="support-attach" type="button" onClick={() => fileInput.current?.click()} disabled={loading || attachments.length >= MAX_MESSAGE_ATTACHMENTS} aria-label="Anexar arquivos"><Paperclip size={17} /></button><textarea maxLength={4000} rows={2} value={text} onPaste={pasteAttachments} onChange={(event) => setText(event.target.value)} placeholder="Descreva o problema, cole um print ou anexe arquivos…" /><button className="support-send" disabled={loading || (!text.trim() && !attachments.length)} aria-label={t("send")}><Send size={16} /></button></div>
        <small className="support-attachment-hint">Até 4 arquivos · 5 MB cada · imagens, PDF, Word, Excel, CSV ou TXT</small>
      </form>
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
