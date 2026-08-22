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
  if (shortcut?.state === "REPAIRING") return { tone: "repairing", icon: Sparkles, title: "IA corrigindo o ambiente", detail: "A falha foi enviada automaticamente para a IA." };
  if (shortcut?.state === "WAITING_IMPLEMENTATION") return { tone: "processing", icon: LoaderCircle, title: "IA aplicando novo ajuste", detail: "Ao concluir, o ambiente será publicado novamente automaticamente." };
  if (["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL"].includes(control?.status)) return { tone: "processing", icon: LoaderCircle, title: control?.status === "WAITING_APPROVAL" ? "Publicando novo resultado" : "IA aplicando novo ajuste", detail: "O ambiente será atualizado automaticamente quando esta etapa terminar." };
  if (shortcut?.state === "READY") return { tone: "ready", icon: ServerCog, title: "Ambiente pronto", detail: "A versão navegável desta execução está disponível." };
  if (["STARTING", "PREPARING"].includes(shortcut?.state)) return { tone: "preparing", icon: LoaderCircle, title: "Preparando ambiente", detail: "Build e inicialização acontecem automaticamente." };
  if (shortcut?.state === "FAILED") return { tone: "failed", icon: CircleAlert, title: "Ambiente não ficou disponível", detail: "A execução continua preservada e a correção automática será tentada quando possível." };
  if (shortcut?.state === "EXPIRED") return { tone: "expired", icon: CircleAlert, title: "Ambiente encerrado", detail: "A execução e o histórico continuam preservados." };
  if (control?.canPause) return { tone: "processing", icon: LoaderCircle, title: control.displayStatus || "Processamento em andamento", detail: "Você pode pausar os processos sem cancelar a execução." };
  if (control?.canCancel) return { tone: "processing", icon: ServerCog, title: control.displayStatus || "Execução em andamento", detail: "Você pode cancelar esta execução a qualquer momento." };
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

    const liveTitle = document.querySelector(".execution-live-progress header strong");
    const liveSubtitle = document.querySelector(".execution-live-progress header small");
    if (!liveTitle || !liveSubtitle) return;
    if (["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL"].includes(control.status) && control.previewState === "WAITING_IMPLEMENTATION") {
      liveTitle.textContent = "IA aplicando novo ajuste";
      liveSubtitle.textContent = "A versão anterior não é mais o resultado atual. Quando a IA terminar, o ambiente será publicado novamente automaticamente.";
    } else if (control.awaitingEnvironment) {
      liveTitle.textContent = ["REPAIRING", "FAILED"].includes(control.previewState) ? "Corrigindo ambiente" : "Preparando ambiente";
      liveSubtitle.textContent = "A execução só será liberada para novos ajustes quando a versão navegável estiver pronta.";
    } else if (control.status === "STOPPED") {
      liveTitle.textContent = "Processos pausados";
      liveSubtitle.textContent = "O trabalho foi preservado. Você pode conversar com a IA ou reexecutar de onde parou.";
    } else if (control.status === "AWAITING_CLIENT" && control.interactionAvailable) {
      liveTitle.textContent = "Aguardando você";
      liveSubtitle.textContent = "O ambiente está pronto. Teste o resultado e peça novos ajustes pelo chat quando quiser.";
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
        <strong>{view?.title ?? control?.displayStatus ?? "Execução"}</strong>
        <span>{view?.detail ?? "Controle os processos desta execução."}</span>
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
