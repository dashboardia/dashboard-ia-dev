"use client";

import { Coins, CreditCard, LoaderCircle, PlayCircle, Send, Sparkles, Wrench } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import styles from "./execution-failure-recovery.module.css";

function executionIdFromPath(pathname) {
  const match = String(pathname ?? "").match(/^\/executions\/([^/?#]+)\/?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

const DEFAULT_RECOVERY_REQUEST = "Analise a falha desta execução, corrija a causa e continue a demanda preservando tudo que já estiver correto.";

export default function ExecutionFailureRecovery({ pathname }) {
  const router = useRouter();
  const executionId = useMemo(() => executionIdFromPath(pathname), [pathname]);
  const [recovery, setRecovery] = useState(null);
  const [content, setContent] = useState(DEFAULT_RECOVERY_REQUEST);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadRecovery = useCallback(async (signal) => {
    if (!executionId) return;
    try {
      const response = await fetch(`/api/executions/${encodeURIComponent(executionId)}/failure-recovery`, { cache: "no-store", signal });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Não foi possível verificar a recuperação da execução");
      setRecovery(result.required ? result : null);
    } catch (fetchError) {
      if (fetchError.name !== "AbortError") setRecovery(null);
    }
  }, [executionId]);

  useEffect(() => {
    if (!executionId) return undefined;
    const controller = new AbortController();
    const frame = window.requestAnimationFrame(() => loadRecovery(controller.signal));
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") loadRecovery(controller.signal);
    }, 3_000);
    return () => {
      controller.abort();
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, [executionId, loadRecovery]);

  async function resumeAfterCredits() {
    if (!executionId) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/executions/${encodeURIComponent(executionId)}/resume-after-credits`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Não foi possível continuar a execução");
      setRecovery(null);
      router.refresh();
    } catch (resumeError) {
      setError(resumeError.message);
    } finally {
      setLoading(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!executionId || !content.trim()) return;
    setLoading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.set("content", content.trim());
      const response = await fetch(`/api/executions/${encodeURIComponent(executionId)}/messages`, { method: "POST", body: formData });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Não foi possível reprocessar a execução");
      window.location.reload();
    } catch (submitError) {
      setError(submitError.message);
      setLoading(false);
    }
  }

  if (!executionId || !recovery) return null;

  if (recovery.kind === "CREDITS") {
    return <aside className={`${styles.banner} ${styles.credits}`} aria-live="polite">
      <div className={styles.icon}><Coins size={20} /></div>
      <div className={styles.copy}>
        <strong>{recovery.title}</strong>
        <span>{recovery.message}</span>
        <small>{recovery.action} A branch, o ambiente e todo o histórico foram preservados.</small>
      </div>
      <div className={styles.creditActions}>
        {recovery.canResume
          ? <button type="button" disabled={loading} onClick={resumeAfterCredits}>{loading ? <LoaderCircle className="spin" size={16} /> : <PlayCircle size={16} />}{loading ? "Retomando..." : "Continuar esta demanda"}</button>
          : <Link href={recovery.billingUrl}><CreditCard size={16} />Adicionar créditos</Link>}
        <small>{recovery.canResume ? "O saldo já foi identificado. A IA continuará do ponto em que parou." : "Após a recarga, volte para esta execução e continue sem criar uma nova demanda."}</small>
        {error && <small className={styles.error}>{error}</small>}
      </div>
    </aside>;
  }

  return <aside className={styles.banner} aria-live="polite">
    <div className={styles.icon}><Wrench size={20} /></div>
    <div className={styles.copy}>
      <strong>A execução encontrou uma falha, mas continua aberta</strong>
      <span><b>{recovery.title}</b> · {recovery.message}</span>
      <small>Você não precisa criar outra demanda. Envie uma nova interação e a IA continuará nesta mesma execução.</small>
    </div>
    <form className={styles.form} onSubmit={submit}>
      <textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={12000} aria-label="Instrução para corrigir a falha" />
      <button type="submit" disabled={loading || !content.trim()}>{loading ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}<span>{loading ? "Reprocessando..." : "Corrigir com IA"}</span>{!loading && <Send size={14} />}</button>
      <small>{recovery.adjustmentCount}/{recovery.maxAdjustments} ajustes usados</small>
    </form>
    {error && <small className={styles.error}>{error}</small>}
  </aside>;
}
