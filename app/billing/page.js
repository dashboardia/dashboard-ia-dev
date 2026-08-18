import { CalendarDays, Check, Coins, CreditCard, FolderGit2, Gauge, ShieldCheck } from "lucide-react";

import AppShell from "../../components/app-shell";
import SectionHeader from "../../components/section-header";
import { getBillingOverview } from "../../lib/billing";
import { BILLING_PLANS, CREDIT_PACKS, formatPlanPrice } from "../../lib/billing-plans";
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
  const [overview, settings, transactions] = await Promise.all([
    getBillingOverview(user),
    getGlobalSettings(),
    db.creditTransaction.findMany({
      where: { account: { ownerUserId: user.id } },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
  ]);
  const configuration = getConfigurationStatus();
  const account = overview.account;
  const endDate = account.plan === "TRIAL" ? account.trialEndsAt : account.cycleEndsAt;
  const remainingDays = daysRemaining(endDate);

  return <AppShell user={user}><div className="section-page billing-page">
    <SectionHeader eyebrow="ASSINATURA" title="Plano e créditos" description="Controle de acesso, saldo de créditos e cobrança do Dashboard IA." />
    {params?.welcome === "1" && <div className="billing-notice success"><ShieldCheck size={18} /><span><strong>Seu teste de 7 dias começou.</strong> Você recebeu 300 créditos e pode conectar 1 projeto sem informar cartão.</span></div>}
    {params?.checkout === "success" && <div className="billing-notice"><CreditCard size={18} /><span><strong>Pagamento enviado.</strong> O plano será liberado após a confirmação segura do Asaas.</span></div>}
    {account.pendingPlan && <div className="billing-notice"><CalendarDays size={18} /><span><strong>Troca de plano agendada.</strong> O plano {BILLING_PLANS[account.pendingPlan].name} entra em vigor no próximo ciclo confirmado.</span></div>}
    {!configuration.asaas && user.globalRole !== "ADMIN" && <div className="billing-notice warning"><span><strong>Checkout em configuração.</strong> O administrador precisa informar as variáveis do Asaas antes das contratações.</span></div>}

    <section className="billing-overview-card">
      <div><small>Plano atual</small><strong>{overview.plan.name}</strong><span className={`billing-status ${account.status.toLowerCase()}`}>{statusLabels[account.status]}</span></div>
      <div><small>Créditos disponíveis</small><strong>{overview.availableCredits == null ? "Ilimitados" : overview.availableCredits.toLocaleString("pt-BR")}</strong><span>{overview.reservedCredits.toLocaleString("pt-BR")} reservados</span></div>
      <div><small>Projetos</small><strong>{overview.projectCount}{overview.plan.projectLimit ? `/${overview.plan.projectLimit}` : ""}</strong><span>repositórios conectados</span></div>
      <div><small>{account.plan === "TRIAL" ? "Teste" : "Ciclo atual"}</small><strong>{remainingDays == null ? "Contínuo" : `${remainingDays} dia(s)`}</strong><span>{endDate ? `até ${formatDateTime(endDate, settings.timeZone)}` : "sem vencimento"}</span></div>
    </section>

    <section className="billing-section"><div className="card-heading"><div><h2>Planos</h2><p>Escolha conforme a quantidade de projetos e execuções simultâneas.</p></div><CreditCard size={20} /></div><div className="billing-plan-grid">
      {[BILLING_PLANS.STUDIO, BILLING_PLANS.AGENCY].map((plan) => <article className={`billing-plan ${account.plan === plan.code ? "current" : ""}`} key={plan.code}><span className="plan-name">{plan.name}</span><strong>{formatPlanPrice(plan.priceCents)}<small>/mês</small></strong><ul><li><Coins size={15} />{plan.includedCredits.toLocaleString("pt-BR")} créditos mensais</li><li><FolderGit2 size={15} />Até {plan.projectLimit} projetos</li><li><Gauge size={15} />{plan.parallelExecutionLimit} execuções simultâneas</li><li><Check size={15} />Usuários ilimitados</li></ul>{account.plan === plan.code && account.status === "ACTIVE" ? <span className="current-plan-label">Plano atual</span> : account.status === "ACTIVE" && ["STUDIO", "AGENCY"].includes(account.plan) ? <ChangePlanButton plan={plan.code} /> : <CheckoutButton kind="PLAN" value={plan.code} disabled={!configuration.asaas || user.globalRole === "ADMIN"}>Assinar {plan.name}</CheckoutButton>}</article>)}
      <article className="billing-plan custom"><span className="plan-name">Sob medida</span><strong>Comercial</strong><ul><li><Check size={15} />Limites personalizados</li><li><Check size={15} />Volume e operação dedicados</li><li><Check size={15} />Acompanhamento comercial</li></ul>{configuration.asaas && process.env.BILLING_CONTACT_URL ? <a className="secondary-button" href={process.env.BILLING_CONTACT_URL}>Falar sobre o plano</a> : <span className="current-plan-label">Fale com o administrador</span>}</article>
    </div></section>

    {account.status === "ACTIVE" && ["STUDIO", "AGENCY"].includes(account.plan) && <section className="billing-section"><div className="card-heading"><div><h2>Créditos adicionais</h2><p>Mesmo valor unitário de R$ 0,10; validade de 12 meses e assinatura ativa obrigatória.</p></div><Coins size={20} /></div><div className="credit-pack-grid">{CREDIT_PACKS.map((pack) => <article key={pack.code}><strong>{pack.credits.toLocaleString("pt-BR")}</strong><span>créditos</span><em>{formatPlanPrice(pack.priceCents)}</em><CheckoutButton kind="CREDIT_PACK" value={pack.code} disabled={!configuration.asaas}>Comprar</CheckoutButton></article>)}</div></section>}

    <section className="billing-section billing-history"><div className="card-heading"><div><h2>Movimentações</h2><p>Histórico auditável de concessões, reservas, consumo e devoluções.</p></div><CalendarDays size={20} /></div><div>{transactions.map((transaction) => <span key={transaction.id}><time>{formatDateTime(transaction.createdAt, settings.timeZone)}</time><strong>{transaction.description || transaction.type}</strong><em className={transaction.amount < 0 ? "negative" : "positive"}>{transaction.amount > 0 ? "+" : ""}{transaction.amount} créditos</em></span>)}{!transactions.length && <p className="list-empty">Nenhuma movimentação registrada.</p>}</div></section>

    {account.status === "ACTIVE" && ["STUDIO", "AGENCY"].includes(account.plan) && <section className="billing-cancel"><p>Ao cancelar, novas cobranças são interrompidas. Histórico e downloads permanecem disponíveis; execuções ficam bloqueadas após o fim do ciclo.</p><CancelSubscriptionButton /></section>}
  </div></AppShell>;
}
