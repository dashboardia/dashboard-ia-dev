import { ExternalLink, GitPullRequest, Search } from "lucide-react";
import Link from "next/link";

import AppShell from "../../components/app-shell";
import Pagination from "../../components/pagination";
import SectionHeader from "../../components/section-header";
import { db } from "../../lib/db";
import { normalizeListQuery, parsePage } from "../../lib/pagination";
import { requirePageUser } from "../../lib/page-access";
import { projectAccessWhere } from "../../lib/projects";

export const dynamic = "force-dynamic";

const statusLabels = {
  DRAFT: "Rascunho",
  OPEN: "Aberto",
  MERGED: "Mesclado",
  CLOSED: "Fechado",
};
const validStatuses = new Set(Object.keys(statusLabels));
const PAGE_SIZE = 24;

export default async function PullRequestsPage({ searchParams }) {
  const user = await requirePageUser();
  const rawFilters = await searchParams;
  const query = normalizeListQuery(rawFilters?.q);
  const projectId = typeof rawFilters?.projectId === "string" ? rawFilters.projectId : "";
  const status = typeof rawFilters?.status === "string" && validStatuses.has(rawFilters.status) ? rawFilters.status : "";
  const page = parsePage(rawFilters?.page);
  const externalNumber = /^\d+$/.test(query) ? Number.parseInt(query, 10) : null;
  const access = projectAccessWhere(user);
  const where = {
    project: { ...access, ...(projectId ? { id: projectId } : {}) },
    ...(status ? { status } : {}),
    ...(query
      ? {
          OR: [
            { title: { contains: query, mode: "insensitive" } },
            { headBranch: { contains: query, mode: "insensitive" } },
            { baseBranch: { contains: query, mode: "insensitive" } },
            { demand: { title: { contains: query, mode: "insensitive" } } },
            ...(Number.isSafeInteger(externalNumber) ? [{ externalNumber }] : []),
          ],
        }
      : {}),
  };

  const [pullRequests, total, projects] = await Promise.all([
    db.pullRequest.findMany({
      where,
      include: { project: { select: { name: true } }, demand: { select: { title: true } } },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.pullRequest.count({ where }),
    db.project.findMany({
      where: { ...access, status: { not: "ARCHIVED" } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <AppShell user={user}>
      <div className="section-page">
        <SectionHeader eyebrow="ENTREGAS" title="Pull Requests" description="Alterações abertas no GitHub somente após aprovação de um Gestor." />
        <form className="list-filters" method="get">
          <label className="filter-search">
            <span>Buscar</span>
            <div><Search size={15} /><input name="q" defaultValue={query} placeholder="Título, número ou branch" /></div>
          </label>
          <label>
            <span>Projeto</span>
            <select name="projectId" defaultValue={projectId}>
              <option value="">Todos</option>
              {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label>
            <span>Status</span>
            <select name="status" defaultValue={status}>
              <option value="">Todos</option>
              {Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
          <button type="submit">Filtrar</button>
          {(query || projectId || status) && <Link href="/pull-requests">Limpar</Link>}
        </form>
        <section className="resource-grid">
          {pullRequests.map((pullRequest) => (
            <a className="resource-card" href={pullRequest.url} target="_blank" rel="noreferrer" key={pullRequest.id}>
              <span className="resource-icon"><GitPullRequest size={21} /></span>
              <div className="resource-title"><strong>#{pullRequest.externalNumber} · {pullRequest.title}</strong></div>
              <p>{pullRequest.project.name} · {pullRequest.demand.title}</p>
              <div className="resource-meta">
                <span>{statusLabels[pullRequest.status] ?? pullRequest.status}</span>
                <span>{pullRequest.headBranch} → {pullRequest.baseBranch}</span>
              </div>
              <ExternalLink className="card-external" size={15} />
            </a>
          ))}
          {!pullRequests.length && (
            <div className="resource-empty">
              <GitPullRequest size={28} />
              <strong>Nenhum Pull Request encontrado</strong>
              <span>Altere os filtros ou aguarde uma entrega aprovada.</span>
            </div>
          )}
        </section>
        <Pagination basePath="/pull-requests" page={page} pageSize={PAGE_SIZE} total={total} params={{ q: query, projectId, status }} />
      </div>
    </AppShell>
  );
}
