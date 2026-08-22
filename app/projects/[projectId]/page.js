import { BookOpen, CheckCircle2, ExternalLink, GitBranch, Github, ListChecks, Rocket, ServerCog, Settings, Webhook } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import AppShell from "../../../components/app-shell";
import SectionHeader from "../../../components/section-header";
import { getProjectRole } from "../../../lib/access";
import { db } from "../../../lib/db";
import { requirePageUser } from "../../../lib/page-access";
import { isGitHubWebhookConfirmed } from "../../../lib/webhooks";
import ProjectSettingsForm from "./project-settings-form";
import WebhookStatus from "./webhook-status";
import BusinessKnowledgePanel from "./business-knowledge-panel";
import styles from "./project-page.module.css";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }) {
  const user = await requirePageUser();
  const { projectId } = await params;
  const role = await getProjectRole(user, projectId);
  if (!role) redirect("/projects");

  const project = await db.project.findFirst({
    where: { id: projectId, status: { not: "ARCHIVED" } },
    include: {
      demands: { orderBy: { updatedAt: "desc" }, take: 8 },
      healthChecks: { orderBy: { checkedAt: "desc" }, take: 1 },
      businessKnowledge: {
        include: { approvedBy: { select: { id: true, name: true, email: true, githubLogin: true } } },
        orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      },
    },
  });
  if (!project) notFound();

  const webhookConfirmed = isGitHubWebhookConfirmed(project);
  const githubUrl = `https://github.com/${project.repositoryFullName}`;
  const environmentsHref = `/environments?projectId=${encodeURIComponent(project.id)}&branch=${encodeURIComponent(project.defaultBranch)}`;

  return (
    <AppShell user={user}>
      <div className={`section-page ${styles.page}`}>
        <SectionHeader
          backHref="/projects"
          eyebrow={project.repositoryFullName}
          title={project.name}
          description={`Branch padrão: ${project.defaultBranch}`}
          action={<div className={styles.headerActions}>
            <a className={styles.secondaryAction} href={githubUrl} target="_blank" rel="noreferrer"><Github size={16} />Abrir GitHub</a>
            <Link className={styles.primaryAction} href={`/demands/new?projectId=${project.id}`}><ListChecks size={16} />Nova demanda</Link>
          </div>}
        />

        <div className={styles.overview}>
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div><h2>Resumo do projeto</h2><p>O essencial para trabalhar com este repositório.</p></div>
              <span className={styles.connectionBadge}><CheckCircle2 size={14} />GitHub conectado</span>
            </div>

            <div className={styles.summaryGrid}>
              <div className={styles.summaryItem}><span className={styles.summaryIcon}><Github size={16} /></span><span><small>Repositório</small><a href={githubUrl} target="_blank" rel="noreferrer">{project.repositoryFullName}</a></span></div>
              <div className={styles.summaryItem}><span className={styles.summaryIcon}><GitBranch size={16} /></span><span><small>Branch padrão</small><strong>{project.defaultBranch}</strong></span></div>
              <div className={styles.summaryItem}><span className={styles.summaryIcon}><Rocket size={16} /></span><span><small>Produção</small><strong>{project.productionUrl ? "URL configurada" : "Não configurada"}</strong></span></div>
              <div className={styles.summaryItem}><span className={styles.summaryIcon}><Webhook size={16} /></span><span><small>Sincronização</small><strong>{webhookConfirmed ? "Webhook sincronizado" : "Webhook pendente"}</strong></span></div>
            </div>

            <div className={styles.webhookRow}>
              <span><strong>Sincronização com GitHub</strong><small>Mantém Pull Requests e alterações do repositório atualizados.</small></span>
              {role === "MANAGER" ? <WebhookStatus projectId={project.id} configured={webhookConfirmed} error={project.githubWebhookError} /> : <span>{webhookConfirmed ? "Sincronizado" : "Pendente"}</span>}
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeader}><div><h2>Ações rápidas</h2><p>Continue o trabalho sem procurar em outros menus.</p></div></div>
            <div className={styles.quickActions}>
              <Link className={styles.quickAction} href={`/demands/new?projectId=${project.id}`}><ListChecks size={17} /><span><strong>Criar nova demanda</strong><small>Solicitar uma alteração neste projeto</small></span></Link>
              <Link className={styles.quickAction} href="/executions"><ServerCog size={17} /><span><strong>Ver execuções</strong><small>Acompanhar processamento e interações</small></span></Link>
              <Link className={styles.quickAction} href={environmentsHref}><Rocket size={17} /><span><strong>Subir ambiente</strong><small>Abrir esta branch em um ambiente temporário</small></span></Link>
              <a className={styles.quickAction} href={githubUrl} target="_blank" rel="noreferrer"><ExternalLink size={17} /><span><strong>Abrir repositório</strong><small>Visualizar o código diretamente no GitHub</small></span></a>
            </div>
          </section>
        </div>

        <section className={styles.recentCard}>
          <div className={styles.cardHeader}><div><h2>Demandas recentes</h2><p>Últimas atividades realizadas neste projeto.</p></div><Link className={styles.secondaryAction} href={`/demands?projectId=${project.id}`}>Ver todas</Link></div>
          <div className={styles.demandList}>
            {project.demands.map((demand) => <Link className={styles.demandRow} href={`/demands/${demand.id}`} key={demand.id}><strong>{demand.title}</strong><span>{demand.type}</span><em>{demand.status}</em></Link>)}
            {!project.demands.length && <div className={styles.empty}>Nenhuma demanda criada neste projeto ainda.</div>}
          </div>
        </section>

        {role === "MANAGER" && <details className={styles.settingsDetails}>
          <summary><Settings size={18} /><span><strong>Editar projeto</strong><small>Altere somente nome, branch padrão ou URL de produção.</small></span></summary>
          <div className={styles.settingsBody}><ProjectSettingsForm project={{ id: project.id, name: project.name, repositoryFullName: project.repositoryFullName, defaultBranch: project.defaultBranch, productionUrl: project.productionUrl }} /></div>
        </details>}

        {role === "MANAGER" && <details className={styles.knowledgeDetails}>
          <summary><BookOpen size={18} /><span><strong>Conhecimento do negócio</strong><small>Regras aprovadas que ajudam a IA a entender este projeto.</small></span></summary>
          <div className={styles.settingsBody}><BusinessKnowledgePanel projectId={project.id} initialEntries={project.businessKnowledge.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString(), updatedAt: entry.updatedAt.toISOString(), approvedAt: entry.approvedAt?.toISOString() ?? null }))} /></div>
        </details>}
      </div>
    </AppShell>
  );
}
