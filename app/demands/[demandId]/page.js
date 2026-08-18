import { CheckCircle2, Clock3, GitBranch, User } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";

import AppShell from "../../../components/app-shell";
import AutoRefresh from "../../../components/auto-refresh";
import SectionHeader from "../../../components/section-header";
import { getProjectRole } from "../../../lib/access";
import { db } from "../../../lib/db";
import { requirePageUser } from "../../../lib/page-access";
import { explainError } from "../../../lib/error-messages";
import ApproveButton from "./approve-button";
import CancelExecutionButton from "./cancel-execution-button";
import DemandEditCard from "./demand-edit-card";
import OpenPullRequestButton from "./open-pull-request-button";
import StartAnalysisButton from "./start-analysis-button";

const typeLabels = { BUG: "Correção", FEATURE: "Nova funcionalidade", REFACTOR: "Refatoração", TEST: "Testes", INVESTIGATION: "Investigação" };
const statusLabels = { DRAFT: "Rascunho", PENDING_APPROVAL: "Aguardando aprovação", APPROVED: "Aprovada", QUEUED: "Na fila", RUNNING: "Em execução", REVIEW: "Em revisão", SUCCEEDED: "Concluída", FAILED: "Falhou", CANCELLED: "Cancelada" };

export const dynamic = "force-dynamic";

export default async function DemandPage({ params }) {
  const user = await requirePageUser();
  const { demandId } = await params;
  const demand = await db.demand.findUnique({
    where: { id: demandId },
    include: { project: true, createdBy: { select: { id: true, name: true, githubLogin: true } }, approvedBy: { select: { name: true, githubLogin: true } }, executions: { include: { pullRequest: true }, orderBy: { createdAt: "desc" } } },
  });
  if (!demand) notFound();
  const role = await getProjectRole(user, demand.projectId);
  if (!role) redirect("/demands");
  const canEdit = ["DRAFT", "PENDING_APPROVAL"].includes(demand.status) && (demand.createdBy.id === user.id || role === "MANAGER");
  const live = demand.executions.some((execution) => ["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL"].includes(execution.status) && !execution.cancelRequestedAt);

  return (
    <AppShell user={user}>
      <div className="section-page">
        <AutoRefresh active={live} />
        <SectionHeader backHref="/demands" eyebrow={`${demand.project.name} · ${typeLabels[demand.type]}`} title={demand.title} description={`Criada por ${demand.createdBy.name ?? demand.createdBy.githubLogin}`} action={role === "MANAGER" && demand.status === "PENDING_APPROVAL" ? <ApproveButton demandId={demand.id} /> : role === "MANAGER" && ["APPROVED", "FAILED"].includes(demand.status) ? <StartAnalysisButton demandId={demand.id} /> : null} />
        <div className="detail-grid demand-detail-grid">
          <DemandEditCard demand={{ id: demand.id, title: demand.title, description: demand.description, acceptanceCriteria: demand.acceptanceCriteria, type: demand.type, priority: demand.priority }} canEdit={canEdit} />
          <section className="form-card detail-card"><h2>Informações</h2><div className="detail-list"><span><Clock3 size={17} /><strong>Status</strong><em>{statusLabels[demand.status]}</em></span><span><GitBranch size={17} /><strong>Branch base</strong><em>{demand.project.defaultBranch}</em></span><span><User size={17} /><strong>Aprovador</strong><em>{demand.approvedBy?.name ?? demand.approvedBy?.githubLogin ?? "Pendente"}</em></span><span><CheckCircle2 size={17} /><strong>Prioridade</strong><em>{demand.priority}</em></span></div></section>
        </div>
        <section className="form-card detail-card full-card"><div className="card-heading"><div><h2>Execuções</h2><p>Histórico imutável das tentativas</p></div></div><div className="simple-list">{demand.executions.map((execution) => { const error = execution.error ? explainError(execution.error) : null; return <div className="execution-entry" key={execution.id}><strong><Link href={`/executions/${execution.id}`}>{execution.stage}</Link></strong><span>{execution.cancelRequestedAt && execution.status !== "CANCELLED" ? "CANCELAMENTO SOLICITADO" : execution.status}</span><em>{execution.model ?? "—"}</em>{execution.pullRequest ? <OpenPullRequestButton executionId={execution.id} pullRequest={execution.pullRequest} /> : role === "MANAGER" && execution.status === "WAITING_APPROVAL" && !execution.cancelRequestedAt ? <OpenPullRequestButton executionId={execution.id} /> : null}{role === "MANAGER" && ["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL"].includes(execution.status) && !execution.cancelRequestedAt && <CancelExecutionButton executionId={execution.id} />}{execution.summary && <p>{execution.summary}</p>}{error && <p className="execution-error"><strong>{error.title}</strong><span>{error.action}</span></p>}</div>; })}{!demand.executions.length && <div className="list-empty">A execução ficará disponível após a aprovação da demanda.</div>}</div></section>
      </div>
    </AppShell>
  );
}
