import { Boxes, GitBranch, Github, Plus, Users } from "lucide-react";
import Link from "next/link";

import AppShell from "../../components/app-shell";
import SectionHeader from "../../components/section-header";
import { db } from "../../lib/db";
import { requirePageUser } from "../../lib/page-access";
import { projectAccessWhere } from "../../lib/projects";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const user = await requirePageUser();
  const projects = await db.project.findMany({
    where: { ...projectAccessWhere(user), status: { not: "ARCHIVED" } },
    include: {
      members: { where: { userId: user.id }, select: { role: true } },
      _count: { select: { members: true, demands: true } },
      healthChecks: { orderBy: { checkedAt: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <AppShell user={user}>
      <div className="section-page">
        <SectionHeader
          eyebrow="REPOSITÓRIOS"
          title="Projetos"
          description="Gerencie repositórios, participantes e integrações de produção."
          action={user.globalRole === "ADMIN" ? <Link className="primary" href="/projects/new"><Plus size={18} />Conectar projeto</Link> : null}
        />

        <section className="resource-grid">
          {projects.map((project) => {
            const health = project.healthChecks[0]?.status ?? "UNKNOWN";
            const role = user.globalRole === "ADMIN" ? "Administrador" : project.members[0]?.role ?? "Visualizador";
            return (
              <Link className="resource-card" href={`/projects/${project.id}`} key={project.id}>
                <span className="resource-icon"><Boxes size={21} /></span>
                <div className="resource-title"><strong>{project.name}</strong><span className={`health-dot ${health.toLowerCase()}`} /> </div>
                <p><Github size={14} />{project.repositoryFullName}</p>
                <div className="resource-meta"><span><GitBranch size={13} />{project.defaultBranch}</span><span><Users size={13} />{project._count.members}</span><span>{project._count.demands} demandas</span></div>
                <span className="role-pill">{role}</span>
              </Link>
            );
          })}
          {!projects.length && <div className="resource-empty"><Boxes size={28} /><strong>Nenhum projeto disponível</strong><span>O administrador global pode conectar o primeiro repositório.</span></div>}
        </section>
      </div>
    </AppShell>
  );
}
