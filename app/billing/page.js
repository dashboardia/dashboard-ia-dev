import { ArrowLeft, CalendarDays, Check, ChevronDown, Coins, CreditCard, FolderGit2, Gauge, ShieldCheck } from "lucide-react";
import Link from "next/link";

import AppShell from "../../components/app-shell";
import AutoRefresh from "../../components/auto-refresh";
import SectionHeader from "../../components/section-header";
import { getBillingOverview } from "../../lib/billing";
import { formatPlanPrice, listBillingPlans, listCreditPacks, planChangeKind, planIsPaid } from "../../lib/billing-plans";
import { db } from "../../lib/db";
import { getConfigurationStatus } from "../../lib/env";
import { formatDateTime, getGlobalSettings } from "../../lib/global-settings";
import { requirePageUser } from "../../lib/page-access";
import { CancelSubscriptionButton, ChangePlanButton, CheckoutButton } from "./billing-actions";

export const dynamic = "force-dynamic";

const statusLabels = {
  TRIALING: "Teste ativo",
  PENDING: "Pagamento pendente",
  ACTIVE: "Ativa",
  PAST_DUE: "Pagamento em atraso",
  CANCELED: "Renovação cancelada",
  EXPIRED: "Expirada",
};

function daysRemaining(date) {
  if (!date) return null;
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 86_400_000));
}

