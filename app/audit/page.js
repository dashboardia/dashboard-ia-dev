import { History, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";

import AppShell from "../../components/app-shell";
import SectionHeader from "../../components/section-header";
import { auditActionLabel, auditEntityHref } from "../../lib/audit";
import { db } from "../../lib/db";
import { formatDateTime, getGlobalSettings } from "../../lib/global-settings";
import { requirePageAdmin } from "../../lib/page-access";

export const dynamic = "force-dynamic";

const categoryLabels = {
  auth: "Autenticação",
  user: "Usuários",
  project: "Projetos e membros",
  demand: "Demandas",
  execution: "Execuções",
  pull_request: "Pull Requests",
};

export default async function AuditPage({ searchParams }) {
  const user = await requirePageAdmin();
  const settings = await getGlobalSettings();
  const filters = await searchParams;
  const projectId = typeof filters?.projectId === "string" ? filters.projectId : "";
  const category = typeof filters?.category === "string" && Object.hasOwn(categoryLabels, filters.category) ? filters.category : "";

  const [entries, projects] = await Promise.all([
    db.auditLog.findMany({
      where: {
        ...(projectId ? { projectId } : {}),
        ...(category ? { action: { startsWith: `${category}.` } } : {}),
      },
      include: {
        actor: { select: { name: true, email: true, githubLogin: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.project.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <AppShell user={user}>
      <div className="section-page">
        <SectionHeader eyebrow="SEGURANÇA" title="Auditoria" description="Histórico administrativo imutável das ações realizadas no Forgeboard." />

        <form className="audit-filters" method="get">
          <label><span>Projeto</span><select name="projectId" defaultValue={projectId}><option value="">Todos os projetos</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
          <label><span>Categoria</span><select name="category" defaultValue={category}><option value="">Todas as categorias</option>{Object.entries(categoryLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <button type="submit"><Search size={15} />Filtrar</button>
          {(projectId || category) && <Link href="/audit">Limpar</Link>}
        </form>

        <section className="form-card audit-list">
          {entries.map((entry) => {
            const href = auditEntityHref(entry.entityType, entry.entityId);
            const actor = entry.actor?.name ?? entry.actor?.githubLogin ?? entry.actor?.email ?? "Sistema";
            return (
              <article key={entry.id}>
                <i><ShieldCheck size={16} /></i>
                <span className="audit-main"><strong>{auditActionLabel(entry.action)}</strong><small>{actor} · {entry.project?.name ?? "Administração global"}</small></span>
                <span className="audit-entity">{href ? <Link href={href}>{entry.entityType}</Link> : entry.entityType}<small>{entry.entityId ?? "—"}</small></span>
                <time>{formatDateTime(entry.createdAt, settings.timeZone)}<small>{entry.ip ?? "IP indisponível"}</small></time>
                {(entry.metadata || entry.userAgent) && <details><summary>Detalhes técnicos</summary><pre>{JSON.stringify({ metadata: entry.metadata, userAgent: entry.userAgent }, null, 2)}</pre></details>}
              </article>
            );
          })}
          {!entries.length && <div className="resource-empty"><History size={28} /><strong>Nenhum evento encontrado</strong><span>Altere os filtros para ampliar a consulta.</span></div>}
        </section>
      </div>
    </AppShell>
  );
}
