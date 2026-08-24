"use client";

import { CheckCircle2, CircleAlert, CircleDotDashed, CircleX, ExternalLink, ServerCog, Wrench } from "lucide-react";
import { useEffect, useState } from "react";

import styles from "./execution-environment-activity.module.css";

const stateLabel = {
  STARTING: "Preparando ambiente",
  PREPARING: "Subindo ambiente",
  WAITING_IMPLEMENTATION: "Aguardando a IA concluir",
  REPAIRING: "IA corrigindo o ambiente",
  READY: "Ambiente pronto",
  FAILED: "Ambiente com falha",
  EXPIRED: "Ambiente encerrado",
};

function genericActivity(state) {
  const messages = {
    STARTING: "Aguardando o início da publicação automática.",
    PREPARING: "Build, dependências e inicialização estão sendo executados.",
    WAITING_IMPLEMENTATION: "A IA está aplicando a nova interação. Assim que concluir, o ambiente será publicado novamente automaticamente.",
    REPAIRING: "A falha foi enviada automaticamente para a IA e a mesma execução está sendo corrigida.",
    READY: "O ambiente está pronto para navegação.",
    FAILED: "A publicação não pôde ser concluída automaticamente.",
    EXPIRED: "O ambiente temporário foi encerrado.",
  };
  return [{
    key: state,
    message: messages[state] ?? "Atualizando ambiente.",
    status: state === "FAILED" ? "FAILED" : ["READY", "EXPIRED"].includes(state) ? "COMPLETED" : "RUNNING",
    terminal: state === "EXPIRED",
  }];
}

function StepIcon({ status, terminal }) {
  if (terminal) return <CircleAlert size={14} />;
  if (status === "FAILED") return <CircleX size={14} />;
  if (status === "COMPLETED") return <CheckCircle2 size={14} />;
  return <CircleDotDashed className="spin-slow" size={14} />;
}

function stateBadge(state) {
  if (state === "READY") return "PRONTO";
  if (state === "WAITING_IMPLEMENTATION") return "AGUARDANDO IA";
  if (state === "REPAIRING") return "CORRIGINDO";
  if (state === "FAILED") return "FALHOU";
  if (state === "EXPIRED") return "ENCERRADO";
  return "AUTOMÁTICO";
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
      <span className={styles.icon}>{data.state === "REPAIRING" ? <Wrench size={16} /> : <ServerCog size={16} />}</span>
      <div><strong>{stateLabel[data.state] ?? "Ambiente automático"}</strong><small>{data.state === "WAITING_IMPLEMENTATION" ? "A nova interação ainda está sendo implementada; esta versão será republicada depois." : "A própria execução publica, testa e corrige o ambiente."}</small></div>
      <em>{stateBadge(data.state)}</em>
    </header>
    <ol className={styles.timeline}>
      {latest.map((item) => <li className={item.status === "FAILED" ? styles.failed : item.status === "COMPLETED" ? styles.completed : styles.running} key={`${item.key}-${item.at ?? ""}`}>
        <StepIcon status={item.status} terminal={item.terminal} />
        <span><strong>{item.message}</strong>{item.at && <small>{new Date(item.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</small>}</span>
      </li>)}
    </ol>
    {data.state === "READY" && data.url && <a className={styles.open} href={data.url} target="_blank" rel="noreferrer"><ExternalLink size={15} />Abrir ambiente pronto</a>}
    {data.state === "WAITING_IMPLEMENTATION" && <p className={styles.note}>A versão anterior não representa mais o último pedido. Aguarde a IA concluir: o Dashboard IA publicará e validará novamente o ambiente automaticamente.</p>}
    {data.state === "REPAIRING" && <p className={styles.note}>Você não precisa fazer nada agora. O erro do ambiente já foi enviado para a IA nesta mesma execução.</p>}
    {data.state === "FAILED" && <p className={styles.note}>A correção automática não conseguiu concluir a publicação. Os detalhes permanecem disponíveis no histórico da execução.</p>}
    {data.state === "EXPIRED" && <p className={styles.note}>O ambiente foi encerrado, mas o chat, a branch e todo o histórico continuam disponíveis.</p>}
  </section>;
}
