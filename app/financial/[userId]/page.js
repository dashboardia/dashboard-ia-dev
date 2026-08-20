import { ArrowLeft, Bot, CircleDollarSign, Clock3, Cpu, Landmark, TrendingUp } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import AppShell from "../../../components/app-shell";
import SectionHeader from "../../../components/section-header";
import { buildClientFinancialMonthlySeries, buildClientFinancialRows } from "../../../lib/admin-financial";
import { db } from "../../../lib/db";
import { formatBrlCents } from "../../../lib/financial-shadow";
import { requirePageAdmin } from "../../../lib/page-access";

export const dynamic = "force-dynamic";

const checkoutKindLabels = { PLAN: "Assinatura", CREDIT_PACK: "Pacote de créditos" };
const monthFormatter = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" });
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

function formatMonth(value) {
  return monthFormatter.format(new Date(`${value}-01T00:00:00Z`)).replace(" de ", "/");
}

function measuredMoney(value) {
  return value > 0 ? formatBrlCents(value) : "Sem custo medido";
}

function costShare(value, total) {
  return total > 0 ? Math.round(value * 10_000 / total) / 100 : 0;
}

function executionCostBreakdown(snapshot) {
  const aiDirect = snapshot.aiCostUsdMicros != null && snapshot.usdToBrlCents != null
    ? Math.ceil(Math.max(0, snapshot.aiCostUsdMicros) * Math.max(0, snapshot.usdToBrlCents) / 1_000_000)
    : Math.max(0, snapshot.adjustedAiCostBrlCents || 0);
  const safety = Math.max(0, (snapshot.adjustedAiCostBrlCents || 0) - aiDirect);
  return `IA ${formatBrlCents(aiDirect)} · reserva ${formatBrlCents(safety)} · worker ${formatBrlCents(snapshot.workerCostBrlCents)} · visual ${formatBrlCents(snapshot.visualValidationCostBrlCents)}`;
}

