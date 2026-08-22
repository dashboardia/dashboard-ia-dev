import { Activity, ArrowLeft, ChevronDown, CircleCheck, CircleDotDashed, CircleX, Clock3, Code2, Coins, Download, FileText, GitBranch, TerminalSquare, Zap } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import AppShell from "../../../components/app-shell";
import SectionHeader from "../../../components/section-header";
import { getProjectRole } from "../../../lib/access";
import { db } from "../../../lib/db";
import { executionLivePresentation, executionStageLabel, executionStatusLabel } from "../../../lib/execution-presentation";
import { requirePageUser } from "../../../lib/page-access";
import { redactSensitiveData } from "../../../lib/redaction";
import { explainError, logLevelLabels, logScopeLabels } from "../../../lib/error-messages";
import { formatBrlCents } from "../../../lib/financial-shadow";
import { formatDateTime, getGlobalSettings } from "../../../lib/global-settings";
import CancelExecutionButton from "../../demands/[demandId]/cancel-execution-button";
import OpenPullRequestButton from "../../demands/[demandId]/open-pull-request-button";
import AutoOpenPullRequest from "./auto-open-pull-request";
import EvidenceCard from "./evidence-card";
import DiffViewer from "./diff-viewer";
import ExecutionConversation from "./execution-conversation";
import ExecutionEnvironmentActivity from "./execution-environment-activity";
import CopyBranchButton from "./copy-branch-button";
import ResumeExecutionButton from "./resume-execution-button";

const cancellableStatuses = ["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL"];
const activeExecutionStatuses = new Set(["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL"]);

