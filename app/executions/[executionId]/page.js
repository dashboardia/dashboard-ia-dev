import { Activity, Clock3, Code2, GitBranch, Images, TerminalSquare, Zap } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import AppShell from "../../../components/app-shell";
import AutoRefresh from "../../../components/auto-refresh";
import SectionHeader from "../../../components/section-header";
import { getProjectRole } from "../../../lib/access";
import { db } from "../../../lib/db";
import { requirePageUser } from "../../../lib/page-access";
import { redactSensitiveData } from "../../../lib/redaction";
import { explainError, logLevelLabels, logScopeLabels } from "../../../lib/error-messages";
import { formatDateTime, getGlobalSettings } from "../../../lib/global-settings";
import CancelExecutionButton from "../../demands/[demandId]/cancel-execution-button";
import OpenPullRequestButton from "../../demands/[demandId]/open-pull-request-button";

/* eslint-disable @next/next/no-img-element -- imagens privadas e de altura variável servidas por rota autenticada */

const cancellableStatuses = ["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL"];

function duration(execution) {
  if (!execution.startedAt) return "Não iniciada";
  const end = execution.finishedAt ?? new Date();
  const seconds = Math.max(0, Math.round((end.getTime() - execution.startedAt.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}min ${remaining}s`;
}

export const dynamic = "force-dynamic";

export default async function ExecutionPage({ params }) {
  const user = await requirePageUser();
  const { executionId } = await params;
  const settings = await getGlobalSettings();
  const execution = await db.execution.findUnique({
    where: { id: executionId },
    include: {
      demand: { include: { project: true } },
      requestedBy: { select: { name: true, githubLogin: true } },
      approvedBy: { select: { name: true, githubLogin: true } },
      logs: { orderBy: { createdAt: "asc" } },
      artifacts: { orderBy: { createdAt: "asc" } },
      pullRequest: true,
    },
  });
  if (!execution) notFound();
  const role = await getProjectRole(user, execution.demand.projectId);
  if (!role) redirect("/executions");
  const diff = execution.artifacts.find((artifact) => artifact.type === "diff");
  const visualArtifacts = execution.artifacts.filter((artifact) => artifact.type === "visual");
  const canCancel = role === "MANAGER" && cancellableStatuses.includes(execution.status) && !execution.cancelRequestedAt;
  const canOpenPullRequest = role === "MANAGER" && execution.status === "WAITING_APPROVAL" && !execution.cancelRequestedAt;
  const live = cancellableStatuses.includes(execution.status) && !execution.cancelRequestedAt;
  const explainedError = execution.error ? explainError(execution.error) : null;

  return (
    <AppShell user={user}>
      <div className="section-page execution-detail-page">
        <AutoRefresh active={live} />
        <SectionHeader
          backHref="/executions"
          eyebrow={`${execution.demand.project.name} · ${execution.stage}`}
          title={execution.demand.title}
          description={`Execução ${execution.id.slice(-10)} · solicitada por ${execution.requestedBy.name ?? execution.requestedBy.githubLogin}`}
          action={<div className="execution-header-actions">{canOpenPullRequest && <OpenPullRequestButton executionId={execution.id} />}{canCancel && <CancelExecutionButton executionId={execution.id} />}</div>}
        />

        <section className="execution-metrics">
          <div><Activity size={17} /><span><small>Status</small><strong>{execution.cancelRequestedAt && execution.status !== "CANCELLED" ? "CANCELAMENTO SOLICITADO" : execution.status}</strong></span></div>
          <div><GitBranch size={17} /><span><small>Branch</small><strong>{execution.branchName ?? "Aguardando worker"}</strong></span></div>
          <div><Clock3 size={17} /><span><small>Duração</small><strong>{duration(execution)}</strong></span></div>
          <div><Zap size={17} /><span><small>Tokens</small><strong>{(execution.inputTokens ?? 0) + (execution.outputTokens ?? 0) || "—"}</strong></span></div>
        </section>

        <div className="execution-review-grid">
          <section className="form-card detail-card execution-summary-card">
            <div className="card-heading"><div><h2>Resultado</h2><p>Resumo produzido pelo agente</p></div><Code2 size={20} /></div>
            <p>{execution.summary ?? "O resumo ficará disponível quando o agente concluir a implementação."}</p>
            {explainedError && <div className="execution-error-box"><strong>{explainedError.title}</strong><p>{explainedError.message}</p><small>{explainedError.action}</small><details><summary>Ver detalhes técnicos</summary><pre>{explainedError.technical}</pre></details></div>}
            <div className="execution-links"><Link href={`/demands/${execution.demandId}`}>Ver demanda original</Link>{execution.pullRequest && <a href={execution.pullRequest.url} target="_blank" rel="noreferrer">Abrir PR #{execution.pullRequest.externalNumber}</a>}</div>
          </section>

          <section className="form-card detail-card execution-summary-card">
            <div className="card-heading"><div><h2>Referências Git</h2><p>Rastreabilidade da alteração</p></div><GitBranch size={20} /></div>
            <div className="commit-list"><span><small>Base</small><code>{execution.baseSha ?? "—"}</code></span><span><small>Resultado</small><code>{execution.headSha ?? "—"}</code></span><span><small>Modelo</small><code>{execution.model ?? "—"}</code></span></div>
          </section>
        </div>

        <section className="form-card detail-card full-card execution-log-card">
          <div className="card-heading"><div><h2>Logs da execução</h2><p>{execution.logs.length} eventos registrados em ordem cronológica</p></div><TerminalSquare size={20} /></div>
          <div className="execution-timeline">{execution.logs.map((entry) => { const logError = entry.level === "error" ? explainError(entry.message) : null; return <div key={entry.id}><span className={`log-level ${entry.level}`}>{logLevelLabels[entry.level] ?? entry.level}</span><time>{formatDateTime(entry.createdAt, settings.timeZone)}</time><strong>{logScopeLabels[entry.scope] ?? entry.scope}</strong><p>{logError ? `${logError.title}. ${logError.action}` : redactSensitiveData(entry.message)}</p>{entry.metadata && <details><summary>Ver detalhes técnicos</summary><pre>{redactSensitiveData(JSON.stringify(entry.metadata, null, 2))}</pre></details>}</div>; })}{!execution.logs.length && <div className="list-empty">Aguardando eventos do worker.</div>}</div>
        </section>

        {execution.demand.visualValidation && <section className="form-card detail-card full-card">
          <div className="card-heading"><div><h2>Validação visual</h2><p>Evidências opcionais da interface; a aprovação do código permanece separada.</p></div><Images size={20} /></div>
          {visualArtifacts.length ? <div className="visual-evidence-grid">{visualArtifacts.map((artifact) => <figure className="visual-evidence" key={artifact.id}><img src={`/api/artifacts/${artifact.id}`} alt={`${artifact.metadata?.source === "before" ? "Antes" : "Depois"} — ${artifact.metadata?.route ?? "/"} — ${artifact.metadata?.viewport ?? "tela"}`} loading="lazy" /><figcaption><strong>{artifact.metadata?.source === "before" ? "Antes" : "Depois"}</strong><span>{artifact.metadata?.route ?? "/"} · {artifact.metadata?.viewport === "mobile" ? "Celular" : "Desktop"}</span></figcaption></figure>)}</div> : <div className="list-empty">As evidências aparecerão após a etapa de validação.</div>}
        </section>}

        <section className="form-card detail-card full-card execution-diff-card">
          <div className="card-heading"><div><h2>Diff para revisão</h2><p>Alterações exatas geradas antes da abertura do Pull Request</p></div><Code2 size={20} /></div>
          {diff?.content ? <pre>{diff.content}</pre> : <div className="list-empty">O diff ficará disponível após as validações.</div>}
        </section>
      </div>
    </AppShell>
  );
}
