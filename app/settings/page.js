import { CheckCircle2, CircleAlert, Coins, Settings } from "lucide-react";
import AppShell from "../../components/app-shell";
import SectionHeader from "../../components/section-header";
import UserPreferencesForm from "../../components/user-preferences-form";
import { db } from "../../lib/db";
import { getConfigurationStatus } from "../../lib/env";
import { formatBrlCents } from "../../lib/financial-shadow";
import { getGlobalSettings } from "../../lib/global-settings";
import { requirePageUser } from "../../lib/page-access";
import { getWorkerRuntimeStatus } from "../../lib/worker-heartbeat";
import GlobalSettingsForm from "./global-settings-form";

export const dynamic = "force-dynamic";
export default async function SettingsPage() {
  const user = await requirePageUser();
  const configuration = getConfigurationStatus();
  const globalSettings = user.globalRole === "ADMIN" ? await getGlobalSettings() : null;
  const financialSummary = user.globalRole === "ADMIN" && configuration.database && db.executionFinancialSnapshot ? await db.executionFinancialSnapshot.aggregate({ where: { calculationStatus: "MEASURED" }, _count: { id: true }, _sum: { totalInternalCostBrlCents: true, simulatedConsumedCredits: true, simulatedCommercialValueBrlCents: true } }).catch(() => null) : null;
  const worker = configuration.database && configuration.worker ? await getWorkerRuntimeStatus().catch(() => ({ online: false, instances: 0 })) : { online: false, instances: 0 };
  const items = [["PostgreSQL", configuration.database, "DATABASE_URL"], ["GitHub OAuth", configuration.githubAuth, "GITHUB_ID, GITHUB_SECRET e NEXTAUTH_SECRET"], ["Proteção dos tokens OAuth", configuration.tokenEncryption, "TOKEN_ENCRYPTION_KEY"], ["Webhook GitHub", configuration.githubWebhook, "GITHUB_WEBHOOK_SECRET e NEXTAUTH_URL"], ["OpenAI", configuration.openai, "OPENAI_API_KEY"], ["Asaas", configuration.asaas, "ASAAS_API_KEY, ASAAS_WEBHOOK_TOKEN e NEXTAUTH_URL"], ["Host de ambientes", configuration.previewHost, "PREVIEW_HOST_URL e PREVIEW_HOST_TOKEN"], ["Worker", worker.online, worker.online ? `${worker.instances} instância(s) ativa(s)` : "Aguardando heartbeat do serviço worker", worker.online ? "Online" : "Offline"]];
  const measuredExecutions = financialSummary?._count.id ?? 0;
  const calibrationProgress = Math.min(20, measuredExecutions);
  const measuredCredits = financialSummary?._sum.simulatedConsumedCredits ?? 0;
  return <AppShell user={user}><div className="section-page narrow-page"><SectionHeader eyebrow="AMBIENTE" title="Configurações" description="Estado das integrações. Os valores secretos nunca são exibidos na interface." /><UserPreferencesForm /><section className="form-card detail-card"><div className="card-heading"><div><h2>Integrações</h2><p>Serviços e credenciais do ambiente de execução</p></div><Settings size={20} /></div><div className="configuration-list">{items.map(([label, configured, variables, state]) => <div key={label}>{configured ? <CheckCircle2 className="configured" size={18} /> : <CircleAlert className="pending" size={18} />}<span><strong>{label}</strong><small>{variables}</small></span><em>{state ?? (configured ? "Configurado" : "Pendente")}</em></div>)}</div></section>{globalSettings && <><section className="form-card detail-card full-card financial-shadow-summary"><div className="card-heading"><div><h2>Calibração financeira</h2><p>Medição interna em modo silencioso; nenhuma cobrança está ativa.</p></div><Coins size={20} /></div><div className="financial-summary-grid"><span><small>Execuções registradas</small><strong>{measuredExecutions}</strong></span><span><small>Custo interno estimado</small><strong>{formatBrlCents(financialSummary?._sum.totalInternalCostBrlCents)}</strong></span><span><small>Créditos simulados</small><strong>{measuredCredits}</strong></span><span><small>Valor comercial simulado</small><strong>{formatBrlCents(financialSummary?._sum.simulatedCommercialValueBrlCents)}</strong></span></div><div className="calibration-progress"><span style={{ width: `${calibrationProgress * 5}%` }} /><small>{calibrationProgress}/20 execuções para a primeira revisão da fórmula</small></div></section><GlobalSettingsForm initialSettings={globalSettings} /></>}</div></AppShell>;
}