function duration(execution) {
  if (!execution.startedAt) return "Não iniciada";
  const end = execution.finishedAt ?? new Date();
  const seconds = Math.max(0, Math.round((end.getTime() - execution.startedAt.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}min ${remaining}s`;
}

function creditEstimateExplanation(reservation) {
  if (!reservation.estimateMetadata) return "Esta execução começou com a regra anterior de reserva fixa. Novas execuções usam uma estimativa calculada pelo pedido.";
  if (reservation.estimateMetadata.method === "HISTORY_AND_SCOPE") {
    return `Calculado pelo escopo informado e pelo histórico de ${reservation.estimateMetadata.sampleSize} execução(ões) do mesmo tipo e modelo.`;
  }
  return "Calculado pelo modelo escolhido, tipo, volume do pedido e necessidade de validação visual.";
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
      financialSnapshot: true,
      creditReservation: true,
      messages: { orderBy: { createdAt: "asc" }, include: { attachments: { orderBy: { createdAt: "asc" } } } },
    },
  });
  if (!execution) notFound();
  const role = await getProjectRole(user, execution.demand.projectId);
  if (!role) redirect("/executions");
  const diff = execution.artifacts.find((artifact) => artifact.type === "diff");
  const canCancel = role === "MANAGER" && cancellableStatuses.includes(execution.status) && !execution.cancelRequestedAt;
  const canResume = role === "MANAGER" && execution.status === "STOPPED" && !execution.cancelRequestedAt;
  const shouldAutoOpenPullRequest = role === "MANAGER" && execution.status === "WAITING_APPROVAL" && !execution.pullRequest && !execution.cancelRequestedAt;
  const interrupted = execution.status === "CANCELLED" || Boolean(execution.cancelRequestedAt);
  const stopped = execution.status === "STOPPED";
  const explainedError = execution.error ? explainError(execution.error) : null;
  const progressLogs = execution.logs.slice(-5);
  const executionActive = activeExecutionStatuses.has(execution.status) && !execution.cancelRequestedAt;
  const showConversation = execution.demand.type !== "DOCUMENTATION";
  const conversationReady = Boolean(execution.pullRequest || execution.messages.length > 0 || execution.status === "AWAITING_CLIENT");
  const conversationMessages = execution.messages.map((message) => ({ ...message, createdAt: message.createdAt.toISOString() }));
  const livePresentation = executionLivePresentation(execution);
  const liveIcon = livePresentation.icon === "failed"
    ? <CircleX size={18} />
    : livePresentation.icon === "running"
      ? <CircleDotDashed className="spin-slow" size={18} />
      : livePresentation.icon === "paused"
        ? <CircleDotDashed size={18} />
        : <CircleCheck size={18} />;

  return (
    <AppShell user={user}>
      <div className="section-page execution-detail-page">
        <SectionHeader
          backHref="/executions"
          eyebrow={`${execution.demand.project.name} · ${executionStageLabel(execution.stage)}`}
          title={execution.demand.title}
          description={`Execução ${execution.id.slice(-10)} · solicitada por ${execution.requestedBy.name ?? execution.requestedBy.githubLogin}`}
          action={<div className="execution-header-actions">{execution.pullRequest ? <OpenPullRequestButton executionId={execution.id} pullRequest={execution.pullRequest} /> : shouldAutoOpenPullRequest ? <AutoOpenPullRequest executionId={execution.id} /> : interrupted ? <div className="execution-action"><Link href={`/demands/${execution.demandId}`}><ArrowLeft size={14} />Voltar e reprocessar a demanda</Link></div> : null}{canResume && <ResumeExecutionButton executionId={execution.id} processingEnabled={settings.executionProcessingEnabled} />}{canCancel && <CancelExecutionButton executionId={execution.id} />}</div>}
        />

        <section className="execution-metrics">
          <div><Activity size={17} /><span><small>Status</small><strong>{executionStatusLabel(execution)}</strong></span></div>
          <div><GitBranch size={17} /><span><small>Branch</small><span className="execution-branch-value"><strong>{execution.branchName ?? "Aguardando worker"}</strong><CopyBranchButton branchName={execution.branchName} /></span></span></div>
          <div><Clock3 size={17} /><span><small>Duração</small><strong>{duration(execution)}</strong></span></div>
          <div><Zap size={17} /><span><small>Tokens</small><strong>{(execution.inputTokens ?? 0) + (execution.outputTokens ?? 0) || "—"}</strong></span></div>
        </section>

        <div className={`execution-workbench ${showConversation ? "with-chat" : "single"}`}>
          <div className="execution-live-column">
            <section className={`execution-live-progress ${livePresentation.tone}`}>
              <header><span>{liveIcon}</span><div><strong>{livePresentation.title}</strong><small>{livePresentation.subtitle}</small></div><em>{executionStageLabel(execution.stage)}</em></header>
              <ol>{progressLogs.map((entry, index) => { const current = executionActive && index === progressLogs.length - 1; return <li className={entry.level === "error" ? "failed" : current ? "running" : "completed"} key={entry.id}>{entry.level === "error" ? <CircleX size={14} /> : current ? <CircleDotDashed className="spin-slow" size={14} /> : <CircleCheck size={14} />}<span><strong>{logScopeLabels[entry.scope] ?? entry.scope}</strong><small>{redactSensitiveData(entry.message)}</small></span></li>; })}{!progressLogs.length && <li className="running"><CircleDotDashed className="spin-slow" size={14} /><span><strong>Fila</strong><small>Aguardando o primeiro evento do worker.</small></span></li>}</ol>
            </section>
            {showConversation && <ExecutionEnvironmentActivity executionId={execution.id} />}
          </div>

          {showConversation && <ExecutionConversation executionId={execution.id} status={execution.status} messages={conversationMessages} expiresAt={execution.conversationExpiresAt?.toISOString() ?? null} adjustmentCount={execution.adjustmentCount} conversationReady={conversationReady} />}
        </div>

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

        {user.globalRole === "ADMIN" && execution.financialSnapshot && <section className="form-card detail-card full-card financial-execution-card">
          <div className="card-heading"><div><h2>Simulação financeira</h2><p>Visível somente para administradores. O custo segue silencioso; créditos são liquidados pelo consumo medido.</p></div><div className="shadow-mode-badge"><Coins size={14} />CUSTO SILENCIOSO</div></div>
          <div className="financial-summary-grid">
            <span><small>Custo interno</small><strong>{formatBrlCents(execution.financialSnapshot.totalInternalCostBrlCents)}</strong></span>
            <span><small>Reserva simulada</small><strong>{execution.financialSnapshot.simulatedReservedCredits} créditos</strong></span>
            <span><small>Consumo simulado</small><strong>{execution.financialSnapshot.simulatedConsumedCredits} créditos</strong></span>
            <span><small>Valor comercial</small><strong>{formatBrlCents(execution.financialSnapshot.simulatedCommercialValueBrlCents)}</strong></span>
            <span><small>Margem estimada</small><strong>{(execution.financialSnapshot.estimatedGrossMarginBasisPoints / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</strong></span>
            <span><small>Medição</small><strong>{execution.financialSnapshot.calculationStatus === "MEASURED" ? "Tokens medidos" : "Sem dados de uso"}</strong></span>
          </div>
          <details className="financial-details"><summary>Ver composição e fórmula</summary><div><span>IA ajustada: <strong>{formatBrlCents(execution.financialSnapshot.adjustedAiCostBrlCents)}</strong></span><span>Worker ({execution.financialSnapshot.workerDurationSeconds}s): <strong>{formatBrlCents(execution.financialSnapshot.workerCostBrlCents)}</strong></span><span>Validação visual: <strong>{formatBrlCents(execution.financialSnapshot.visualValidationCostBrlCents)}</strong></span><span>Modelo: <strong>{execution.financialSnapshot.model}</strong></span><span>Fórmula: <strong>{execution.financialSnapshot.formulaVersion}</strong></span></div></details>
        </section>}

        {execution.creditReservation && <section className="form-card detail-card full-card execution-credit-card"><div className="card-heading"><div><h2>Estimativa de créditos</h2><p>A reserva não é uma cobrança: ela protege um limite aproximado enquanto o trabalho é executado.</p></div><Coins size={20} /></div><div className="financial-summary-grid"><span><small>Limite protegido</small><strong>Até {execution.creditReservation.reservedCredits}</strong></span><span><small>Uso real</small><strong>{execution.creditReservation.status === "RESERVED" ? "Em cálculo" : execution.creditReservation.consumedCredits}</strong></span><span><small>Saldo liberado</small><strong>{execution.creditReservation.status === "RESERVED" ? "Após concluir" : Math.max(0, execution.creditReservation.reservedCredits - execution.creditReservation.consumedCredits)}</strong></span><span><small>Situação</small><strong>{execution.creditReservation.status === "RESERVED" ? "Em execução" : execution.creditReservation.status === "SETTLED" ? "Consumo calculado" : "Reserva liberada"}</strong></span></div><p className="execution-credit-explanation">{creditEstimateExplanation(execution.creditReservation)} Ao concluir, somente o uso real é cobrado e todo o restante fica disponível novamente.</p></section>}

        {execution.demand.type === "DOCUMENTATION" && execution.summary && <section className="form-card detail-card full-card documentation-download-card">
          <div className="card-heading"><div><h2>Documentação de negócio</h2><p>Arquivos formatados para compartilhar, apresentar ou arquivar.</p></div><FileText size={20} /></div>
          <div className="documentation-download-actions">
            <a href={`/api/executions/${execution.id}/documentation/docx`}><Download size={16} /><span><strong>Baixar DOCX</strong><small>Editável no Word e aplicativos compatíveis</small></span></a>
            <a href={`/api/executions/${execution.id}/documentation/pdf`}><Download size={16} /><span><strong>Baixar PDF</strong><small>Pronto para apresentação e compartilhamento</small></span></a>
          </div>
        </section>}

        <details className="form-card detail-card full-card execution-collapsible execution-log-card">
          <summary className="execution-collapsible-header"><TerminalSquare size={19} /><span><strong>Logs da execução</strong><small>{execution.logs.length} eventos registrados em ordem cronológica</small></span><ChevronDown className="execution-collapsible-chevron" size={18} /></summary>
          <div className="execution-collapsible-content"><div className="execution-timeline">{execution.logs.map((entry) => { const logError = entry.level === "error" ? explainError(entry.message) : null; return <div key={entry.id}><span className={`log-level ${entry.level}`}>{logLevelLabels[entry.level] ?? entry.level}</span><time>{formatDateTime(entry.createdAt, settings.timeZone)}</time><strong>{logScopeLabels[entry.scope] ?? entry.scope}</strong><p>{logError ? `${logError.title}. ${logError.action}` : redactSensitiveData(entry.message)}</p>{entry.metadata && <details><summary>Ver detalhes técnicos</summary><pre>{redactSensitiveData(JSON.stringify(entry.metadata, null, 2))}</pre></details>}</div>; })}{!execution.logs.length && <div className="list-empty">Aguardando eventos do worker.</div>}</div></div>
        </details>

        {execution.demand.type !== "DOCUMENTATION" && <EvidenceCard artifacts={execution.artifacts} />}

        <details className="form-card detail-card full-card execution-collapsible execution-diff-card">
          <summary className="execution-collapsible-header"><Code2 size={19} /><span><strong>Diff para revisão</strong><small>{diff?.content ? "Alterações exatas geradas antes da abertura do Pull Request" : "Disponível após as validações"}</small></span><ChevronDown className="execution-collapsible-chevron" size={18} /></summary>
          <div className="execution-collapsible-content">{diff?.content ? <DiffViewer content={diff.content} /> : <div className="list-empty">O diff ficará disponível após as validações.</div>}</div>
        </details>
      </div>
    </AppShell>
  );
}
