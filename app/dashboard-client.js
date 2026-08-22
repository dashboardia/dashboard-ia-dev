"use client";

import {
  Activity,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Clock3,
  FileCode2,
  GitBranch,
  Github,
  HeartPulse,
  ListChecks,
  Plus,
  ServerCog,
} from "lucide-react";
import Link from "next/link";

import AppShell from "../components/app-shell";
import styles from "./dashboard-client.module.css";

const demoData = {
  metrics: { projects: 3, activeDemands: 2, executionsToday: 7, successfulToday: 6, availability: "99,8%" },
  activeWork: [
    { id: "demo-execution-1", demandId: "demo-1", title: "Corrigir retorno do botão voltar", project: "Portal Web", status: "Executando", tone: "running", branch: "feature/ajuste-voltar", stage: "IMPLEMENTATION", time: "agora" },
    { id: "demo-execution-2", demandId: "demo-2", title: "Adicionar métricas de conversão", project: "Portal Web", status: "Aguardando você", tone: "attention", branch: "feature/conversao", stage: "PUBLISH", time: "há 6 min" },
  ],
  projects: [
    { id: "demo-1", name: "Portal Web", repo: "acme/portal-web", branch: "main", health: "Saudável", deploy: "Ativo", color: "#7c5cff" },
    { id: "demo-2", name: "Site Institucional", repo: "acme/site-institucional", branch: "main", health: "Saudável", deploy: "Ativo", color: "#0ea5e9" },
    { id: "demo-3", name: "Painel Financeiro", repo: "acme/painel-financeiro", branch: "develop", health: "Atenção", deploy: "Verificar", color: "#f59e0b" },
  ],
  demands: [
    { id: "demo-1", title: "Corrigir retorno do botão voltar", project: "Portal Web", type: "Correção", status: "Em execução", tone: "purple", time: "há 8 min" },
    { id: "demo-2", title: "Adicionar métricas de conversão", project: "Portal Web", type: "Funcionalidade", status: "Aguardando aprovação", tone: "amber", time: "há 34 min" },
    { id: "demo-3", title: "Revisar SEO da página institucional", project: "Site Institucional", type: "Investigação", status: "Concluída", tone: "green", time: "ontem" },
  ],
  health: { availability: "99,8%", title: "Operação estável", subtitle: "Última verificação há 18 segundos", healthy: 2, attention: 1, chart: [] },
};

function attentionWork(item) {
  return ["attention", "review"].includes(item.tone);
}

export default function Dashboard({ user = null, setupMode = false, data = null, dateLabel = "" }) {
  const dashboard = data ?? demoData;
  const activeWork = dashboard.activeWork ?? [];
  const waiting = activeWork.filter(attentionWork);
  const processing = activeWork.filter((item) => !attentionWork(item));
  const focusItems = [...waiting, ...processing].slice(0, 4);
  const baseHref = (href) => setupMode ? "/login" : href;

  return (
    <AppShell user={user} setupMode={setupMode}>
      <div className={`page ${styles.dashboardPage}`}>
        <div className={styles.heading}>
          <div><p className="eyebrow">{dateLabel}</p><h1>Visão geral</h1><p>Continue de onde parou ou escolha rapidamente o próximo passo.</p></div>
          <Link className="primary" href={baseHref("/demands/new")}><Plus size={18} />Nova demanda</Link>
        </div>

        <section className={styles.focusPanel}>
          <header className={styles.focusHeader}>
            <div className={styles.focusTitle}><span><Activity size={19} /></span><div><h2>{focusItems.length ? "Continue de onde parou" : "Tudo organizado por aqui"}</h2><p>{focusItems.length ? "As tarefas que precisam da sua atenção aparecem primeiro." : "Não há execuções aguardando ação agora. Escolha um próximo passo abaixo."}</p></div></div>
            {activeWork.length > 0 && <Link href={baseHref("/executions")}>Ver todas <ArrowRight size={14} /></Link>}
          </header>
          {focusItems.length ? <div className={styles.focusGrid}>{focusItems.map((item) => <WorkCard item={item} setupMode={setupMode} key={item.id} />)}</div> : <div className={styles.focusEmpty}><CheckCircle2 size={20} /><span><strong>Nenhuma pendência imediata</strong><small>Você pode criar uma nova demanda ou conectar outro projeto.</small></span></div>}
        </section>

        <section className={styles.quickSection}>
          <div className={styles.sectionTitle}><div><h2>O que você quer fazer?</h2><p>Atalhos para as ações mais comuns da Dashboard IA.</p></div></div>
          <div className={styles.quickGrid}>
            <QuickAction href={baseHref("/demands/new")} icon={Plus} title="Criar uma demanda" text="Peça uma alteração, correção ou nova funcionalidade." primary />
            <QuickAction href={baseHref("/projects/new")} icon={Boxes} title="Conectar um projeto" text="Adicione um repositório GitHub e escolha a branch padrão." />
            <QuickAction href={baseHref("/executions")} icon={Activity} title="Acompanhar execuções" text="Veja o que a IA está fazendo e continue pelo chat." />
            <QuickAction href={baseHref("/environments")} icon={ServerCog} title="Testar ambientes" text="Abra ou acompanhe versões navegáveis das branches." />
          </div>
        </section>

        <section className={styles.summaryGrid}>
          <Summary icon={Clock3} label="Aguardando você" value={String(waiting.length)} note={waiting.length ? "Abra uma execução e continue no chat" : "Nada pendente"} tone="attention" />
          <Summary icon={Activity} label="Em processamento" value={String(processing.length)} note={processing.length ? "Atualização automática em tempo real" : "Fila livre"} tone="running" />
          <Summary icon={Boxes} label="Projetos conectados" value={String(dashboard.metrics.projects)} note="Repositórios disponíveis" tone="neutral" />
          <Summary icon={HeartPulse} label="Saúde das aplicações" value={dashboard.metrics.availability} note={dashboard.health.attention ? `${dashboard.health.attention} requer atenção` : "Operação estável"} tone={dashboard.health.attention ? "attention" : "healthy"} />
        </section>

        <div className={styles.lowerGrid}>
          <section className={styles.panel}>
            <PanelHeader title="Projetos recentes" subtitle="Entre no projeto para criar demandas e acompanhar o trabalho." href={baseHref("/projects")} action="Ver projetos" />
            <div className={styles.simpleList}>
              {dashboard.projects.slice(0, 4).map((project) => <ProjectRow project={project} setupMode={setupMode} key={project.id} />)}
              {!dashboard.projects.length && <EmptyState title="Nenhum projeto conectado" text="Conecte um repositório para começar." />}
            </div>
            <Link className={styles.secondaryCta} href={baseHref("/projects/new")}><Plus size={15} />Conectar novo projeto</Link>
          </section>

          <section className={styles.panel}>
            <PanelHeader title="Demandas recentes" subtitle="Retome rapidamente algo que você abriu nos últimos dias." href={baseHref("/demands")} action="Ver demandas" />
            <div className={styles.simpleList}>
              {dashboard.demands.slice(0, 4).map((demand) => <DemandRow demand={demand} setupMode={setupMode} key={demand.id} />)}
              {!dashboard.demands.length && <EmptyState title="Nenhuma demanda criada" text="Crie a primeira demanda para um projeto conectado." />}
            </div>
          </section>
        </div>

        <section className={styles.healthStrip}>
          <span className={styles.healthIcon}><HeartPulse size={18} /></span>
          <div><strong>{dashboard.health.title}</strong><small>{dashboard.health.subtitle}</small></div>
          <span className={styles.healthNumbers}>{dashboard.health.availability}<small>{dashboard.health.healthy} saudáveis · {dashboard.health.attention} com atenção</small></span>
          <Link href={baseHref("/health")}>Abrir monitor <ArrowRight size={14} /></Link>
        </section>
      </div>
    </AppShell>
  );
}

