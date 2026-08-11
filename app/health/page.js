import { ExternalLink, HeartPulse } from "lucide-react";

import AppShell from "../../components/app-shell";
import SectionHeader from "../../components/section-header";
import { db } from "../../lib/db";
import { requirePageUser } from "../../lib/page-access";
import { projectAccessWhere } from "../../lib/projects";

export const dynamic = "force-dynamic";

function healthWindowStart() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000);
}

export default async function HealthPage() {
  const user = await requirePageUser();
  const lastDay = healthWindowStart();
  const projects = await db.project.findMany({
    where: { ...projectAccessWhere(user), status: "ACTIVE" },
    include: { healthChecks: { where: { checkedAt: { gte: lastDay } }, orderBy: { checkedAt: "desc" }, take: 1500 } },
    orderBy: { name: "asc" },
  });

  return <AppShell user={user}><div className="section-page"><SectionHeader eyebrow="OBSERVABILIDADE" title="Saúde" description="Disponibilidade real das últimas 24 horas e tempo da verificação mais recente." /><section className="resource-grid">{projects.map((project) => { const latest = project.healthChecks[0]; const healthy = project.healthChecks.filter((check) => check.status === "HEALTHY").length; const availability = project.healthChecks.length ? `${((healthy / project.healthChecks.length) * 100).toFixed(1).replace(".", ",")}%` : "—"; return <article className="resource-card health-card" key={project.id}><span className="resource-icon"><HeartPulse size={21} /></span><div className="resource-title"><strong>{project.name}</strong><span className={`health-dot ${(latest?.status ?? "unknown").toLowerCase()}`} /></div><p>{project.productionUrl ?? "URL de produção não configurada"}</p><div className="health-value"><strong>{availability}</strong><span>{latest ? `${latest.responseTimeMs ?? "—"} ms · HTTP ${latest.statusCode ?? "—"}` : "Sem verificações"}</span></div>{project.productionUrl && <a className="card-external" href={project.productionUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /></a>}</article>; })}{!projects.length && <div className="resource-empty"><HeartPulse size={28} /><strong>Nenhum projeto monitorado</strong></div>}</section></div></AppShell>;
}