export default async function BillingPage({ searchParams }) {
  const user = await requirePageUser();
  const params = await searchParams;
  const returnTo = typeof params?.returnTo === "string" && /^\/executions\/[A-Za-z0-9_-]+$/.test(params.returnTo) ? params.returnTo : null;
  const [overview, settings, publicPlans, creditPacks] = await Promise.all([
    getBillingOverview(user),
    getGlobalSettings(),
    listBillingPlans(db, { includeInactive: false, publicOnly: true }),
    listCreditPacks(db, { includeInactive: false, publicOnly: true }),
  ]);
  const account = overview.account;
  const paidAccount = planIsPaid(overview.plan);
  const pendingPlan = account.pendingPlan ? await db.billingPlanCatalog.findUnique({ where: { code: account.pendingPlan } }) : null;
  const usagePeriodStart = account.plan === "TRIAL" ? account.trialStartedAt : account.cycleStartedAt;
  const [transactions, reservations, interactionTransactions, consumedSummary] = await Promise.all([
    db.creditTransaction.findMany({
      where: { account: { ownerUserId: user.id } },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    db.executionCreditReservation.findMany({
      where: {
        accountId: account.id,
        consumedCredits: { gt: 0 },
        ...(usagePeriodStart ? { settledAt: { gte: usagePeriodStart } } : {}),
      },
      select: {
        consumedCredits: true,
        execution: {
          select: {
            demand: {
              select: {
                id: true,
                title: true,
                project: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { settledAt: "desc" },
      take: 200,
    }),
    db.creditTransaction.findMany({
      where: {
        accountId: account.id,
        type: "CONSUME",
        executionId: { not: null },
        description: { startsWith: "Interação na execução" },
        ...(usagePeriodStart ? { createdAt: { gte: usagePeriodStart } } : {}),
      },
      select: {
        amount: true,
        execution: { select: { demand: { select: { id: true, title: true, project: { select: { name: true } } } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.creditTransaction.aggregate({
      where: { accountId: account.id, type: "CONSUME", ...(usagePeriodStart ? { createdAt: { gte: usagePeriodStart } } : {}) },
      _sum: { amount: true },
    }),
  ]);
  const configuration = getConfigurationStatus();
  const endDate = account.plan === "TRIAL" ? account.trialEndsAt : account.cycleEndsAt;
  const remainingDays = daysRemaining(endDate);
  const callbackOrder = typeof params?.order === "string" ? await db.billingCheckout.findFirst({
    where: { id: params.order, accountId: account.id },
    select: { status: true, kind: true },
  }) : null;
  const checkoutReturn = ["success", "plan", "credits"].includes(params?.checkout);
  const awaitingCheckoutConfirmation = checkoutReturn && (callbackOrder
    ? callbackOrder.status === "PENDING"
    : !(account.status === "ACTIVE" && paidAccount));
  const checkoutConfirmed = checkoutReturn && (callbackOrder
    ? callbackOrder.status === "PAID"
    : account.status === "ACTIVE" && paidAccount);
  const usageByDemand = reservations.reduce((usage, reservation) => {
    const demand = reservation.execution.demand;
    const current = usage.get(demand.id) ?? {
      id: demand.id,
      title: demand.title,
      projectName: demand.project.name,
      consumedCredits: 0,
      executions: 0,
      interactions: 0,
    };
    current.consumedCredits += reservation.consumedCredits;
    current.executions += 1;
    usage.set(demand.id, current);
    return usage;
  }, new Map());
  for (const transaction of interactionTransactions) {
    const demand = transaction.execution?.demand;
    if (!demand) continue;
    const current = usageByDemand.get(demand.id) ?? { id: demand.id, title: demand.title, projectName: demand.project.name, consumedCredits: 0, executions: 0, interactions: 0 };
    current.consumedCredits += Math.abs(transaction.amount);
    current.interactions += 1;
    usageByDemand.set(demand.id, current);
  }
  const demandUsage = Array.from(usageByDemand.values()).sort((left, right) => right.consumedCredits - left.consumedCredits);
  const consumedCredits = Math.abs(consumedSummary._sum.amount ?? 0);

  return <AppShell user={user}><div className="section-page billing-page">
    <AutoRefresh active={awaitingCheckoutConfirmation} interval={3000} showIndicator={false} />
    <SectionHeader eyebrow="ASSINATURA" title="Plano e créditos" description="Controle de acesso, saldo de créditos e cobrança do Dashboard IA." />
    {params?.welcome === "1" && <div className="billing-notice success"><ShieldCheck size={18} /><span><strong>Seu teste de 7 dias começou.</strong> Você recebeu 300 créditos e pode conectar 1 projeto sem informar cartão.</span></div>}
    {awaitingCheckoutConfirmation && <div className="billing-notice"><CreditCard size={18} /><span><strong>Confirmando pagamento.</strong> Esta página será atualizada automaticamente após a confirmação segura do Asaas.</span></div>}
    {checkoutConfirmed && <div className="billing-notice success"><ShieldCheck size={18} /><span><strong>Pagamento confirmado.</strong> {callbackOrder?.kind === "CREDIT_PACK" || params?.checkout === "credits" ? "Os créditos foram adicionados ao seu saldo." : "Seu plano já está ativo."}</span></div>}
    {returnTo && <div className="billing-notice execution-return"><Coins size={18} /><span><strong>{checkoutConfirmed ? "Créditos disponíveis para continuar." : "Esta recarga está vinculada à sua execução."}</strong>{checkoutConfirmed ? "Volte para a demanda e retome a IA do ponto em que ela parou." : "Escolha uma recarga abaixo. Sua branch e seu histórico permanecem preservados."}</span><Link href={returnTo}><ArrowLeft size={14} />Voltar para a execução</Link></div>}
    {pendingPlan && <div className="billing-notice"><CalendarDays size={18} /><span><strong>Troca de plano agendada.</strong> O plano {pendingPlan.name} entra em vigor no próximo ciclo confirmado.</span></div>}
    {!configuration.asaas && user.globalRole !== "ADMIN" && <div className="billing-notice warning"><span><strong>Checkout em configuração.</strong> O administrador precisa informar as variáveis do Asaas antes das contratações.</span></div>}

    <section className="billing-overview-card">
      <div><small>Plano atual</small><strong>{overview.plan.name}</strong><span className={`billing-status ${account.status.toLowerCase()}`}>{statusLabels[account.status]}</span></div>
      <div><small>Créditos disponíveis</small><strong>{overview.availableCredits == null ? "Ilimitados" : overview.availableCredits.toLocaleString("pt-BR")}</strong><span>{overview.reservedCredits.toLocaleString("pt-BR")} protegidos em operações em andamento</span></div>
      <div><small>Projetos</small><strong>{overview.projectCount}{overview.plan.projectLimit ? `/${overview.plan.projectLimit}` : ""}</strong><span>repositórios conectados</span></div>
      <div><small>{account.plan === "TRIAL" ? "Teste" : "Ciclo atual"}</small><strong>{remainingDays == null ? "Contínuo" : `${remainingDays} dia(s)`}</strong><span>{endDate ? `até ${formatDateTime(endDate, settings.timeZone)}` : "sem vencimento"}</span></div>
    </section>

    <details className="billing-section billing-collapsible billing-usage"><summary className="billing-collapsible-header"><span><Coins size={20} /></span><div><h2>Uso de créditos</h2><p>Saldo e consumo no ciclo atual.</p></div><ChevronDown size={18} /></summary><div className="billing-collapsible-content"><div className="billing-usage-summary"><span><small>Disponíveis</small><strong>{overview.availableCredits == null ? "Ilimitados" : overview.availableCredits.toLocaleString("pt-BR")}</strong></span><span><small>Consumidos</small><strong>{consumedCredits.toLocaleString("pt-BR")}</strong></span><span><small>Protegidos temporariamente</small><strong>{overview.reservedCredits.toLocaleString("pt-BR")}</strong></span></div><div className="billing-demand-usage">{demandUsage.map((demand) => <Link href={`/demands/${demand.id}`} key={demand.id}><span><strong>{demand.title}</strong><small>{demand.projectName} · {demand.executions} execução(ões){demand.interactions ? ` · ${demand.interactions} ajuste(s)` : ""}</small></span><em>{demand.consumedCredits.toLocaleString("pt-BR")} créditos</em></Link>)}{!demandUsage.length && <p className="list-empty">Nenhum crédito foi consumido neste ciclo.</p>}</div></div></details>

    <section className="billing-section"><div className="card-heading"><div><h2>Planos</h2><p>Escolha conforme a quantidade de projetos e execuções simultâneas.</p></div><CreditCard size={20} /></div><div className="billing-plan-grid">
      {publicPlans.map((plan) => { const immediate = planChangeKind(overview.plan, plan) === "UPGRADE"; return <article className={`billing-plan ${account.plan === plan.code ? "current" : ""}`} key={plan.code}><span className="plan-name">{plan.name}</span><strong>{formatPlanPrice(plan.priceCents)}<small>/mês</small></strong><ul><li><Coins size={15} />{plan.includedCredits.toLocaleString("pt-BR")} créditos mensais</li><li><FolderGit2 size={15} />Até {plan.projectLimit} projetos</li><li><Gauge size={15} />{plan.parallelExecutionLimit} execuções simultâneas</li><li><Check size={15} />Usuários ilimitados</li></ul>{account.plan === plan.code && account.status === "ACTIVE" ? <span className="current-plan-label">Plano atual</span> : account.status === "ACTIVE" && paidAccount ? <ChangePlanButton plan={plan.code} credits={plan.includedCredits} immediate={immediate} disabledUntil={!immediate && account.cycleEndsAt ? `Liberação em ${formatDateTime(account.cycleEndsAt, settings.timeZone)}` : null} /> : <CheckoutButton kind="PLAN" value={plan.code} disabled={!configuration.asaas || user.globalRole === "ADMIN"} returnTo={returnTo}>Assinar {plan.name}</CheckoutButton>}</article>; })}
      <article className="billing-plan custom"><span className="plan-name">Sob medida</span><strong>Comercial</strong><ul><li><Check size={15} />Limites personalizados</li><li><Check size={15} />Volume e operação dedicados</li><li><Check size={15} />Acompanhamento comercial</li></ul>{configuration.asaas && process.env.BILLING_CONTACT_URL ? <a className="secondary-button" href={process.env.BILLING_CONTACT_URL}>Falar sobre o plano</a> : <span className="current-plan-label">Fale com o administrador</span>}</article>
    </div></section>

    {user.globalRole !== "ADMIN" && <section className="billing-section" id="credit-packs"><div className="card-heading"><div><h2>Recarga avulsa</h2><p>Pague via Pix ou cartão de crédito, sem exigir plano ativo. O saldo comprado é somado ao atual e, sem assinatura, segue os limites do acesso gratuito.</p></div><Coins size={20} /></div><div className="credit-pack-grid">{creditPacks.map((pack) => <article key={pack.code}><strong>{pack.credits.toLocaleString("pt-BR")}</strong><span>créditos · válidos por {pack.validityMonths} meses</span><em>{formatPlanPrice(pack.priceCents)}</em><CheckoutButton kind="CREDIT_PACK" value={pack.code} disabled={!configuration.asaas} returnTo={returnTo}>Recarregar créditos</CheckoutButton></article>)}</div></section>}

    <details className="billing-section billing-collapsible billing-history"><summary className="billing-collapsible-header"><span><CalendarDays size={20} /></span><div><h2>Movimentações</h2><p>Histórico auditável de concessões, reservas, consumo e devoluções.</p></div><ChevronDown size={18} /></summary><div className="billing-collapsible-content">{transactions.map((transaction) => <span key={transaction.id}><time>{formatDateTime(transaction.createdAt, settings.timeZone)}</time><strong>{transaction.description || transaction.type}</strong><em className={transaction.amount < 0 ? "negative" : "positive"}>{transaction.amount > 0 ? "+" : ""}{transaction.amount} créditos</em></span>)}{!transactions.length && <p className="list-empty">Nenhuma movimentação registrada.</p>}</div></details>

    {account.status === "ACTIVE" && paidAccount && <section className="billing-cancel"><p>Ao cancelar, novas cobranças são interrompidas. Histórico e downloads permanecem disponíveis; execuções ficam bloqueadas após o fim do ciclo.</p><CancelSubscriptionButton /></section>}
  </div></AppShell>;
}
