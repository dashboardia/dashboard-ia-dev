import { Activity, Clock3 } from "lucide-react";
import Link from "next/link";

import AppShell from "../../components/app-shell";
import SectionHeader from "../../components/section-header";
import { db } from "../../lib/db";
import { requirePageUser } from "../../lib/page-access";
import { projectAccessWhere } from "../../lib/projects";

export const dynamic = "force-dynamic";

export default async function ExecutionsPage() {
  const user = await requirePageUser();
  const executions = await db.execution.findMany({
    where: { demand: { project: projectAccessWhere(user) } },
    include: { demand: { include: { project: { select: { name: true } } } }, pullRequest: true, _count: { select: { logs: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return <AppShell user={user}><div className="section-page"><SectionHeader eyebrow="AUTOMAÇÃO" title="Execuções" description="Fila, estágio atual, validações e resultado de cada tentativa." /><section className="form-card table-card"><div className="data-table executions-table"><div className="data-head"><span>Demanda</span><span>Projeto</span><span>Estágio</span><span>Status</span><span>Logs</span></div>{executions.map((execution) => <Link className="data-row" href={`/executions/${execution.id}`} key={execution.id}><span className="table-title"><i><Activity size={16} /></i><strong>{execution.demand.title}</strong><small>{execution.model ?? "modelo pendente"}</small></span><span>{execution.demand.project.name}</span><span>{execution.stage}</span><span><em className={`status-pill ${execution.status.toLowerCase()}`}>{execution.status}</em></span><span><Clock3 size={13} /> {execution._count.logs}</span></Link>)}{!executions.length && <div className="list-empty">Nenhuma execução criada.</div>}</div></section></div></AppShell>;
}