export default async function ClientFinancialPage({ params }) {
  const user = await requirePageAdmin();
  const { userId } = await params;
  const [account, snapshots] = await Promise.all([
    db.billingAccount.findUnique({
      where: { ownerUserId: userId },
      include: {
        owner: { select: { name: true, email: true, githubLogin: true } },
        planDefinition: { select: { name: true } },
        checkouts: {
          where: { status: "PAID" },
          select: { id: true, kind: true, targetPlan: true, creditAmount: true, amountCents: true, paidAt: true, createdAt: true },
          orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
        },
      },
    }),
    db.executionFinancialSnapshot.findMany({
      where: { calculationStatus: "MEASURED", execution: { demand: { project: { createdById: userId } } } },
      include: { execution: { select: { id: true, status: true, demand: { select: { id: true, title: true, project: { select: { name: true, createdById: true } } } } } } },
      orderBy: { calculatedAt: "desc" },
    }),
  ]);
  if (!account) notFound();

  const client = buildClientFinancialRows([account], snapshots)[0];
  const monthly = buildClientFinancialMonthlySeries(account.checkouts, snapshots);
  const graphMaximum = Math.max(1, ...monthly.flatMap((month) => [month.paidBrlCents, month.directOperationalCostBrlCents, month.aiSafetyCostBrlCents]));
  const segmentedInternalCost = client.adjustedAiCostBrlCents + client.workerCostBrlCents + client.visualCostBrlCents;
  const otherInternalCostBrlCents = Math.max(0, client.totalInternalCostBrlCents - segmentedInternalCost);
  const costSegments = [
    { label: "OpenAI direto", detail: "Tokens × preço do modelo × câmbio do snapshot", value: client.aiCostBrlCents, className: "ai" },
    { label: "Reserva de segurança da IA", detail: "Proteção interna aplicada sobre a variação da API", value: client.aiSafetyCostBrlCents, className: "safety" },
    { label: "Worker", detail: "Tempo de processamento × custo/hora configurado", value: client.workerCostBrlCents, className: "worker" },
    { label: "Validação visual", detail: "Custo fixo quando a evidência visual é executada", value: client.visualCostBrlCents, className: "visual" },
    ...(otherInternalCostBrlCents ? [{ label: "Outros ajustes", detail: "Diferença de arredondamento ou fórmula histórica", value: otherInternalCostBrlCents, className: "other" }] : []),
  ];
  const formulaVersions = [...new Set(snapshots.map((snapshot) => snapshot.formulaVersion).filter(Boolean))];

  return <AppShell user={user}><div className="section-page financial-page financial-detail-page">
    <Link className="financial-back-link" href="/financial"><ArrowLeft size={14} /> Voltar ao financeiro</Link>
    <SectionHeader eyebrow="DETALHAMENTO FINANCEIRO" title={client.name} description={`${client.email} · ${client.planName} · ${client.executions} execução(ões) com custo medido`} />

    <section className="financial-kpis">
      <article><Landmark size={18} /><span><small>Receita confirmada</small><strong>{client.paidBrlCents ? formatBrlCents(client.paidBrlCents) : "Sem receita"}</strong><em>{account.checkouts.length} pagamento(s) confirmado(s)</em></span></article>
      <article><Bot size={18} /><span><small>Custo direto medido</small><strong>{measuredMoney(client.directOperationalCostBrlCents)}</strong><em>OpenAI + worker + validação visual</em></span></article>
      <article><Cpu size={18} /><span><small>Reserva interna</small><strong>{measuredMoney(client.aiSafetyCostBrlCents)}</strong><em>margem de segurança aplicada à IA</em></span></article>
      <article className={client.resultBrlCents < 0 ? "negative" : "positive"}><TrendingUp size={18} /><span><small>Resultado bruto após reserva</small><strong>{formatBrlCents(client.resultBrlCents)}</strong><em>{client.grossMarginPercent == null ? "sem receita confirmada" : `${client.grossMarginPercent.toLocaleString("pt-BR")}% de margem bruta`}</em></span></article>
    </section>
    <p className="financial-result-warning">Resultado bruto = receita confirmada − custo operacional calculado. Não é lucro líquido: impostos e custos fixos gerais ainda não atribuídos ao cliente não estão incluídos.</p>

    <section className="financial-detail-grid">
      <article className="form-card financial-chart-card">
        <div className="card-heading"><div><h2>Movimento financeiro por mês</h2><p>Valores escritos e barras na mesma escala para facilitar a comparação.</p></div><TrendingUp size={19} /></div>
        <div className="financial-month-flow">
          {monthly.map((month) => <article key={month.month}>
            <header><span><strong>{formatMonth(month.month)}</strong><small>{month.executions} execução(ões) medida(s)</small></span><em className={month.resultBrlCents < 0 ? "negative" : "positive"}>Resultado {formatBrlCents(month.resultBrlCents)}{month.grossMarginPercent == null ? "" : ` · ${month.grossMarginPercent.toLocaleString("pt-BR")}%`}</em></header>
            <div className="financial-flow-line revenue"><span><small>Receita confirmada</small><strong>{month.paidBrlCents ? formatBrlCents(month.paidBrlCents) : "Sem receita"}</strong></span><i><b style={{ width: `${month.paidBrlCents * 100 / graphMaximum}%` }} /></i></div>
            <div className="financial-flow-line direct"><span><small>Custo direto</small><strong>{measuredMoney(month.directOperationalCostBrlCents)}</strong></span><i><b style={{ width: `${month.directOperationalCostBrlCents * 100 / graphMaximum}%` }} /></i></div>
            <div className="financial-flow-line safety"><span><small>Reserva interna</small><strong>{measuredMoney(month.aiSafetyCostBrlCents)}</strong></span><i><b style={{ width: `${month.aiSafetyCostBrlCents * 100 / graphMaximum}%` }} /></i></div>
          </article>)}
          {!monthly.length && <div className="list-empty">Ainda não existem valores históricos para este cliente.</div>}
        </div>
      </article>

      <article className="form-card financial-cost-card">
        <div className="card-heading"><div><h2>De onde vem o custo</h2><p>Segmentação completa do valor descontado da receita.</p></div><Cpu size={19} /></div>
        <div className="financial-cost-segments">
          {costSegments.filter((segment) => segment.value > 0).map((segment) => <div key={segment.label} className={segment.className}>
            <span><strong>{segment.label}</strong><small>{segment.detail}</small></span><em><b>{formatBrlCents(segment.value)}</b><small>{costShare(segment.value, client.totalInternalCostBrlCents).toLocaleString("pt-BR")}% do total</small></em><i><b style={{ width: `${costShare(segment.value, client.totalInternalCostBrlCents)}%` }} /></i>
          </div>)}
          {!client.totalInternalCostBrlCents && <div className="list-empty">Nenhuma execução teve custo medido para este cliente.</div>}
          <div className="financial-cost-totals"><span><small>Subtotal direto</small><strong>{measuredMoney(client.directOperationalCostBrlCents)}</strong></span><span><small>Reserva interna</small><strong>{measuredMoney(client.aiSafetyCostBrlCents)}</strong></span><span className="total"><small>Custo usado no resultado</small><strong>{measuredMoney(client.totalInternalCostBrlCents)}</strong></span></div>
        </div>
      </article>
    </section>

    <section className="form-card financial-method-card">
      <div className="card-heading"><div><h2>Critério e origem dos valores</h2><p>O painel separa valores confirmados de custos calculados para evitar falsa precisão.</p></div><CircleDollarSign size={19} /></div>
      <div className="financial-method-grid">
        <span><strong>Receita</strong><small>Somente checkouts com status PAID registrados pelo provedor de pagamento.</small></span>
        <span><strong>OpenAI direto</strong><small>Tokens medidos na execução × tabela do modelo × câmbio salvo no snapshot.</small></span>
        <span><strong>Custo direto</strong><small>OpenAI direto + worker calculado + validação visual registrada.</small></span>
        <span><strong>Reserva interna</strong><small>Margem de segurança configurada para absorver variação de câmbio e preço da IA. Não é cobrança da OpenAI.</small></span>
        <span><strong>Resultado bruto</strong><small>Receita confirmada − custo direto − reserva interna. Não representa lucro líquido contábil.</small></span>
      </div>
      <small className="financial-formula-note">Fórmula(s): {formulaVersions.join(", ") || "sem snapshot"}. Os valores históricos permanecem associados à cotação e à fórmula registradas em cada execução.</small>
    </section>

    <section className="financial-detail-grid financial-history-grid">
      <article className="form-card table-card">
        <div className="card-heading"><div><h2>Pagamentos confirmados</h2><p>Histórico usado na receita do cliente.</p></div><Landmark size={19} /></div>
        <div className="financial-detail-list">
          {account.checkouts.map((checkout) => <div key={checkout.id}><span><strong>{checkoutKindLabels[checkout.kind] ?? checkout.kind}</strong><small>{dateFormatter.format(checkout.paidAt ?? checkout.createdAt)}{checkout.creditAmount ? ` · ${checkout.creditAmount} créditos` : ""}</small></span><b>{formatBrlCents(checkout.amountCents)}</b></div>)}
          {!account.checkouts.length && <div className="list-empty">Nenhum pagamento confirmado.</div>}
        </div>
      </article>

      <article className="form-card table-card">
        <div className="card-heading"><div><h2>Execuções medidas</h2><p>Detalhamento que compõe o custo.</p></div><Clock3 size={19} /></div>
        <div className="financial-detail-list">
          {snapshots.map((snapshot) => <Link href={`/executions/${snapshot.execution.id}`} key={snapshot.id}><span><strong>{snapshot.execution.demand.title}</strong><small>{snapshot.execution.demand.project.name} · {snapshot.model} · {(snapshot.inputTokens + snapshot.outputTokens).toLocaleString("pt-BR")} tokens</small><small>{executionCostBreakdown(snapshot)}</small></span><b>{formatBrlCents(snapshot.totalInternalCostBrlCents)}</b></Link>)}
          {!snapshots.length && <div className="list-empty">Nenhuma execução com uso medido.</div>}
        </div>
      </article>
    </section>
  </div></AppShell>;
}
