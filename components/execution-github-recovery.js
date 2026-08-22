"use client";

import { ExternalLink, Github, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import styles from "./execution-github-recovery.module.css";

function executionIdFromPath(pathname) {
  const match = String(pathname ?? "").match(/^\/executions\/([^/?#]+)\/?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export default function ExecutionGitHubRecovery({ pathname }) {
  const executionId = useMemo(() => executionIdFromPath(pathname), [pathname]);
  const [recovery, setRecovery] = useState(null);
  const [checking, setChecking] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [authorizationOpened, setAuthorizationOpened] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!executionId) {
      setRecovery(null);
      return undefined;
    }
    const controller = new AbortController();
    setChecking(true);
    setError("");
    fetch(`/api/executions/${encodeURIComponent(executionId)}/github-recovery`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error ?? "Não foi possível verificar a autorização do GitHub");
        setRecovery(result.required ? result : null);
      })
      .catch((fetchError) => {
        if (fetchError.name !== "AbortError") setRecovery(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, [executionId]);

  async function retryExecution() {
    if (!executionId) return;
    setRetrying(true);
    setError("");
    try {
      const response = await fetch(`/api/executions/${encodeURIComponent(executionId)}/github-recovery`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Não foi possível reprocessar a execução");
      if (!result.executionId) throw new Error("O reprocessamento não retornou uma execução válida");
      window.location.assign(`/executions/${result.executionId}`);
    } catch (retryError) {
      setError(retryError.message);
      setRetrying(false);
    }
  }

  if (!executionId || checking || !recovery) return null;

  return <aside className={styles.banner} aria-live="polite">
    <div className={styles.icon}><ShieldCheck size={20} /></div>
    <div className={styles.copy}>
      <strong>GitHub precisa de autorização para publicar</strong>
      <span>Autorize o GitHub App para <b>{recovery.repositoryFullName}</b>. No GitHub, selecione o repositório e clique em <b>Save</b> antes de voltar.</span>
      {authorizationOpened && <small>Autorização aberta em uma nova aba. Confirme o repositório, clique em Save e depois volte aqui para reprocessar.</small>}
      {error && <small className={styles.error}>{error}</small>}
    </div>
    <div className={styles.actions}>
      {recovery.installUrl && <a className={styles.authorize} href={recovery.installUrl} target="_blank" rel="noreferrer" onClick={() => setAuthorizationOpened(true)}><Github size={16} />Autorizar GitHub<ExternalLink size={14} /></a>}
      <button className={styles.retry} type="button" onClick={retryExecution} disabled={retrying}>{retrying ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}{retrying ? "Verificando autorização..." : "Já autorizei · Reprocessar"}</button>
    </div>
  </aside>;
}
