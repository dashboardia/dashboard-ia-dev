import { FileCode2, Plus, Search } from "lucide-react";
import Link from "next/link";

import AppShell from "../../components/app-shell";
import Pagination from "../../components/pagination";
import SectionHeader from "../../components/section-header";
import { db } from "../../lib/db";
import { normalizeListQuery, parsePage } from "../../lib/pagination";
import { requirePageUser } from "../../lib/page-access";
import { projectAccessWhere } from "../../lib/projects";

const typeLabels = { BUG: "Correção", FEATURE: "Funcionalidade", REFACTOR: "Refatoração", TEST: "Testes", INVESTIGATION: "Investigação" };
const statusLabels = { DRAFT: "Rascunho", PENDING_APPROVAL: "Aguardando aprovação", APPROVED: "Aprovada", QUEUED: "Na fila", RUNNING: "Em execução", REVIEW: "Em revisão", SUCCEEDED: "Concluída", FAILED: "Falhou", CANCELLED: "Cancelada" };
const validStatuses = new Set(Object.keys(statusLabels));
const PAGE_SIZE = 25;

export const dynamic = "force-dynamic";

export default async function DemandsPage({ searchParams }) {
  const user = await requirePageUser();
  const rawFilters = await searchParams;
  const query = normalizeListQuery(rawFilters?.q);
  const projectId = typeof rawFilters?.projectId === "string" ? rawFilters.projectId : "";
  const status = typeof rawFilters?.status === "string" && validStatuses.has(rawFilters.status) ? rawFilters.status : "";
  const page = parsePage(rawFilters?.page);
  const access = projectAccessWhere(user);
  const where = {
    project: access,
    ...(projectId ? { projectId } : {}),
    ...(status ? { status } : {}),
    ...(query ? { OR: [{ title: { contains: query, mode: "insensitive" } }, { description: { contains: query, mode: "insensitive" } }] } : {}),
  };

  const [demands, total, projects] = await Promise.all([
    db.demand.findMany({
      where,
      include: { project: { select: { name: true } }, createdBy: { select: { name: true, githubLogin: true } }, _count: { select: { executions: true } } },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.demand.count({ where }),
    db.project.findMany({ where: { ...access, status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <AppShell user={user}>
      <div className="section-page">
        <SectionHeader eyebrow="TRABALHO" title="Demandas" description="Solicitações estruturadas, aprovações e histórico de execução." action={<Link className="primary" href="/demands/new"><Plus size={18} />Nova demanda</Link>} />
        <form className="list-filters" method="get">
          <label className="filter-search"><span>Buscar</span><div><Search size={15} /><input name="q" defaultValue={query} placeholder="Título ou descrição" /></div></label>
          <label><span>Projeto</span><select name="projectId" defaultValue={projectId}><option value="">Todos</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
          <label><span>Status</span><select name="status" defaultValue={status}><option value="">Todos</option>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <button type="submit">Filtrar</button>
          {(query || projectId || status) && <Link href="/demands">Limpar</Link>}
        </form>
        <section className="form-card table-card">
          <div className="data-table demand-table">
            <div className="data-head"><span>Demanda</span><span>Projeto</span><span>Tipo</span><span>Status</span><span>Execuções</span></div>
            {demands.map((demand) => <Link className="data-row" href={`/demands/${demand.id}`} key={demand.id}><span className="table-title"><i><FileCode2 size={16} /></i><strong>{demand.title}</strong><small>{demand.createdBy.name ?? demand.createdBy.githubLogin}</small></span><span>{demand.project.name}</span><span>{typeLabels[demand.type]}</span><span><em className={`status-pill ${demand.status.toLowerCase()}`}>{statusLabels[demand.status]}</em></span><span>{demand._count.executions}</span></Link>)}
            {!demands.length && <div className="list-empty">Nenhuma demanda encontrada para estes filtros.</div>}
          </div>
        </section>
        <Pagination basePath="/demands" page={page} pageSize={PAGE_SIZE} total={total} params={{ q: query, projectId, status }} />
      </div>
    </AppShell>
  );
}
