"use client";

import { Bot, MessageCircle, Send, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { usePreferences } from "./preferences-provider";

export default function SupportChat({ disabled = false }) {
  const { locale, t } = usePreferences();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([]);
  if (disabled) return null;

  async function send(event) {
    event.preventDefault();
    const content = text.trim();
    if (!content || loading) return;
    const next = [...messages, { role: "user", content }];
    setMessages(next);
    setText("");
    setLoading(true);
    try {
      const response = await fetch("/api/support/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale, currentPath: pathname, messages: next.slice(-12) }) });
      const payload = await response.json();
      setMessages((current) => [...current, { role: "assistant", content: payload.answer ?? "Não foi possível responder agora." }]);
    } catch {
      setMessages((current) => [...current, { role: "assistant", content: "Não foi possível responder agora." }]);
    } finally { setLoading(false); }
  }

  return <div className={`support-chat ${open ? "open" : ""}`}>{open && <section><header><span><Bot size={18} /><strong>{t("support")}</strong></span><button onClick={() => setOpen(false)} aria-label={t("close")}><X size={17} /></button></header><div className="support-messages">{!messages.length && <div className="assistant-message">{t("supportIntro")}</div>}{messages.map((message, index) => <div className={`${message.role}-message`} key={`${message.role}-${index}`}>{message.content}</div>)}{loading && <div className="assistant-message typing">•••</div>}</div><form onSubmit={send}><input maxLength={800} value={text} onChange={(event) => setText(event.target.value)} placeholder={t("askPlaceholder")} /><button disabled={loading || !text.trim()} aria-label={t("send")}><Send size={16} /></button></form><small>{t("assistantDisclaimer")}</small></section>}<button className="support-launcher" onClick={() => setOpen((value) => !value)} aria-label={t("support")}><MessageCircle size={21} /></button></div>;
}
