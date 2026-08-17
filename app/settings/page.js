import { CheckCircle2, CircleAlert, Settings } from "lucide-react";

import AppShell from "../../components/app-shell";
import SectionHeader from "../../components/section-header";
import { getConfigurationStatus } from "../../lib/env";
import { getGlobalSettings } from "../../lib/global-settings";
import { requirePageUser } from "../../lib/page-access";
import { getWorkerRuntimeStatus } from "../../lib/worker-heartbeat";
import GlobalSettingsForm from "./global-settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requirePageUser();
  const configuration = getConfigurationStatus();
  const globalSettings = user.globalRole === "ADMIN" ? await getGlobalSettings() : null;
  const worker = configuration.database && configuration.worker
    ? await getWorkerRuntimeStatus().catch(() => ({ online: false, instances: 0 }))
    : { online: false, instances: 0 };
  const items = [
    ["PostgreSQL", configuration.database, "DATABASE_URL"],
    ["GitHub OAuth", configuration.githubAuth, "GITHUB_ID, GITHUB_SECRET e NEXTAUTH_SECRET"],
    ["Webhook GitHub", configuration.githubWebhook, "GITHUB_WEBHOOK_SECRET e NEXTAUTH_URL"],
    ["OpenAI", configuration.openai, "OPENAI_API_KEY"],
    ["Worker", worker.online, worker.online ? `${worker.instances} instância(s) ativa(s)` : "Aguardando heartbeat do serviço worker", worker.online ? "Online" : "Offline"],
  ];
  return <AppShell user={user}><div className="section-page narrow-page"><SectionHeader eyebrow="AMBIENTE" title="Configurações" description="Estado das integrações. Os valores secretos nunca são exibidos na interface." /><section className="form-card detail-card"><div className="card-heading"><div><h2>Integrações</h2><p>Serviços e credenciais do ambiente de execução</p></div><Settings size={20} /></div><div className="configuration-list">{items.map(([label, configured, variables, state]) => <div key={label}>{configured ? <CheckCircle2 className="configured" size={18} /> : <CircleAlert className="pending" size={18} />}<span><strong>{label}</strong><small>{variables}</small></span><em>{state ?? (configured ? "Configurado" : "Pendente")}</em></div>)}</div></section>{globalSettings && <GlobalSettingsForm initialSettings={globalSettings} />}</div></AppShell>;
}
