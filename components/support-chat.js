"use client";

import { Bot, ImagePlus, MessageCircle, Send, Trash2, X } from "lucide-react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { usePreferences } from "./preferences-provider";

const MAX_ATTACHMENTS = 3;
const MAX_IMAGE_BYTES = 1_500_000;
const subscribeToClient = () => () => {};

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, dataUrl: reader.result });
    reader.onerror = () => reject(new Error(`Não foi possível ler ${file.name}`));
    reader.readAsDataURL(file);
  });
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

  useEffect(() => () => activeRequest.current?.abort(), []);
  useEffect(() => { messageList.current?.scrollTo({ top: messageList.current.scrollHeight, behavior: "smooth" }); }, [messages, loading]);

  async function selectAttachments(event) {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    setAttachmentError("");
    const available = Math.max(0, MAX_ATTACHMENTS - attachments.length);
    const accepted = selected.slice(0, available).filter((file) => {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
        setAttachmentError("Envie somente imagens PNG, JPG ou WEBP.");
        return false;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setAttachmentError(`Cada print pode ter até ${(MAX_IMAGE_BYTES / 1_000_000).toLocaleString("pt-BR")} MB.`);
        return false;
      }
      return true;
    });
    try {
      const prepared = await Promise.all(accepted.map(readImage));
      setAttachments((current) => [...current, ...prepared].slice(0, MAX_ATTACHMENTS));
    } catch (error) {
      setAttachmentError(error.message);
    }
  }

  async function send(event) {
    event.preventDefault();
    const content = text.trim();
    if (!content || loading) return;

    const submittedAttachments = attachments;
    const next = [...messages, { role: "user", content, attachments: submittedAttachments }];
    const controller = new AbortController();
    activeRequest.current = controller;
    setMessages(next);
    setText("");
    setAttachments([]);
    setAttachmentError("");
    setLoading(true);

    try {
      const response = await fetch("/api/support/chat", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale, currentPath: pathname, messages: next.slice(-12).map(({ role, content: value }) => ({ role, content: value })), attachments: submittedAttachments }),
      });
      const payload = await response.json();
      setMessages((current) => [...current, { role: "assistant", content: payload.answer ?? t("supportUnavailable"), demandReference: payload.demandReference }]);
    } catch (error) {
      if (error?.name !== "AbortError") {
        setMessages((current) => [...current, { role: "assistant", content: `${t("supportUnavailable")} Para atendimento humano, envie um e-mail para suportdashboardia@gmail.com.` }]);
      }
    } finally {
      activeRequest.current = null;
      setLoading(false);
    }
  }

  return <div className={`support-chat ${open ? "open" : ""}`}>
    {open && <aside className="support-panel" role="dialog" aria-label={t("support")}>
      <header className="support-panel-header"><span><Bot size={18} /><strong>{t("support")}</strong></span><button onClick={() => setOpen(false)} aria-label={t("close")}><X size={17} /></button></header>
      <div className="support-messages" ref={messageList}>
        {!messages.length && <div className="assistant-message">Sou o agente de suporte do Dashboardia. Explique o problema, informe o número da demanda ou envie um print para eu analisar.</div>}
        {messages.map((message, index) => <div className={`${message.role}-message`} key={`${message.role}-${index}`}>{message.demandReference && <small className="support-demand-reference">Demanda {message.demandReference}</small>}<span>{message.content}</span>{message.attachments?.length > 0 && <div className="support-message-images">{message.attachments.map((attachment, imageIndex) => <Image unoptimized src={attachment.dataUrl} alt={attachment.name} width={92} height={64} key={`${attachment.name}-${imageIndex}`} />)}</div>}</div>)}
        {loading && <div className="assistant-message typing">Analisando contexto e informações…</div>}
      </div>
      <form className="support-panel-form" onSubmit={send}>
        {attachments.length > 0 && <div className="support-attachment-list">{attachments.map((attachment, index) => <span key={`${attachment.name}-${index}`}><Image unoptimized src={attachment.dataUrl} alt={attachment.name} width={42} height={42} /><small>{attachment.name}</small><button type="button" onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remover ${attachment.name}`}><Trash2 size={12} /></button></span>)}</div>}
        {attachmentError && <small className="support-attachment-error">{attachmentError}</small>}
        <div className="support-composer"><input ref={fileInput} hidden type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={selectAttachments} /><button className="support-attach" type="button" onClick={() => fileInput.current?.click()} disabled={loading || attachments.length >= MAX_ATTACHMENTS} aria-label="Anexar prints"><ImagePlus size={17} /></button><textarea maxLength={4000} rows={2} value={text} onChange={(event) => setText(event.target.value)} placeholder="Descreva o problema ou informe a demanda…" /><button className="support-send" disabled={loading || !text.trim()} aria-label={t("send")}><Send size={16} /></button></div>
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
