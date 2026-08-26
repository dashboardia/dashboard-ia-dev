import { Activity, ArrowLeft, ChevronDown, CircleCheck, CircleDotDashed, CircleX, Clock3, Code2, Coins, Download, FileText, GitBranch, TerminalSquare } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import AppShell from "../../../components/app-shell";
import AutoRefresh from "../../../components/auto-refresh";
import ExecutionEnvironmentShortcut from "../../../components/execution-environment-shortcut";
import ExecutionFailureRecovery from "../../../components/execution-failure-recovery";
import SectionHeader from "../../../components/section-header";
import { getProjectRole } from "../../../lib/access";
import { db } from "../../../lib/db";
import { executionLivePresentation, executionProgressLogs, executionStageLabel, executionStatusLabel } from "../../../lib/execution-presentation";
import { executionControlState } from "../../../lib/execution-control-state";
import { executionRevision, shouldPollExecutionDetail } from "../../../lib/execution-refresh";
import { isExecutionCreditBlocked } from "../../../lib/execution-credit-state";
import { requirePageUser } from "../../../lib/page-access";
import { redactSensitiveData } from "../../../lib/redaction";
import { explainError, logLevelLabels, logScopeLabels } from "../../../lib/error-messages";
import { calculateDisplayedExecutionCredits, formatBrlCents } from "../../../lib/financial-shadow";
import { syncExecutionPreviewForPresentation } from "../../../lib/preview-host-client";
import { formatDateTime, getGlobalSettings } from "../../../lib/global-settings";
import OpenPullRequestButton from "../../demands/[demandId]/open-pull-request-button";
import AutoOpenPullRequest from "./auto-open-pull-request";
import EvidenceCard from "./evidence-card";
import DiffViewer from "./diff-viewer";
import ExecutionConversation from "./execution-conversation";
import ExecutionDuration from "./execution-duration";
import ExecutionEnvironmentActivity from "./execution-environment-activity";
import CopyBranchButton from "./copy-branch-button";
const activeExecutionStatuses = new Set(["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL"]);

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
  let execution = await db.execution.findUnique({
    where: { id: executionId },
    include: {
      demand: { include: { project: true } },
      requestedBy: { select: { name: true, githubLogin: true } },
      approvedBy: { select: { name: true, githubLogin: true } },
      logs: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      artifacts: { orderBy: { createdAt: "asc" } },
      pullRequest: true,
      previewEnvironment: true,
      financialSnapshot: true,
      creditReservation: true,
      messages: { orderBy: { createdAt: "asc" }, include: { attachments: { orderBy: { createdAt: "asc" } } } },
    },
  });
  if (!execution) notFound();
  const role = await getProjectRole(user, execution.demand.projectId);
  if (!role) redirect("/executions");
  execution = await syncExecutionPreviewForPresentation(db, execution);
  const diff = execution.artifacts.find((artifact) => artifact.type === "diff");
  const shouldAutoOpenPullRequest = role === "MANAGER" && execution.status === "WAITING_APPROVAL" && !execution.pullRequest && !execution.cancelRequestedAt;
  const interrupted = execution.status === "CANCELLED" || Boolean(execution.cancelRequestedAt);
  const explainedError = execution.error ? explainError(execution.error) : null;
  const progressLogs = executionProgressLogs(execution);
  const executionActive = activeExecutionStatuses.has(execution.status) && !execution.cancelRequestedAt;
  const showConversation = execution.demand.type !== "DOCUMENTATION";
  const conversationReady = Boolean(execution.pullRequest || execution.adjustmentCount > 0 || execution.status === "AWAITING_CLIENT");
  const initialControlState = executionControlState(execution);
  const previewConsentMessageIds = execution.messages
    .filter((message) => message.role === "SYSTEM"
      && message.content?.startsWith("## O ambiente ainda precisa de uma correção"))
    .map((message) => message.id);
  const latestPreviewConsentMessageId = previewConsentMessageIds.at(-1) ?? null;
  const conversationMessages = execution.messages
    .filter((message) => {
      const previewConsentMessage = previewConsentMessageIds.includes(message.id);
      if (!previewConsentMessage) return true;
      return initialControlState.awaitingPreviewRepairConsent && message.id === latestPreviewConsentMessageId;
    })
    .map((message) => ({ ...message, createdAt: message.createdAt.toISOString() }));
  const displayLogs = [...execution.logs].reverse();
  const detailAccordionName = `execution-details-${execution.id}`;
  const creditBlocked = isExecutionCreditBlocked(execution.error);
  const liveRevision = executionRevision(execution);
  const shouldLiveRefresh = shouldPollExecutionDetail(execution);
  const livePresentation = executionLivePresentation(execution);
  const measuredTokens = Math.max(0, Number(execution.inputTokens) || 0) + Math.max(0, Number(execution.outputTokens) || 0);
  const consumedCredits = calculateDisplayedExecutionCredits({
    reservationConsumedCredits: execution.creditReservation?.consumedCredits,
    snapshotConsumedCredits: execution.financialSnapshot?.simulatedConsumedCredits,
    model: execution.model ?? execution.demand.aiModel,
    inputTokens: execution.inputTokens,
    outputTokens: execution.outputTokens,
    settings,
  });
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
        <AutoRefresh active={shouldLiveRefresh} interval={2_000} pauseWhileEditing={false} revision={liveRevision} revisionUrl={`/api/executions/${encodeURIComponent(execution.id)}/refresh`} showIndicator={false} />
        <SectionHeader
          backHref="/executions"
          eyebrow={`${execution.demand.project.name} · ${executionStageLabel(execution.stage)}`}
          title={execution.demand.title}
          description={`Execução ${execution.id.slice(-10)} · solicitada por ${execution.requestedBy.name ?? execution.requestedBy.githubLogin}`}
          action={null}
        />

        <div className={`execution-command-layout${showConversation ? " with-conversation" : " without-conversation"}`}>
        {showConversation ? <div className="execution-workbench with-chat execution-command-center">
          <ExecutionConversation
            executionId={execution.id}
            status={execution.status}
            messages={conversationMessages}
            expiresAt={execution.conversationExpiresAt?.toISOString() ?? null}
            adjustmentCount={execution.adjustmentCount}
            conversationReady={conversationReady}
            creditBlocked={creditBlocked}
            canManage={role === "MANAGER"}
            initialControlState={initialControlState}
            overview={<section className="execution-metrics execution-chat-overview">
              <div><Activity size={17} /><span><small>Status</small><strong>{executionStatusLabel(execution)}</strong></span></div>
              <div><GitBranch size={17} /><span><small>Branch</small><span className="execution-branch-value"><strong>{execution.branchName ?? "Aguardando worker"}</strong><CopyBranchButton branchName={execution.branchName} /></span></span></div>
              <div><Clock3 size={17} /><span><small>Duração</small><strong><ExecutionDuration startedAt={execution.startedAt?.toISOString() ?? null} finishedAt={execution.finishedAt?.toISOString() ?? null} initialNow={execution.updatedAt.getTime()} /></strong></span></div>
              <div><Coins size={17} /><span><small>Créditos usados</small><strong>{consumedCredits.toLocaleString("pt-BR")} créditos</strong>{user.globalRole === "ADMIN" && <em className="execution-admin-token-usage">{measuredTokens.toLocaleString("pt-BR")} tokens medidos</em>}</span></div>
            </section>}
            stateNotices={<div className="execution-chat-state-notices">
              <ExecutionFailureRecovery pathname={`/executions/${execution.id}`} />
              <ExecutionEnvironmentShortcut pathname={`/executions/${execution.id}`} />
            </div>}
            activity={<details className="execution-activity-disclosure" open={executionActive}>
              <summary><span>{liveIcon}</span><span><strong>{livePresentation.title}</strong><small>{livePresentation.subtitle}</small></span><em>Ver andamento</em><ChevronDown size={16} /></summary>
              <div className="execution-activity-grid">
                <section className={`execution-live-progress ${livePresentation.tone}`}>
                  <header><span>{liveIcon}</span><div><strong>{livePresentation.title}</strong><small>{livePresentation.subtitle}</small></div><em>{executionStageLabel(execution.stage)}</em></header>
                  <ol>{progressLogs.map((entry, index) => { const current = executionActive && index === progressLogs.length - 1; return <li className={entry.level === "error" ? "failed" : current ? "running" : "completed"} key={entry.id}>{entry.level === "error" ? <CircleX size={14} /> : current ? <CircleDotDashed className="spin-slow" size={14} /> : <CircleCheck size={14} />}<span><strong>{logScopeLabels[entry.scope] ?? entry.scope}</strong><small>{redactSensitiveData(entry.message)}</small></span></li>; })}{!progressLogs.length && <li className="running"><CircleDotDashed className="spin-slow" size={14} /><span><strong>Fila</strong><small>Aguardando o primeiro evento do worker.</small></span></li>}</ol>
                </section>
                <ExecutionEnvironmentActivity executionId={execution.id} showAction={false} />
              </div>
            </details>}
            externalActions={(execution.pullRequest || shouldAutoOpenPullRequest || interrupted) ? <>
              {execution.pullRequest ? <OpenPullRequestButton executionId={execution.id} pullRequest={execution.pullRequest} /> : shouldAutoOpenPullRequest ? <AutoOpenPullRequest executionId={execution.id} /> : null}
              {interrupted && <div className="execution-action"><Link href={`/demands/${execution.demandId}`}><ArrowLeft size={14} />Voltar e reprocessar</Link></div>}
            </> : null}
          />
        </div> : <div className="execution-workbench single">
          <div className="execution-live-column">
            <section className={`execution-live-progress ${livePresentation.tone}`}>
              <header><span>{liveIcon}</span><div><strong>{livePresentation.title}</strong><small>{livePresentation.subtitle}</small></div><em>{executionStageLabel(execution.stage)}</em></header>
              <ol>{progressLogs.map((entry, index) => { const current = executionActive && index === progressLogs.length - 1; return <li className={entry.level === "error" ? "failed" : current ? "running" : "completed"} key={entry.id}>{entry.level === "error" ? <CircleX size={14} /> : current ? <CircleDotDashed className="spin-slow" size={14} /> : <CircleCheck size={14} />}<span><strong>{logScopeLabels[entry.scope] ?? entry.scope}</strong><small>{redactSensitiveData(entry.message)}</small></span></li>; })}</ol>
            </section>
          </div>
        </div>}

        <details className="form-card detail-card full-card execution-detail-disclosure execution-side-panel">
          <summary className="execution-collapsible-header"><Code2 size={19} /><span><strong>Detalhes</strong><small>Resultado, logs e Git</small></span><ChevronDown className="execution-collapsible-chevron" size={18} /></summary>
          <div className="execution-detail-disclosure-content">
        <details className="form-card detail-card full-card execution-collapsible execution-detail-accordion-item execution-summary-card" name={detailAccordionName}>
          <summary className="execution-collapsible-header"><Code2 size={19} /><span><strong>Resultado</strong><small>Resumo produzido pelo agente</small></span><ChevronDown className="execution-collapsible-chevron" size={18} /></summary>
          <div className="execution-collapsible-content execution-detail-accordion-body">
            <p>{execution.summary ?? "O resumo ficará disponível quando o agente concluir a implementação."}</p>
            {explainedError && <div className="execution-error-box"><strong>{explainedError.title}</strong><p>{explainedError.message}</p><small>{explainedError.action}</small><details><summary>Ver detalhes técnicos</summary><pre>{explainedError.technical}</pre></details></div>}
            <div className="execution-links"><Link href={`/demands/${execution.demandId}`}>Ver demanda original</Link>{execution.pullRequest && <a href={execution.pullRequest.url} target="_blank" rel="noreferrer">Abrir PR #{execution.pullRequest.externalNumber}</a>}</div>
          </div>
        </details>

        <details className="form-card detail-card full-card execution-collapsible execution-detail-accordion-item" name={detailAccordionName}>
          <summary className="execution-collapsible-header"><GitBranch size={19} /><span><strong>Referências Git</strong><small>Branch, commits e modelo utilizado</small></span><ChevronDown className="execution-collapsible-chevron" size={18} /></summary>
          <div className="execution-collapsible-content execution-detail-accordion-body"><div className="commit-list"><span><small>Base</small><code>{execution.baseSha ?? "—"}</code></span><span><small>Resultado</small><code>{execution.headSha ?? "—"}</code></span><span><small>Modelo</small><code>{execution.model ?? "—"}</code></span></div></div>
        </details>

        <details className="form-card detail-card full-card execution-collapsible execution-log-card execution-detail-accordion-item" name={detailAccordionName}>
          <summary className="execution-collapsible-header"><TerminalSquare size={19} /><span><strong>Logs da execução</strong><small>{execution.logs.length} eventos · mais recentes primeiro</small></span><ChevronDown className="execution-collapsible-chevron" size={18} /></summary>
          <div className="execution-collapsible-content"><div className="execution-timeline">{displayLogs.map((entry) => { const logError = entry.level === "error" ? explainError(entry.message) : null; const LogIcon = entry.level === "error" ? CircleX : entry.level === "warn" ? CircleDotDashed : CircleCheck; return <article className={`execution-log-entry ${entry.level}`} key={entry.id}><span className="execution-log-icon"><LogIcon size={15} /></span><div className="execution-log-main"><header><strong>{logScopeLabels[entry.scope] ?? entry.scope}</strong><time>{formatDateTime(entry.createdAt, settings.timeZone)}</time><span className={`log-level ${entry.level}`}>{logLevelLabels[entry.level] ?? entry.level}</span></header><p>{logError ? `${logError.title}. ${logError.action}` : redactSensitiveData(entry.message)}</p>{entry.metadata && <details><summary>Detalhes técnicos</summary><pre>{redactSensitiveData(JSON.stringify(entry.metadata, null, 2))}</pre></details>}</div></article>; })}{!displayLogs.length && <div className="list-empty">Aguardando eventos do worker.</div>}</div></div>
        </details>

        {user.globalRole === "ADMIN" && execution.financialSnapshot && <details className="form-card detail-card full-card execution-collapsible execution-detail-accordion-item financial-execution-card" name={detailAccordionName}>
          <summary className="execution-collapsible-header"><Coins size={19} /><span><strong>Simulação financeira</strong><small>Custos, consumo e margem administrativa</small></span><ChevronDown className="execution-collapsible-chevron" size={18} /></summary>
          <div className="execution-collapsible-content execution-detail-accordion-body">
          <div className="financial-summary-grid">
            <span><small>Custo interno</small><strong>{formatBrlCents(execution.financialSnapshot.totalInternalCostBrlCents)}</strong></span>
            <span><small>Reserva simulada</small><strong>{execution.financialSnapshot.simulatedReservedCredits} créditos</strong></span>
            <span><small>Consumo simulado</small><strong>{execution.financialSnapshot.simulatedConsumedCredits} créditos</strong></span>
            <span><small>Valor comercial</small><strong>{formatBrlCents(execution.financialSnapshot.simulatedCommercialValueBrlCents)}</strong></span>
            <span><small>Margem estimada</small><strong>{(execution.financialSnapshot.estimatedGrossMarginBasisPoints / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</strong></span>
            <span><small>Medição</small><strong>{execution.financialSnapshot.calculationStatus === "MEASURED" ? "Tokens medidos" : "Sem dados de uso"}</strong></span>
          </div>
          <details className="financial-details"><summary>Ver composição e fórmula</summary><div><span>IA ajustada: <strong>{formatBrlCents(execution.financialSnapshot.adjustedAiCostBrlCents)}</strong></span><span>Worker ({execution.financialSnapshot.workerDurationSeconds}s): <strong>{formatBrlCents(execution.financialSnapshot.workerCostBrlCents)}</strong></span><span>Validação visual: <strong>{formatBrlCents(execution.financialSnapshot.visualValidationCostBrlCents)}</strong></span><span>Modelo: <strong>{execution.financialSnapshot.model}</strong></span><span>Fórmula: <strong>{execution.financialSnapshot.formulaVersion}</strong></span></div></details>
          </div>
        </details>}

        {execution.creditReservation && <details className="form-card detail-card full-card execution-collapsible execution-detail-accordion-item execution-credit-card" name={detailAccordionName}><summary className="execution-collapsible-header"><Coins size={19} /><span><strong>Créditos da execução</strong><small>Reserva, uso real e saldo liberado</small></span><ChevronDown className="execution-collapsible-chevron" size={18} /></summary><div className="execution-collapsible-content execution-detail-accordion-body"><div className="financial-summary-grid"><span><small>Limite protegido</small><strong>Até {execution.creditReservation.reservedCredits}</strong></span><span><small>Uso real</small><strong>{execution.creditReservation.status === "RESERVED" ? "Em cálculo" : execution.creditReservation.consumedCredits}</strong></span><span><small>Saldo liberado</small><strong>{execution.creditReservation.status === "RESERVED" ? "Após concluir" : Math.max(0, execution.creditReservation.reservedCredits - execution.creditReservation.consumedCredits)}</strong></span><span><small>Situação</small><strong>{execution.creditReservation.status === "RESERVED" ? "Em execução" : execution.creditReservation.status === "SETTLED" ? "Consumo calculado" : "Reserva liberada"}</strong></span></div><p className="execution-credit-explanation">{creditEstimateExplanation(execution.creditReservation)} Ao concluir, somente o uso real é cobrado e todo o restante fica disponível novamente.</p></div></details>}

        {execution.demand.type === "DOCUMENTATION" && execution.summary && <details className="form-card detail-card full-card execution-collapsible execution-detail-accordion-item documentation-download-card" name={detailAccordionName}>
          <summary className="execution-collapsible-header"><FileText size={19} /><span><strong>Documentação de negócio</strong><small>Arquivos prontos para baixar</small></span><ChevronDown className="execution-collapsible-chevron" size={18} /></summary>
          <div className="execution-collapsible-content execution-detail-accordion-body">
          <div className="documentation-download-actions">
            <a href={`/api/executions/${execution.id}/documentation/docx`}><Download size={16} /><span><strong>Baixar DOCX</strong><small>Editável no Word e aplicativos compatíveis</small></span></a>
            <a href={`/api/executions/${execution.id}/documentation/pdf`}><Download size={16} /><span><strong>Baixar PDF</strong><small>Pronto para apresentação e compartilhamento</small></span></a>
          </div>
          </div>
        </details>}

        {execution.demand.type !== "DOCUMENTATION" && <EvidenceCard accordionName={detailAccordionName} artifacts={execution.artifacts} />}

        <details className="form-card detail-card full-card execution-collapsible execution-diff-card execution-detail-accordion-item" name={detailAccordionName}>
          <summary className="execution-collapsible-header"><Code2 size={19} /><span><strong>Diff para revisão</strong><small>{diff?.content ? "Alterações exatas geradas antes da abertura do Pull Request" : "Disponível após as validações"}</small></span><ChevronDown className="execution-collapsible-chevron" size={18} /></summary>
          <div className="execution-collapsible-content">{diff?.content ? <DiffViewer content={diff.content} /> : <div className="list-empty">O diff ficará disponível após as validações.</div>}</div>
        </details>
          </div>
        </details>
        </div>
      </div>
    </AppShell>
  );
}
