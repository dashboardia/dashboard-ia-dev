"use client";

import { ArrowRight, ServerCog } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import styles from "./execution-environment-shortcut.module.css";

function executionIdFromPath(pathname) {
  const match = String(pathname ?? "").match(/^\/executions\/([^/?#]+)\/?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
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
    const timer = window.setInterval(loadShortcut, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [executionId]);

  if (!executionId || !shortcut?.available) return null;

  return (
    <aside className={styles.banner} aria-live="polite">
      <div className={styles.icon}><ServerCog size={19} /></div>
      <div className={styles.copy}>
        <strong>Ambiente disponível para esta execução</strong>
        <span>A branch já foi publicada no GitHub. Você pode subir uma versão navegável para testar o resultado.</span>
      </div>
      <Link className={styles.action} href={{ pathname: "/environments", query: { projectId: shortcut.projectId, branch: shortcut.branchName } }}>
        <ServerCog size={15} />Subir ambiente<ArrowRight size={14} />
      </Link>
    </aside>
  );
}
