"use client";

import { CheckCircle2, CircleDotDashed, CircleX, ExternalLink, ServerCog, Wrench } from "lucide-react";
import { useEffect, useState } from "react";

import styles from "./execution-environment-activity.module.css";

const stateLabel = {
  STARTING: "Preparando ambiente",
  PREPARING: "Subindo ambiente",
  REPAIRING: "IA corrigindo o ambiente",
  READY: "Ambiente pronto",
  FAILED: "Ambiente com falha",
  EXPIRED: "Ambiente expirado",
};

function genericActivity(state) {
  const messages = {
    STARTING: "Aguardando o início da publicação automática.",
    PREPARING: "Build, dependências e inicialização estão sendo executados.",
    REPAIRING: "A falha foi enviada automaticamente para a IA e a mesma execução está sendo corrigida.",
    READY: "O ambiente está pronto para navegação.",
    FAILED: "A publicação não pôde ser concluída automaticamente.",
    EXPIRED: "O ambiente temporário expirou.",
  };
  return [{ key: state, message: messages[state] ?? "Atualizando ambiente.", status: state === "FAILED" ? "FAILED" : state === "READY" ? "COMPLETED" : "RUNNING" }];
}

function StepIcon({ status }) {
  if (status === "FAILED") return <CircleX size={13} />;
  if (status === "COMPLETED") return <CheckCircle2 size={13} />;
  return <CircleDotDashed className="spin-slow" size={13} />;
}

export default function ExecutionEnvironmentActivity({ executionId }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/executions/${encodeURIComponent(executionId)}/environment-shortcut`, { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (!cancelled) setData(response.ok && result.available ? result : null);
      } catch {
        if (!cancelled) setData(null);
      }
    }
    load();
    const timer = window.setInterval(load, 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [executionId]);

  if (!data?.available) return null;
  const activity = data.activity?.length ? data.activity : genericActivity(data.state);
  const latest = activity.slice(-6);

  return <section className={`${styles.card} ${styles[data.state?.toLowerCase()] ?? ""}`}>
    <header className={styles.header}>
      <span className={styles.icon}>{data.state === "REPAIRING" ? <Wrench size={15} /> : <ServerCog size={15} />}</span>
      <div><strong>{stateLabel[data.state] ?? "Ambiente automático"}</strong><small>A própria execução publica, testa e corrige o ambiente.</small></div>
      <em>{data.state === "READY" ? "PRONTO" : data.state === "REPAIRING" ? "CORRIGINDO" : data.state === "FAILED" ? "FALHOU" : "AUTOMÁTICO"}</em>
    </header>
    <ol className={styles.timeline}>
      {latest.map((item) => <li className={item.status === "FAILED" ? styles.failed : item.status === "COMPLETED" ? styles.completed : styles.running} key={`${item.key}-${item.at ?? ""}`}>
        <StepIcon status={item.status} />
        <span><strong>{item.message}</strong>{item.at && <small>{new Date(item.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</small>}</span>
      </li>)}
    </ol>
    {data.state === "READY" && data.url && <a className={styles.open} href={data.url} target="_blank" rel="noreferrer"><ExternalLink size={14} />Abrir ambiente pronto</a>}
    {data.state === "REPAIRING" && <p className={styles.note}>Você não precisa fazer nada agora. O erro do ambiente já foi enviado para a IA nesta mesma execução.</p>}
    {data.state === "FAILED" && <p className={styles.note}>A correção automática não conseguiu concluir a publicação. Os detalhes permanecem disponíveis no histórico da execução.</p>}
  </section>;
}
