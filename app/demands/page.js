import { FileCode2, Plus } from "lucide-react";
import Link from "next/link";

import AppShell from "../../components/app-shell";
import SectionHeader from "../../components/section-header";
import { db } from "../../lib/db";
import { requirePageUser } from "../../lib/page-access";
import { projectAccessWhere } from "../../lib/projects";

const typeLabels = { BUG: "Correção", FEATURE: "Funcionalidade", REFACTOR: "Refatoração", TEST: "Testes", INVESTIGATION: "Investigação" };
const statusLabels = { DRAFT: "Rascunho", PENDING_APPROVAL: "Aguardando aprovação", APPROVED: "Aprovada", QUEUED: "Na fila", RUNNING: "Em execução", REVIEW: "Em revisão", SUCCEEDED: "Concluída", FAILED: "Falhou", CANCELLED: "Cancelada" };

export const dynamic = "force-dynamic";

export default async function DemandsPage() {
  const user = await requirePageUser();
  const demands = await db.demand.findMany({
    where: { project: projectAccessWhere(user) },
    include: { project: { select: { name: true } }, createdBy: { select: { name: true, githubLogin: true } }, _count: { select: { executions: true } } },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <AppShell user={user}>
      <div className="section-page">
        <SectionHeader eyebrow="TRABALHO" title="Demandas" description="Solicitações estruturadas, aprovações e histórico de execução." action={<Link className="primary" href="/demands/new"><Plus size={18} />Nova demanda</Link>} />
        <section className="form-card table-card">
          <div className="data-table demand-table">
            <div className="data-head"><span>Demanda</span><span>Projeto</span><span>Tipo</span><span>Status</span><span>Execuções</span></div>
            {demands.map((demand) => <Link className="data-row" href={`/demands/${demand.id}`} key={demand.id}><span className="table-title"><i><FileCode2 size={16} /></i><strong>{demand.title}</strong><small>{demand.createdBy.name ?? demand.createdBy.githubLogin}</small></span><span>{demand.project.name}</span><span>{typeLabels[demand.type]}</span><span><em className={`status-pill ${demand.status.toLowerCase()}`}>{statusLabels[demand.status]}</em></span><span>{demand._count.executions}</span></Link>)}
            {!demands.length && <div className="list-empty">Nenhuma demanda disponível.</div>}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
