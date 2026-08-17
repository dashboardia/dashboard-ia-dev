import { Logs as LogsIcon, Search } from "lucide-react";
import Link from "next/link";

import AppShell from "../../components/app-shell";
import Pagination from "../../components/pagination";
import SectionHeader from "../../components/section-header";
import { db } from "../../lib/db";
import { normalizeListQuery, parsePage } from "../../lib/pagination";
import { requirePageUser } from "../../lib/page-access";
import { projectAccessWhere } from "../../lib/projects";
import { explainError, logLevelLabels, logScopeLabels } from "../../lib/error-messages";

export const dynamic = "force-dynamic";

const levels = { info: "Informação", warn: "Alerta", error: "Erro" };
const PAGE_SIZE = 50;

export default async function LogsPage({ searchParams }) {
  const user = await requirePageUser();
  const rawFilters = await searchParams;
  const query = normalizeListQuery(rawFilters?.q);
  const projectId = typeof rawFilters?.projectId === "string" ? rawFilters.projectId : "";
  const level = typeof rawFilters?.level === "string" && Object.hasOwn(levels, rawFilters.level) ? rawFilters.level : "";
  const page = parsePage(rawFilters?.page);
  const access = projectAccessWhere(user);
  const where = {
    execution: { demand: { project: access, ...(projectId ? { projectId } : {}) } },
    ...(level ? { level } : {}),
    ...(query ? { OR: [{ scope: { contains: query, mode: "insensitive" } }, { message: { contains: query, mode: "insensitive" } }] } : {}),
  };

  const [logs, total, projects] = await Promise.all([
    db.executionLog.findMany({
      where,
      include: { execution: { include: { demand: { include: { project: { select: { name: true } } } } } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.executionLog.count({ where }),
    db.project.findMany({ where: { ...access, status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return <AppShell user={user}><div className="section-page"><SectionHeader eyebrow="RASTREABILIDADE" title="Logs" description="Eventos estruturados de análise, implementação, validação e publicação." /><form className="list-filters" method="get"><label className="filter-search"><span>Buscar</span><div><Search size={15} /><input name="q" defaultValue={query} placeholder="Escopo ou mensagem" /></div></label><label><span>Projeto</span><select name="projectId" defaultValue={projectId}><option value="">Todos</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label><label><span>Nível</span><select name="level" defaultValue={level}><option value="">Todos</option>{Object.entries(levels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><button type="submit">Filtrar</button>{(query || projectId || level) && <Link href="/logs">Limpar</Link>}</form><section className="form-card log-list">{logs.map((entry) => { const error = entry.level === "error" ? explainError(entry.message) : null; return <Link href={`/executions/${entry.executionId}`} key={entry.id}><span className={`log-level ${entry.level}`}>{logLevelLabels[entry.level] ?? entry.level}</span><span><strong>{logScopeLabels[entry.scope] ?? entry.scope}</strong><small>{entry.execution.demand.project.name} · {entry.execution.demand.title}</small></span><p>{error ? `${error.title}. ${error.action}` : entry.message}</p><time>{entry.createdAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</time></Link>; })}{!logs.length && <div className="resource-empty"><LogsIcon size={28} /><strong>Nenhum log encontrado</strong><span>Altere os filtros ou aguarde novos eventos do worker.</span></div>}</section><Pagination basePath="/logs" page={page} pageSize={PAGE_SIZE} total={total} params={{ q: query, projectId, level }} /></div></AppShell>;
}