function WorkCard({ item, setupMode }) {
  const href = setupMode ? "/login" : `/executions/${item.id}`;
  return <Link className={`${styles.workCard} ${attentionWork(item) ? styles.needsYou : ""}`} href={href}>
    <span className={styles.workStatus}><i />{item.status}</span>
    <strong>{item.title}</strong>
    <small>{item.project}{item.branch ? ` · ${item.branch}` : ""}</small>
    <footer><span>{item.stage} · {item.time}</span><span>Abrir execução <ArrowRight size={13} /></span></footer>
  </Link>;
}

function QuickAction({ href, icon: Icon, title, text, primary = false }) {
  return <Link className={`${styles.quickAction} ${primary ? styles.primaryAction : ""}`} href={href}><span><Icon size={18} /></span><div><strong>{title}</strong><small>{text}</small></div><ArrowRight size={15} /></Link>;
}

function Summary({ icon: Icon, label, value, note, tone }) {
  return <article className={`${styles.summary} ${styles[tone] ?? ""}`}><span><Icon size={17} /></span><div><small>{label}</small><strong>{value}</strong><p>{note}</p></div></article>;
}

function PanelHeader({ title, subtitle, href, action }) {
  return <header className={styles.panelHeader}><div><h2>{title}</h2><p>{subtitle}</p></div><Link href={href}>{action} <ArrowRight size={13} /></Link></header>;
}

function ProjectRow({ project, setupMode }) {
  return <Link className={styles.row} href={setupMode ? "/login" : `/projects/${project.id}`}><span className={styles.rowIcon} style={{ background: project.color }}><FileCode2 size={17} /></span><span className={styles.rowMain}><strong>{project.name}</strong><small><Github size={12} />{project.repo}</small></span><span className={styles.branch}><GitBranch size={12} />{project.branch}</span><span className={`${styles.healthDot} ${project.health === "Atenção" ? styles.warning : styles.ok}`}><i />{project.health}</span><ArrowRight size={14} /></Link>;
}

function DemandRow({ demand, setupMode }) {
  return <Link className={styles.row} href={setupMode ? "/login" : `/demands/${demand.id}`}><span className={styles.rowIcon}><ListChecks size={17} /></span><span className={styles.rowMain}><strong>{demand.title}</strong><small>{demand.project} · {demand.type}</small></span><span className={`${styles.demandStatus} ${styles[demand.tone] ?? ""}`}>{demand.status}</span><span className={styles.rowTime}>{demand.time}</span><ArrowRight size={14} /></Link>;
}

function EmptyState({ title, text }) {
  return <div className={styles.empty}><strong>{title}</strong><span>{text}</span></div>;
}
