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

const planLabels = { TRIAL: "Teste", STUDIO: "Studio", AGENCY: "Agência", CUSTOM: "Personalizado" };
const checkoutKindLabels = { PLAN: "Assinatura", CREDIT_PACK: "Pacote de créditos" };
const monthFormatter = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" });
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

function formatMonth(value) {
  return monthFormatter.format(new Date(`${value}-01T00:00:00Z`)).replace(" de ", "/");
}

export default async function ClientFinancialPage({ params }) {
  const user = await requirePageAdmin();
  const { userId } = await params;
  const [account, snapshots] = await Promise.all([
    db.billingAccount.findUnique({
      where: { ownerUserId: userId },
      include: {
        owner: { select: { name: true, email: true, githubLogin: true } },
        checkouts: {
          where: { status: "PAID" },
          select: { id: true, kind: true, targetPlan: true, creditAmount: true, amountCents: true, paidAt: true, createdAt: true },
          orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
        },
      },
    }),
    db.executionFinancialSnapshot.findMany({
      where: { calculationStatus: "MEASURED", execution: { demand: { project: { createdById: userId } } } },
      include: { execution: { select: { id: true, status: true, demand: { select: { id: true, title: true, project: { select: { name: true } } } } } } },
      orderBy: { calculatedAt: "desc" },
    }),
  ]);
  if (!account) notFound();

  const client = buildClientFinancialRows([account], snapshots)[0];
  const monthly = buildClientFinancialMonthlySeries(account.checkouts, snapshots);
  const graphMaximum = Math.max(1, ...monthly.flatMap((month) => [month.paidBrlCents, month.totalInternalCostBrlCents]));
  const adjustedAiCostBrlCents = snapshots.reduce((sum, snapshot) => sum + Math.max(0, snapshot.adjustedAiCostBrlCents || 0), 0);
  const aiAdjustmentBrlCents = Math.max(0, adjustedAiCostBrlCents - client.aiCostBrlCents);
  const formulaVersions = [...new Set(snapshots.map((snapshot) => snapshot.formulaVersion).filter(Boolean))];

  return <AppShell user={user}><div className="section-page financial-page financial-detail-page">
    <Link className="financial-back-link" href="/financial"><ArrowLeft size={14} /> Voltar ao financeiro</Link>
    <SectionHeader eyebrow="DETALHAMENTO FINANCEIRO" title={client.name} description={`${client.email} · ${planLabels[client.plan] ?? client.plan} · ${client.executions} execução(ões) com custo medido`} />

    <section className="financial-kpis">
      <article><Landmark size={18} /><span><small>Recebido confirmado</small><strong>{formatBrlCents(client.paidBrlCents)}</strong><em>{account.checkouts.length} pagamento(s) pago(s)</em></span></article>
      <article><Bot size={18} /><span><small>OpenAI direto</small><strong>{formatBrlCents(client.aiCostBrlCents)}</strong><em>tokens × preço e câmbio registrados</em></span></article>
      <article><Cpu size={18} /><span><small>Custo interno medido</small><strong>{formatBrlCents(client.totalInternalCostBrlCents)}</strong><em>IA ajustada, worker e visual</em></span></article>
      <article className={client.resultBrlCents < 0 ? "negative" : "positive"}><TrendingUp size={18} /><span><small>Resultado bruto medido</small><strong>{formatBrlCents(client.resultBrlCents)}</strong><em>{client.grossMarginPercent == null ? "sem receita confirmada" : `${client.grossMarginPercent.toLocaleString("pt-BR")}% de margem`}</em></span></article>
    </section>

    <section className="financial-detail-grid">
      <article className="form-card financial-chart-card">
        <div className="card-heading"><div><h2>Receita x custo por mês</h2><p>Somente pagamentos confirmados e execuções com uso medido.</p></div><TrendingUp size={19} /></div>
        <div className="financial-chart-legend"><span><i className="revenue" />Recebido</span><span><i className="cost" />Custo interno</span></div>
        <div className="financial-month-chart">
          {monthly.map((month) => <div className="financial-month-column" key={month.month} title={`${formatMonth(month.month)} · recebido ${formatBrlCents(month.paidBrlCents)} · custo ${formatBrlCents(month.totalInternalCostBrlCents)}`}>
            <div className="financial-bars"><i className="revenue" style={{ height: `${Math.max(month.paidBrlCents ? 4 : 0, month.paidBrlCents * 100 / graphMaximum)}%` }} /><i className="cost" style={{ height: `${Math.max(month.totalInternalCostBrlCents ? 4 : 0, month.totalInternalCostBrlCents * 100 / graphMaximum)}%` }} /></div>
            <small>{formatMonth(month.month)}</small><em>{month.executions} exec.</em>
          </div>)}
          {!monthly.length && <div className="list-empty">Ainda não existem valores históricos para este cliente.</div>}
        </div>
      </article>

      <article className="form-card financial-cost-card">
        <div className="card-heading"><div><h2>Composição do custo</h2><p>Valores usados no resultado bruto acima.</p></div><Cpu size={19} /></div>
        <div className="financial-cost-list">
          <span><small>OpenAI direto</small><strong>{formatBrlCents(client.aiCostBrlCents)}</strong></span>
          <span><small>Ajuste de segurança da IA</small><strong>{formatBrlCents(aiAdjustmentBrlCents)}</strong></span>
          <span><small>Worker</small><strong>{formatBrlCents(client.workerCostBrlCents)}</strong></span>
          <span><small>Validação visual</small><strong>{formatBrlCents(client.visualCostBrlCents)}</strong></span>
          <span className="total"><small>Total interno medido</small><strong>{formatBrlCents(client.totalInternalCostBrlCents)}</strong></span>
        </div>
      </article>
    </section>

    <section className="form-card financial-method-card">
      <div className="card-heading"><div><h2>Critério e origem dos valores</h2><p>O painel separa valores confirmados de custos calculados para evitar falsa precisão.</p></div><CircleDollarSign size={19} /></div>
      <div className="financial-method-grid">
        <span><strong>Receita</strong><small>Somente checkouts com status PAID registrados pelo provedor de pagamento.</small></span>
        <span><strong>OpenAI direto</strong><small>Tokens medidos na execução × tabela do modelo × câmbio salvo no snapshot.</small></span>
        <span><strong>Custo interno</strong><small>IA com ajuste configurado + duração do worker + validação visual registrada.</small></span>
        <span><strong>Resultado bruto</strong><small>Receita confirmada − custo interno medido. Não representa lucro contábil e não inclui custos fixos sem medição por cliente.</small></span>
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
          {snapshots.map((snapshot) => <Link href={`/executions/${snapshot.execution.id}`} key={snapshot.id}><span><strong>{snapshot.execution.demand.title}</strong><small>{snapshot.execution.demand.project.name} · {snapshot.model} · {(snapshot.inputTokens + snapshot.outputTokens).toLocaleString("pt-BR")} tokens</small></span><b>{formatBrlCents(snapshot.totalInternalCostBrlCents)}</b></Link>)}
          {!snapshots.length && <div className="list-empty">Nenhuma execução com uso medido.</div>}
        </div>
      </article>
    </section>
  </div></AppShell>;
}
