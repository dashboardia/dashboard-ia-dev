"use client";

import { CircleAlert, ExternalLink, LoaderCircle, PauseCircle, PlayCircle, ServerCog, Sparkles, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import styles from "./execution-environment-shortcut.module.css";

function executionIdFromPath(pathname) {
  const match = String(pathname ?? "").match(/^\/executions\/([^/?#]+)\/?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function presentation(shortcut, control) {
  if (control?.canResume) return { tone: "paused", icon: PauseCircle, title: "Processos pausados", detail: "Você pode conversar com a IA ou reexecutar de onde parou." };
  if (shortcut?.state === "READY") return { tone: "ready", icon: ServerCog, title: "Ambiente pronto", detail: "A versão navegável desta execução está disponível." };
  if (control?.previewState === "REPAIRING") return { tone: "repairing", icon: Sparkles, title: "Corrigindo ambiente", detail: "Uma nova tentativa de correção do ambiente está em andamento." };
  if (control?.previewState === "WAITING_IMPLEMENTATION") return { tone: "repairing", icon: Sparkles, title: "Ambiente aguardando nova versão", detail: "A IA está trabalhando; o ambiente será republicado depois que a implementação terminar." };
  if (shortcut?.state === "REPAIRING") return { tone: "repairing", icon: Sparkles, title: "Corrigindo ambiente", detail: "A falha do ambiente foi encaminhada para correção automática." };
  if (["STARTING", "PREPARING"].includes(shortcut?.state)) return { tone: "preparing", icon: LoaderCircle, title: "Preparando ambiente", detail: "Build e inicialização do ambiente acontecem automaticamente." };
  if (shortcut?.state === "FAILED") return { tone: "failed", icon: CircleAlert, title: "Ambiente com falha", detail: "A publicação falhou. Quando uma correção começar, o acompanhamento do ambiente será reiniciado automaticamente." };
  if (shortcut?.state === "EXPIRED") return { tone: "expired", icon: CircleAlert, title: "Ambiente encerrado", detail: "A execução e o histórico continuam preservados." };
  if (control?.canPause) return { tone: "processing", icon: LoaderCircle, title: control.environmentStatus || "Ambiente em processamento", detail: "Você pode pausar os processos sem cancelar a execução." };
  if (control?.canCancel) return { tone: "processing", icon: ServerCog, title: control.environmentStatus || "Ambiente da execução", detail: "O estado do ambiente é acompanhado separadamente da execução da IA." };
  return null;
}

export default function ExecutionEnvironmentShortcut({ pathname }) {
  const executionId = useMemo(() => executionIdFromPath(pathname), [pathname]);
  const [shortcut, setShortcut] = useState(null);
  const [control, setControl] = useState(null);
  const [actionLoading, setActionLoading] = useState("");
  const [actionError, setActionError] = useState("");

  async function loadState(signal) {
    if (!executionId) return;
    try {
      const [shortcutResponse, controlResponse] = await Promise.all([
        fetch(`/api/executions/${encodeURIComponent(executionId)}/environment-shortcut`, { cache: "no-store", signal }),
        fetch(`/api/executions/${encodeURIComponent(executionId)}/control-state`, { cache: "no-store", signal }),
      ]);
      const [shortcutResult, controlResult] = await Promise.all([
        shortcutResponse.json().catch(() => ({})),
        controlResponse.json().catch(() => ({})),
      ]);
      setShortcut(shortcutResponse.ok && shortcutResult.available ? shortcutResult : null);
      setControl(controlResponse.ok ? controlResult : null);
    } catch (error) {
      if (error?.name !== "AbortError") {
        setShortcut(null);
        setControl(null);
      }
    }
  }

  useEffect(() => {
    if (!executionId) {
      setShortcut(null);
      setControl(null);
      return undefined;
    }
    const controller = new AbortController();
    loadState(controller.signal);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") loadState(controller.signal);
    }, 3_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [executionId]);

  useEffect(() => {
    if (!control?.displayStatus) return;
    const statusTarget = document.querySelector(".execution-detail-page .execution-metrics > div:first-child strong");
    if (statusTarget) statusTarget.textContent = control.displayStatus;

    const live = document.querySelector(".execution-live-progress");
    if (live) {
      delete live.dataset.runtimeFocus;
      delete live.dataset.runtimeLabel;
      delete live.dataset.runtimeDetail;
    }
  }, [control]);

  async function runAction(kind) {
    if (!executionId) return;
    if (kind === "cancel" && !window.confirm("Cancelar esta execução? O ambiente e os processos ativos também serão encerrados.")) return;
    setActionLoading(kind);
    setActionError("");
    try {
      const endpoint = kind === "pause" ? "stop" : kind === "resume" ? "resume" : "cancel";
      const response = await fetch(`/api/executions/${encodeURIComponent(executionId)}/${endpoint}`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Não foi possível concluir a operação");
      await loadState();
      window.location.reload();
    } catch (error) {
      setActionError(error.message);
    } finally {
      setActionLoading("");
    }
  }

  if (!executionId) return null;
  const view = presentation(shortcut, control);
  const shouldRenderControls = Boolean(control?.canPause || control?.canResume || control?.canCancel);
  if (!view && !shouldRenderControls) return null;
  const Icon = view?.icon ?? ServerCog;
  const tone = view?.tone ?? "processing";

  return (
    <aside className={`${styles.banner} ${styles[tone]}`} aria-live="polite">
      <div className={styles.icon}><Icon className={["preparing", "processing"].includes(tone) ? styles.spin : ""} size={17} /></div>
      <div className={styles.copy}>
        <strong>{view?.title ?? control?.environmentStatus ?? "Ambiente"}</strong>
        <span>{view?.detail ?? "Acompanhe o ambiente desta execução."}</span>
        {actionError && <small className={styles.error}>{actionError}</small>}
      </div>
      <div className={styles.actions}>
        {shortcut?.state === "READY" && shortcut.url && <a className={styles.action} href={shortcut.url} target="_blank" rel="noreferrer">Abrir<ExternalLink size={12} /></a>}
        {control?.canPause && <button className={styles.secondary} type="button" disabled={Boolean(actionLoading)} onClick={() => runAction("pause")}>{actionLoading === "pause" ? <LoaderCircle className={styles.spin} size={12} /> : <PauseCircle size={12} />}Parar</button>}
        {control?.canResume && <button className={styles.action} type="button" disabled={Boolean(actionLoading)} onClick={() => runAction("resume")}>{actionLoading === "resume" ? <LoaderCircle className={styles.spin} size={12} /> : <PlayCircle size={12} />}Reexecutar</button>}
        {control?.canCancel && <button className={styles.danger} type="button" disabled={Boolean(actionLoading)} onClick={() => runAction("cancel")}>{actionLoading === "cancel" ? <LoaderCircle className={styles.spin} size={12} /> : <XCircle size={12} />}Cancelar</button>}
      </div>
    </aside>
  );
}
