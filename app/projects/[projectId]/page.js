import { ExternalLink, GitBranch, Github, Settings, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import AppShell from "../../../components/app-shell";
import SectionHeader from "../../../components/section-header";
import { getProjectRole } from "../../../lib/access";
import { db } from "../../../lib/db";
import { requirePageUser } from "../../../lib/page-access";
import { isGitHubWebhookConfirmed } from "../../../lib/webhooks";
import MemberForm from "./member-form";
import MemberControls from "./member-controls";
import ProjectSettingsForm from "./project-settings-form";
import WebhookStatus from "./webhook-status";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }) {
  const user = await requirePageUser();
  const { projectId } = await params;
  const role = await getProjectRole(user, projectId);
  if (!role) redirect("/projects");
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      members: { include: { user: { select: { id: true, name: true, email: true, githubLogin: true, image: true } } }, orderBy: { createdAt: "asc" } },
      demands: { orderBy: { updatedAt: "desc" }, take: 8 },
      healthChecks: { orderBy: { checkedAt: "desc" }, take: 1 },
    },
  });
  if (!project) notFound();
  const webhookConfirmed = isGitHubWebhookConfirmed(project);

  return (
    <AppShell user={user}>
      <div className="section-page">
        <SectionHeader backHref="/projects" eyebrow={project.repositoryFullName} title={project.name} description={`Branch padrão: ${project.defaultBranch}`} action={<Link className="primary" href={`/demands/new?projectId=${project.id}`}>Nova demanda</Link>} />
        <div className="detail-grid">
          <section className="form-card detail-card">
            <h2>Integrações</h2>
            <div className="detail-list">
              <span><Github size={17} /><strong>GitHub</strong><em>{project.repositoryFullName}</em></span>
              <span><Github size={17} /><strong>Webhook</strong><em>{role === "MANAGER" ? <WebhookStatus projectId={project.id} configured={webhookConfirmed} error={project.githubWebhookError} /> : webhookConfirmed ? "Sincronizado" : "Pendente"}</em></span>
              <span><GitBranch size={17} /><strong>Branch</strong><em>{project.defaultBranch}</em></span>
              <span><ExternalLink size={17} /><strong>Deploy</strong><em>{project.productionUrl ?? "Somente GitHub"}</em></span>
              <span><ShieldCheck size={17} /><strong>Seu papel</strong><em>{role}</em></span>
            </div>
          </section>
          <section className="form-card detail-card">
            <div className="card-heading"><div><h2>Membros</h2><p>{project.members.length} pessoas com acesso</p></div><Users size={20} /></div>
            <div className="member-list">{project.members.map((member) => { const memberName = member.user.name ?? member.user.githubLogin ?? member.user.email ?? "Usuário"; return <div className="member-row" key={member.id}><span className="mini-avatar">{memberName[0].toUpperCase()}</span><span><strong>{memberName}</strong><small>{member.user.email}</small></span>{role === "MANAGER" ? <MemberControls projectId={project.id} memberId={member.id} initialRole={member.role} memberName={memberName} /> : <em>{member.role}</em>}</div>; })}</div>
            {role === "MANAGER" && <MemberForm projectId={project.id} />}
          </section>
        </div>
        {role === "MANAGER" && (
          <section className="form-card detail-card full-card project-settings-card">
            <div className="card-heading"><div><h2>Configurações do projeto</h2><p>Produção, branch e comandos usados pelo worker</p></div><Settings size={20} /></div>
            <ProjectSettingsForm project={{
              id: project.id,
              name: project.name,
              repositoryFullName: project.repositoryFullName,
              defaultBranch: project.defaultBranch,
              productionUrl: project.productionUrl,
              workingDirectory: project.workingDirectory,
              installCommand: project.installCommand,
              lintCommand: project.lintCommand,
              testCommand: project.testCommand,
              buildCommand: project.buildCommand,
            }} />
          </section>
        )}
        <section className="form-card detail-card full-card">
          <div className="card-heading"><div><h2>Demandas recentes</h2><p>Atividades vinculadas ao projeto</p></div></div>
          <div className="simple-list">{project.demands.map((demand) => <Link href={`/demands/${demand.id}`} key={demand.id}><strong>{demand.title}</strong><span>{demand.type}</span><em>{demand.status}</em></Link>)}{!project.demands.length && <div className="list-empty">Nenhuma demanda criada.</div>}</div>
        </section>
      </div>
    </AppShell>
  );
}
