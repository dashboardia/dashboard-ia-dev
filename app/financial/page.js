import { Bot, ChevronRight, CircleDollarSign, Cpu, Landmark, TrendingUp } from "lucide-react";
import Link from "next/link";

import AppShell from "../../components/app-shell";
import SectionHeader from "../../components/section-header";
import { buildClientFinancialRows, summarizeClientFinancialRows } from "../../lib/admin-financial";
import { db } from "../../lib/db";
import { formatBrlCents } from "../../lib/financial-shadow";
import { requirePageAdmin } from "../../lib/page-access";

export const dynamic = "force-dynamic";

const planLabels = { TRIAL: "Teste", STUDIO: "Studio", AGENCY: "Agência", CUSTOM: "Personalizado" };

export default async function FinancialPage() {
  const user = await requirePageAdmin();
  const [accounts, snapshots] = await Promise.all([
    db.billingAccount.findMany({
      include: {
        owner: { select: { name: true, email: true, githubLogin: true } },
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
    <SectionHeader eyebrow="ADMINISTRAÇÃO" title="Financeiro por cliente" description="Compare os pagamentos confirmados com o custo medido da OpenAI e da operação da plataforma." />
    <section className="financial-kpis">
      <article><Landmark size={18} /><span><small>Recebido</small><strong>{formatBrlCents(totals.paidBrlCents)}</strong><em>pagamentos confirmados</em></span></article>
      <article><Bot size={18} /><span><small>Custo OpenAI</small><strong>{formatBrlCents(totals.aiCostBrlCents)}</strong><em>tokens medidos na cotação registrada</em></span></article>
      <article><Cpu size={18} /><span><small>Custo interno total</small><strong>{formatBrlCents(totals.totalInternalCostBrlCents)}</strong><em>IA, worker e validação visual</em></span></article>
      <article className={totals.resultBrlCents < 0 ? "negative" : "positive"}><TrendingUp size={18} /><span><small>Resultado bruto</small><strong>{formatBrlCents(totals.resultBrlCents)}</strong><em>{totals.grossMarginPercent == null ? "sem receita confirmada" : `${totals.grossMarginPercent.toLocaleString("pt-BR")}% de margem`}</em></span></article>
    </section>

    <section className="form-card table-card financial-client-card">
      <div className="card-heading financial-table-heading"><div><h2>Clientes</h2><p>{totals.executions} execução(ões) com uso medido</p></div><CircleDollarSign size={20} /></div>
      <div className="data-table financial-client-table">
        <div className="data-head"><span>Cliente</span><span>Plano</span><span>Pago</span><span>OpenAI</span><span>Custo total</span><span>Resultado</span></div>
        {clients.map((client) => <Link className="data-row financial-client-link" href={`/financial/${client.userId}`} aria-label={`Abrir detalhes financeiros de ${client.name}`} key={client.userId}>
          <span className="table-title"><i><CircleDollarSign size={16} /></i><strong>{client.name}</strong><small>{client.email} · {client.executions} execução(ões)</small></span>
          <span><em className="status-pill">{planLabels[client.plan] ?? client.plan}</em></span>
          <span><strong>{formatBrlCents(client.paidBrlCents)}</strong></span>
          <span title={client.models.join(", ") || "Sem uso medido"}><strong>{formatBrlCents(client.aiCostBrlCents)}</strong><small>{client.models.join(", ") || "—"}</small></span>
          <span><strong>{formatBrlCents(client.totalInternalCostBrlCents)}</strong><small>worker {formatBrlCents(client.workerCostBrlCents)}</small></span>
          <span className={client.resultBrlCents < 0 ? "financial-negative" : "financial-positive"}><strong>{formatBrlCents(client.resultBrlCents)}</strong><small>{client.grossMarginPercent == null ? "sem pagamento" : `${client.grossMarginPercent.toLocaleString("pt-BR")}%`}</small></span>
          <ChevronRight className="financial-client-chevron" size={15} />
        </Link>)}
        {!clients.length && <div className="list-empty">Nenhum cliente financeiro cadastrado.</div>}
      </div>
    </section>
  </div></AppShell>;
}
