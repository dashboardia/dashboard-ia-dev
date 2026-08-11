import { Activity, Clock3, Code2, GitBranch, TerminalSquare, Zap } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import AppShell from "../../../components/app-shell";
import SectionHeader from "../../../components/section-header";
import { getProjectRole } from "../../../lib/access";
import { db } from "../../../lib/db";
import { requirePageUser } from "../../../lib/page-access";
import CancelExecutionButton from "../../demands/[demandId]/cancel-execution-button";
import OpenPullRequestButton from "../../demands/[demandId]/open-pull-request-button";

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
  const canCancel = role === "MANAGER" && cancellableStatuses.includes(execution.status) && !execution.cancelRequestedAt;
  const canOpenPullRequest = role === "MANAGER" && execution.status === "WAITING_APPROVAL" && !execution.cancelRequestedAt;

  return (
    <AppShell user={user}>
      <div className="section-page execution-detail-page">
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
            {execution.error && <div className="execution-error-box">{execution.error}</div>}
            <div className="execution-links"><Link href={`/demands/${execution.demandId}`}>Ver demanda original</Link>{execution.pullRequest && <a href={execution.pullRequest.url} target="_blank" rel="noreferrer">Abrir PR #{execution.pullRequest.externalNumber}</a>}</div>
          </section>

          <section className="form-card detail-card execution-summary-card">
            <div className="card-heading"><div><h2>Referências Git</h2><p>Rastreabilidade da alteração</p></div><GitBranch size={20} /></div>
            <div className="commit-list"><span><small>Base</small><code>{execution.baseSha ?? "—"}</code></span><span><small>Resultado</small><code>{execution.headSha ?? "—"}</code></span><span><small>Modelo</small><code>{execution.model ?? "—"}</code></span></div>
          </section>
        </div>

        <section className="form-card detail-card full-card execution-log-card">
          <div className="card-heading"><div><h2>Logs da execução</h2><p>{execution.logs.length} eventos registrados em ordem cronológica</p></div><TerminalSquare size={20} /></div>
          <div className="execution-timeline">{execution.logs.map((entry) => <div key={entry.id}><span className={`log-level ${entry.level}`}>{entry.level}</span><time>{entry.createdAt.toLocaleString("pt-BR")}</time><strong>{entry.scope}</strong><p>{entry.message}</p>{entry.metadata && <details><summary>Saída técnica</summary><pre>{JSON.stringify(entry.metadata, null, 2)}</pre></details>}</div>)}{!execution.logs.length && <div className="list-empty">Aguardando eventos do worker.</div>}</div>
        </section>

        <section className="form-card detail-card full-card execution-diff-card">
          <div className="card-heading"><div><h2>Diff para revisão</h2><p>Alterações exatas geradas antes da abertura do Pull Request</p></div><Code2 size={20} /></div>
          {diff?.content ? <pre>{diff.content}</pre> : <div className="list-empty">O diff ficará disponível após as validações.</div>}
        </section>
      </div>
    </AppShell>
  );
}
