import { Activity, Clock3, Search } from "lucide-react";
import Link from "next/link";

import AppShell from "../../components/app-shell";
import AutoRefresh from "../../components/auto-refresh";
import Pagination from "../../components/pagination";
import SectionHeader from "../../components/section-header";
import { db } from "../../lib/db";
import { executionControlState } from "../../lib/execution-control-state";
import { executionStageLabel, executionStatusLabels } from "../../lib/execution-presentation";
import { normalizeListQuery, parsePage } from "../../lib/pagination";
import { requirePageUser } from "../../lib/page-access";
import { syncExecutionPreviewForPresentation } from "../../lib/preview-host-client";
import { projectAccessWhere } from "../../lib/projects";

export const dynamic = "force-dynamic";

const validStatuses = new Set(Object.keys(executionStatusLabels));
const PAGE_SIZE = 25;
const toneClass = { active: "running", waiting: "awaiting_client", failed: "failed", paused: "stopped", completed: "succeeded", neutral: "queued" };
const LIVE_STATUSES = new Set(["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "WAITING_APPROVAL", "AWAITING_CLIENT"]);

export default async function ExecutionsPage({ searchParams }) {
  const user = await requirePageUser();
  const rawFilters = await searchParams;
  const query = normalizeListQuery(rawFilters?.q);
  const projectId = typeof rawFilters?.projectId === "string" ? rawFilters.projectId : "";
  const status = typeof rawFilters?.status === "string" && validStatuses.has(rawFilters.status) ? rawFilters.status : "";
  const page = parsePage(rawFilters?.page);
  const access = projectAccessWhere(user);
  const where = {
    demand: { project: access, ...(projectId ? { projectId } : {}) },
    ...(status ? { status } : {}),
    ...(query ? { OR: [{ demand: { title: { contains: query, mode: "insensitive" } } }, { branchName: { contains: query, mode: "insensitive" } }, { summary: { contains: query, mode: "insensitive" } }, { error: { contains: query, mode: "insensitive" } }] } : {}),
  };

  const [executions, total, projects] = await Promise.all([
    db.execution.findMany({
      where,
      include: {
        demand: { include: { project: { select: { name: true } } } },
        pullRequest: true,
        previewEnvironment: true,
        _count: { select: { logs: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.execution.count({ where }),
    db.project.findMany({ where: { ...access, status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const presentedExecutions = await Promise.all(
    executions.map((execution) => syncExecutionPreviewForPresentation(db, execution)),
  );
  const hasLiveExecutions = presentedExecutions.some((execution) => LIVE_STATUSES.has(execution.status) && !execution.closedAt);

  return <AppShell user={user}><div className="section-page"><AutoRefresh active={hasLiveExecutions} interval={5000} showIndicator={false} /><SectionHeader eyebrow="AUTOMAÇÃO" title="Execuções" description="Acompanhe trabalhos em andamento, itens aguardando sua ação e execuções concluídas." /><form className="list-filters" method="get"><label className="filter-search"><span>Buscar</span><div><Search size={15} /><input name="q" defaultValue={query} placeholder="Demanda, branch ou resultado" /></div></label><label><span>Projeto</span><select name="projectId" defaultValue={projectId}><option value="">Todos</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label><label><span>Status</span><select name="status" defaultValue={status}><option value="">Todos</option>{Object.entries(executionStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><button type="submit">Filtrar</button>{(query || projectId || status) && <Link href="/executions">Limpar</Link>}</form><section className="form-card table-card"><div className="data-table executions-table"><div className="data-head"><span>Demanda</span><span>Projeto</span><span>Etapa</span><span>Status</span><span>Logs</span></div>{presentedExecutions.map((execution) => { const control = executionControlState(execution); return <Link className="data-row" href={`/executions/${execution.id}`} key={execution.id}><span className="table-title"><i><Activity size={16} /></i><strong>{execution.demand.title}</strong><small>{execution.model ?? "modelo pendente"}</small></span><span>{execution.demand.project.name}</span><span>{executionStageLabel(execution.stage)}</span><span><em className={`status-pill ${toneClass[control.displayTone] ?? execution.status.toLowerCase()}`}>{control.displayStatus}</em></span><span><Clock3 size={13} /> {execution._count.logs}</span></Link>; })}{!presentedExecutions.length && <div className="list-empty">Nenhuma execução encontrada para estes filtros.</div>}</div></section><Pagination basePath="/executions" page={page} pageSize={PAGE_SIZE} total={total} params={{ q: query, projectId, status }} /></div></AppShell>;
}
