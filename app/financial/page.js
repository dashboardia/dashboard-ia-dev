import { Bot, ChevronRight, CircleDollarSign, Cpu, Landmark, ShieldCheck, TrendingUp } from "lucide-react";
import Link from "next/link";

import AppShell from "../../components/app-shell";
import SectionHeader from "../../components/section-header";
import { buildClientFinancialRows, summarizeClientFinancialRows } from "../../lib/admin-financial";
import { db } from "../../lib/db";
import { formatBrlCents } from "../../lib/financial-shadow";
import { requirePageAdmin } from "../../lib/page-access";

export const dynamic = "force-dynamic";

export default async function FinancialPage() {
  const user = await requirePageAdmin();
  const [accounts, snapshots] = await Promise.all([
    db.billingAccount.findMany({
      include: {
        owner: { select: { name: true, email: true, githubLogin: true } },
        planDefinition: { select: { name: true } },
        checkouts: { where: { status: "PAID" }, select: { amountCents: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.executionFinancialSnapshot.findMany({
      where: { calculationStatus: "MEASURED" },
      include: { execution: { select: { demand: { select: { project: { select: { createdById: true } } } } } } },
    }),
  ]);
  const clients = buildClientFinancialRows(accounts, snapshots);
  const totals = summarizeClientFinancialRows(clients);

  return <AppShell user={user}><div className="section-page financial-page">
    <SectionHeader eyebrow="ADMINISTRAÇÃO" title="Financeiro por cliente" description="Receita confirmada, custos segmentados e resultado bruto operacional de cada cliente." />
    <section className="financial-kpis">
      <article><Landmark size={18} /><span><small>Receita confirmada</small><strong>{formatBrlCents(totals.paidBrlCents)}</strong><em>pagamentos com status pago</em></span></article>
      <article><Bot size={18} /><span><small>Custo direto medido</small><strong>{formatBrlCents(totals.directOperationalCostBrlCents)}</strong><em>OpenAI + worker + validação visual</em></span></article>
      <article><ShieldCheck size={18} /><span><small>Reserva interna</small><strong>{formatBrlCents(totals.aiSafetyCostBrlCents)}</strong><em>segurança aplicada à variação da IA</em></span></article>
      <article className={totals.resultBrlCents < 0 ? "negative" : "positive"}><TrendingUp size={18} /><span><small>Resultado bruto após reserva</small><strong>{formatBrlCents(totals.resultBrlCents)}</strong><em>{totals.grossMarginPercent == null ? "sem receita confirmada" : `${totals.grossMarginPercent.toLocaleString("pt-BR")}% de margem bruta`}</em></span></article>
    </section>
    <p className="financial-result-warning">Este resultado ainda não é lucro líquido. Impostos e custos fixos gerais não atribuídos diretamente aos clientes não entram no cálculo.</p>

    <section className="form-card financial-overall-costs">
      <div className="card-heading"><div><h2>Composição geral do custo</h2><p>Valores efetivamente medidos ou calculados nas {totals.executions} execuções.</p></div><Cpu size={20} /></div>
      <div><span><small>OpenAI direto</small><strong>{formatBrlCents(totals.aiCostBrlCents)}</strong></span><span><small>Worker</small><strong>{formatBrlCents(totals.workerCostBrlCents)}</strong></span><span><small>Validação visual</small><strong>{formatBrlCents(totals.visualCostBrlCents)}</strong></span><span><small>Reserva da IA</small><strong>{formatBrlCents(totals.aiSafetyCostBrlCents)}</strong></span><span className="total"><small>Custo usado no resultado</small><strong>{formatBrlCents(totals.totalInternalCostBrlCents)}</strong></span></div>
    </section>

    <section className="form-card table-card financial-client-card">
      <div className="card-heading financial-table-heading"><div><h2>Clientes</h2><p>{totals.executions} execução(ões) com uso medido</p></div><CircleDollarSign size={20} /></div>
      <div className="data-table financial-client-table">
        <div className="data-head"><span>Cliente</span><span>Receita</span><span>Custo direto</span><span>Reserva IA</span><span>Custo considerado</span><span>Resultado bruto</span></div>
        {clients.map((client) => <Link className="data-row financial-client-link" href={`/financial/${client.userId}`} aria-label={`Abrir detalhes financeiros de ${client.name}`} key={client.userId}>
          <span className="table-title"><i><CircleDollarSign size={16} /></i><strong>{client.name}</strong><small>{client.planName} · {client.executions} execução(ões)</small></span>
          <span><strong>{formatBrlCents(client.paidBrlCents)}</strong></span>
          <span><strong>{formatBrlCents(client.directOperationalCostBrlCents)}</strong><small>IA {formatBrlCents(client.aiCostBrlCents)} · worker {formatBrlCents(client.workerCostBrlCents)} · visual {formatBrlCents(client.visualCostBrlCents)}</small></span>
          <span><strong>{formatBrlCents(client.aiSafetyCostBrlCents)}</strong><small>proteção interna</small></span>
          <span><strong>{formatBrlCents(client.totalInternalCostBrlCents)}</strong><small>direto + reserva</small></span>
          <span className={client.resultBrlCents < 0 ? "financial-negative" : "financial-positive"}><strong>{formatBrlCents(client.resultBrlCents)}</strong><small>{client.grossMarginPercent == null ? "sem receita" : `${client.grossMarginPercent.toLocaleString("pt-BR")}% margem`}</small></span>
          <ChevronRight className="financial-client-chevron" size={15} />
        </Link>)}
        {!clients.length && <div className="list-empty">Nenhum cliente financeiro cadastrado.</div>}
      </div>
    </section>
  </div></AppShell>;
}
