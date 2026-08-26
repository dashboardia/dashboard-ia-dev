"use client";

import { CircleAlert, ExternalLink, LoaderCircle, PauseCircle, RefreshCw, ServerCog, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import styles from "./execution-environment-shortcut.module.css";

function executionIdFromPath(pathname) {
  const match = String(pathname ?? "").match(/^\/executions\/([^/?#]+)\/?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function presentation(shortcut, control) {
  if (control?.canResume) return { tone: "paused", icon: PauseCircle, title: "Processos pausados", detail: "Você pode conversar com a IA ou reexecutar de onde parou." };
  if (shortcut?.state === "READY") return { tone: "ready", icon: ServerCog, title: "Ambiente pronto", detail: "A versão navegável desta execução está disponível." };
  if (control?.previewState === "WAITING_IMPLEMENTATION") return { tone: "repairing", icon: Sparkles, title: "Ambiente aguardando nova versão", detail: "A IA está trabalhando; o ambiente será republicado depois que a implementação terminar." };
  if (["STARTING", "PREPARING"].includes(shortcut?.state)) return { tone: "preparing", icon: LoaderCircle, title: "Preparando ambiente", detail: "Build e inicialização do ambiente acontecem automaticamente." };
  if (shortcut?.state === "FAILED") return { tone: "failed", icon: CircleAlert, title: "Ambiente com falha", detail: "A publicação falhou. Quando uma correção começar, o acompanhamento do ambiente será reiniciado automaticamente." };
  if (shortcut?.state === "EXPIRED") return {
    tone: "expired",
    icon: CircleAlert,
    title: shortcut?.manuallyStopped ? "Ambiente encerrado por você" : "Ambiente encerrado",
    detail: "O chat, a branch e todo o histórico continuam disponíveis. Suba o mesmo ambiente quando quiser navegar novamente.",
  };
  if (control?.canPause) return { tone: "processing", icon: LoaderCircle, title: control.environmentStatus || "Ambiente em processamento", detail: "Os controles da execução estão disponíveis dentro do chat." };
  if (control?.canCancel) return { tone: "processing", icon: ServerCog, title: control.environmentStatus || "Ambiente da execução", detail: "O estado do ambiente é acompanhado separadamente da execução da IA." };
  return null;
}

export default function ExecutionEnvironmentShortcut({ pathname }) {
  const executionId = useMemo(() => executionIdFromPath(pathname), [pathname]);
  const [shortcut, setShortcut] = useState(null);
  const [control, setControl] = useState(null);
  const [actionLoading, setActionLoading] = useState("");
  const [actionError, setActionError] = useState("");

  const loadState = useCallback(async (signal) => {
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
  }, [executionId]);

  useEffect(() => {
    if (!executionId) return undefined;
    const controller = new AbortController();
    let timer = null;
    const frame = window.requestAnimationFrame(() => {
      setShortcut(null);
      setControl(null);
      loadState(controller.signal);
      timer = window.setInterval(() => {
        if (document.visibilityState === "visible") loadState(controller.signal);
      }, 3_000);
    });
    return () => {
      controller.abort();
      window.cancelAnimationFrame(frame);
      if (timer !== null) window.clearInterval(timer);
    };
  }, [executionId, loadState]);

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

  async function restartEnvironment() {
    if (!executionId) return;
    setActionLoading("restart");
    setActionError("");
    try {
      const response = await fetch(`/api/executions/${encodeURIComponent(executionId)}/restart-environment`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Não foi possível concluir a operação");
      await loadState();
    } catch (error) {
      setActionError(error.message);
    } finally {
      setActionLoading("");
    }
  }

  if (!executionId) return null;
  if (control?.creditBlocked) return null;
  if (control?.previewState === "REPAIRING" || shortcut?.state === "REPAIRING") return null;
  const view = presentation(shortcut, control);
  const shouldRenderControls = Boolean(control?.canRestartEnvironment);
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
        {control?.canRestartEnvironment && <button className={styles.action} type="button" disabled={Boolean(actionLoading)} onClick={restartEnvironment}>{actionLoading === "restart" ? <LoaderCircle className={styles.spin} size={12} /> : <RefreshCw size={12} />}Subir ambiente novamente</button>}
      </div>
    </aside>
  );
}
