"use client";

import { CircleAlert, ExternalLink, LoaderCircle, ServerCog, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import styles from "./execution-environment-shortcut.module.css";

function executionIdFromPath(pathname) {
  const match = String(pathname ?? "").match(/^\/executions\/([^/?#]+)\/?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function presentation(shortcut) {
  if (shortcut.state === "READY") return {
    tone: "ready",
    icon: ServerCog,
    title: "Ambiente pronto",
    detail: "A versão navegável desta execução está disponível.",
  };
  if (shortcut.state === "REPAIRING") return {
    tone: "repairing",
    icon: Sparkles,
    title: "IA corrigindo o ambiente",
    detail: "A falha foi enviada automaticamente para a IA.",
  };
  if (["STARTING", "PREPARING"].includes(shortcut.state)) return {
    tone: "preparing",
    icon: LoaderCircle,
    title: "Preparando ambiente",
    detail: "Build e inicialização acontecem automaticamente.",
  };
  if (shortcut.state === "FAILED") return {
    tone: "failed",
    icon: CircleAlert,
    title: "Ambiente não ficou disponível",
    detail: "A execução continua aberta. Se houver saldo, a IA tenta a correção automaticamente.",
  };
  return {
    tone: "expired",
    icon: CircleAlert,
    title: "Ambiente expirado",
    detail: "A execução e o histórico continuam preservados.",
  };
}

export default function ExecutionEnvironmentShortcut({ pathname }) {
  const executionId = useMemo(() => executionIdFromPath(pathname), [pathname]);
  const [shortcut, setShortcut] = useState(null);

  useEffect(() => {
    if (!executionId) {
      setShortcut(null);
      return undefined;
    }

    let cancelled = false;
    async function loadShortcut() {
      try {
        const response = await fetch(`/api/executions/${encodeURIComponent(executionId)}/environment-shortcut`, { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (!cancelled && response.ok) setShortcut(result.available ? result : null);
      } catch {
        if (!cancelled) setShortcut(null);
      }
    }

    loadShortcut();
    const timer = window.setInterval(loadShortcut, 4_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [executionId]);

  if (!executionId || !shortcut?.available) return null;
  const view = presentation(shortcut);
  const Icon = view.icon;

  return (
    <aside className={`${styles.banner} ${styles[view.tone]}`} aria-live="polite">
      <div className={styles.icon}><Icon className={view.tone === "preparing" ? styles.spin : ""} size={17} /></div>
      <div className={styles.copy}>
        <strong>{view.title}</strong>
        <span>{view.detail}</span>
      </div>
      {shortcut.state === "READY" && shortcut.url && <a className={styles.action} href={shortcut.url} target="_blank" rel="noreferrer">
        Abrir<ExternalLink size={12} />
      </a>}
    </aside>
  );
}
