import { ArrowRight, CheckCircle2, Clock3, GitBranch, MousePointerClick } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";

import AppShell from "../../../components/app-shell";
import SectionHeader from "../../../components/section-header";
import { getProjectRole } from "../../../lib/access";
import { db } from "../../../lib/db";
import { planIsPaid } from "../../../lib/billing-plans";
import { requirePageUser } from "../../../lib/page-access";
import { explainError } from "../../../lib/error-messages";
import CancelExecutionButton from "./cancel-execution-button";
import DemandEditCard from "./demand-edit-card";
import OpenPullRequestButton from "./open-pull-request-button";
import StartAnalysisButton from "./start-analysis-button";

const typeLabels = { BUG: "Correção", FEATURE: "Nova funcionalidade", REFACTOR: "Refatoração", TEST: "Testes", INVESTIGATION: "Investigação", DOCUMENTATION: "Documentação de negócio" };
const statusLabels = { DRAFT: "Rascunho", PENDING_APPROVAL: "Pronta para iniciar", APPROVED: "Pronta para iniciar", QUEUED: "Na fila", RUNNING: "Em execução", REVIEW: "Em revisão", SUCCEEDED: "Concluída", FAILED: "Falha aguardando correção", CANCELLED: "Cancelada", STOPPED: "Parada pelo administrador" };

export const dynamic = "force-dynamic";

export default async function DemandPage({ params }) {
  const user = await requirePageUser();
  const { demandId } = await params;
  const demand = await db.demand.findUnique({
    where: { id: demandId },
    include: { project: { include: { createdBy: { select: { globalRole: true, billingAccount: { select: { plan: true, planDefinition: { select: { priceCents: true, includedCredits: true } } } } } } } }, createdBy: { select: { id: true, name: true, githubLogin: true } }, executions: { include: { pullRequest: true }, orderBy: { createdAt: "desc" } } },
  });
  if (!demand) notFound();
  const role = await getProjectRole(user, demand.projectId);
  if (!role) redirect("/demands");
  const canEdit = ["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(demand.status) && !demand.executions.length && (demand.createdBy.id === user.id || role === "MANAGER");
  const lunaOnly = user.globalRole !== "ADMIN" && demand.project.createdBy.globalRole !== "ADMIN" && demand.project.createdBy.billingAccount?.plan !== "CUSTOM" && !planIsPaid(demand.project.createdBy.billingAccount?.planDefinition);
  const canStart = role === "MANAGER" && ["PENDING_APPROVAL", "APPROVED", "FAILED", "STOPPED"].includes(demand.status);

  return (
    <AppShell user={user}>
      <div className="section-page">
        <SectionHeader backHref="/demands" eyebrow={`${demand.project.name} · ${typeLabels[demand.type]}`} title={demand.title} description={`Demanda ${demand.id.slice(-10)} · criada por ${demand.createdBy.name ?? demand.createdBy.githubLogin}`} action={canStart ? <StartAnalysisButton demandId={demand.id} /> : null} />
        <div className="detail-grid demand-detail-grid">
          <DemandEditCard demand={{ id: demand.id, projectId: demand.projectId, baseBranch: demand.baseBranch, title: demand.title, description: demand.description, acceptanceCriteria: demand.acceptanceCriteria, type: demand.type, priority: demand.priority, visualValidation: demand.visualValidation, visualPaths: demand.visualPaths, aiModel: demand.aiModel }} canEdit={canEdit} lunaOnly={lunaOnly} />
          <section className="form-card detail-card"><h2>Informações</h2><div className="detail-list"><span><Clock3 size={17} /><strong>Status</strong><em>{statusLabels[demand.status]}</em></span><span><GitBranch size={17} /><strong>Branch base</strong><em>{demand.baseBranch}</em></span><span><CheckCircle2 size={17} /><strong>Prioridade</strong><em>{demand.priority}</em></span></div></section>
        </div>
        <section className="form-card detail-card full-card"><div className="card-heading execution-history-heading"><div><h2>Execuções</h2><p>Clique em uma execução para acompanhar etapas, logs, custos e resultado em tempo real.</p></div><span><MousePointerClick size={15} />Itens clicáveis</span></div><div className="simple-list execution-history-list">{demand.executions.map((execution) => { const error = execution.error ? explainError(execution.error) : null; return <article className="execution-entry" key={execution.id}><Link className="execution-open-link" href={`/executions/${execution.id}`}><span><strong>{execution.stage}</strong><small>Execução {execution.id.slice(-8)}</small></span><span className={`status-pill ${execution.status.toLowerCase()}`}>{execution.cancelRequestedAt && execution.status !== "CANCELLED" ? "CANCELAMENTO SOLICITADO" : execution.status}</span><em>{execution.model ?? "modelo pendente"}</em><b>Abrir execução <ArrowRight size={14} /></b></Link><div className="execution-entry-actions">{execution.pullRequest && <OpenPullRequestButton executionId={execution.id} pullRequest={execution.pullRequest} />}{role === "MANAGER" && ["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL"].includes(execution.status) && !execution.cancelRequestedAt && <CancelExecutionButton executionId={execution.id} />}</div>{execution.summary && <p>{execution.summary}</p>}{error && <p className="execution-error"><strong>{error.title}</strong><span>{error.action}</span></p>}</article>; })}{!demand.executions.length && <div className="list-empty">Clique em “Iniciar execução” para começar e acompanhar o processamento ao vivo.</div>}</div></section>
      </div>
    </AppShell>
  );
}
