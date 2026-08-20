import AppShell from "../../components/app-shell";
import SectionHeader from "../../components/section-header";
import { listBillingPlans, listCreditPacks } from "../../lib/billing-plans";
import { db } from "../../lib/db";
import { getGlobalSettings } from "../../lib/global-settings";
import { requirePageAdmin } from "../../lib/page-access";
import CatalogManager from "./catalog-manager";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const user = await requirePageAdmin();
  const [plans, packs, settings, financialSummary] = await Promise.all([
    listBillingPlans(),
    listCreditPacks(),
    getGlobalSettings(),
    db.executionFinancialSnapshot.aggregate({
      where: { calculationStatus: "MEASURED" },
      _sum: { totalInternalCostBrlCents: true, simulatedConsumedCredits: true },
    }).catch(() => null),
  ]);
  const measuredCredits = financialSummary?._sum.simulatedConsumedCredits ?? 0;
  const observedCostPerCreditCents = measuredCredits > 0
    ? (financialSummary?._sum.totalInternalCostBrlCents ?? 0) / measuredCredits
    : null;

  return <AppShell user={user}><div className="section-page catalog-page">
    <SectionHeader eyebrow="ADMINISTRAÇÃO" title="Catálogo" description="Planos e pacotes adicionais usados na contratação, renovação, limites e concessão de créditos." />
    <CatalogManager initialPlans={plans} initialPacks={packs} creditValueCents={settings.creditValueCents} targetGrossMarginPercent={settings.targetGrossMarginPercent} observedCostPerCreditCents={observedCostPerCreditCents} />
  </div></AppShell>;
}
