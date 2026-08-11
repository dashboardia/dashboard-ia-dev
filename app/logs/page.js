import { Logs as LogsIcon } from "lucide-react";
import Link from "next/link";

import AppShell from "../../components/app-shell";
import SectionHeader from "../../components/section-header";
import { db } from "../../lib/db";
import { requirePageUser } from "../../lib/page-access";
import { projectAccessWhere } from "../../lib/projects";

export const dynamic = "force-dynamic";

export default async function LogsPage() {
  const user = await requirePageUser();
  const logs = await db.executionLog.findMany({
    where: { execution: { demand: { project: projectAccessWhere(user) } } },
    include: { execution: { include: { demand: { include: { project: { select: { name: true } } } } } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return <AppShell user={user}><div className="section-page"><SectionHeader eyebrow="RASTREABILIDADE" title="Logs" description="Eventos estruturados de análise, implementação, validação e publicação." /><section className="form-card log-list">{logs.map((entry) => <Link href={`/demands/${entry.execution.demandId}`} key={entry.id}><span className={`log-level ${entry.level}`}>{entry.level}</span><span><strong>{entry.scope}</strong><small>{entry.execution.demand.project.name} · {entry.execution.demand.title}</small></span><p>{entry.message}</p><time>{entry.createdAt.toLocaleString("pt-BR")}</time></Link>)}{!logs.length && <div className="resource-empty"><LogsIcon size={28} /><strong>Nenhum log registrado</strong><span>Os eventos do worker aparecerão aqui.</span></div>}</section></div></AppShell>;
}
