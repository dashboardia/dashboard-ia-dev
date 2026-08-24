"use client";

import {
  Activity,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Clock3,
  Code2,
  FileCode2,
  GitBranch,
  Github,
  HeartPulse,
  Lightbulb,
  ListChecks,
  Plus,
  Rocket,
  ServerCog,
  ShieldCheck,
  Sparkles,
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
        <section className={styles.hero}>
          <div className={styles.heroGlow} aria-hidden="true" />
          <div className={styles.heroCopy}>
            <p className={styles.heroEyebrow}><Sparkles size={13} />{dateLabel}</p>
            <h1>Transforme a próxima ideia em <span>software funcionando.</span></h1>
            <p>Descreva o que precisa. A Dashboard IA implementa, valida e entrega uma versão navegável para você decidir com segurança.</p>
            <div className={styles.heroActions}>
              <Link className={styles.heroPrimary} href={baseHref("/demands/new")}><Plus size={18} />Criar nova demanda <ArrowRight size={16} /></Link>
              <Link className={styles.heroSecondary} href={baseHref("/projects")}><Boxes size={17} />Ver meus projetos</Link>
            </div>
            <div className={styles.heroSignals}>
              <span><i className={styles.liveDot} />Operação em tempo real</span>
              <span><ShieldCheck size={14} />Branch e histórico preservados</span>
              <span><HeartPulse size={14} />{dashboard.health.title}</span>
            </div>
          </div>
          <div className={styles.heroVisual} aria-label="Fluxo de trabalho da Dashboard IA">
            <header><span><Rocket size={17} /></span><div><small>FLUXO INTELIGENTE</small><strong>Da ideia à versão navegável</strong></div><em>4 etapas</em></header>
            <div className={styles.heroFlow}>
              <FlowStep icon={Github} label="Repositório conectado" text="Contexto real do projeto" tone="purple" />
              <FlowStep icon={Lightbulb} label="Demanda compreendida" text="Escopo e impacto analisados" tone="blue" />
              <FlowStep icon={Code2} label="IA implementando" text="Código, build e validações" tone="cyan" />
              <FlowStep icon={CheckCircle2} label="Pronto para validar" text="Preview, evidências e PR" tone="success" />
            </div>
          </div>
        </section>

        <div className={styles.commandGrid}>
          <section className={styles.focusPanel}>
            <header className={styles.focusHeader}>
              <div className={styles.focusTitle}><span><Activity size={20} /></span><div><small>AGORA</small><h2>{focusItems.length ? "Seu trabalho em andamento" : "Sua operação está livre"}</h2><p>{focusItems.length ? "O que exige sua atenção aparece primeiro, sem você precisar procurar." : "Nenhuma pendência bloqueando você. Este é um bom momento para começar algo novo."}</p></div></div>
              {activeWork.length > 0 && <Link href={baseHref("/executions")}>Central de execuções <ArrowRight size={14} /></Link>}
            </header>
            {focusItems.length ? <div className={styles.focusGrid}>{focusItems.map((item) => <WorkCard item={item} setupMode={setupMode} key={item.id} />)}</div> : <div className={styles.focusEmpty}><span><CheckCircle2 size={26} /></span><div><strong>Tudo certo por aqui</strong><small>Crie uma demanda e acompanhe a implementação ao vivo.</small><Link href={baseHref("/demands/new")}>Começar agora <ArrowRight size={13} /></Link></div></div>}
          </section>

          <section className={styles.quickSection}>
            <div className={styles.sectionTitle}><div><small>ATALHOS</small><h2>Próximo passo</h2><p>Acesse o que importa em um clique.</p></div></div>
            <div className={styles.quickGrid}>
            <QuickAction href={baseHref("/demands/new")} icon={Plus} title="Criar uma demanda" text="Peça uma alteração, correção ou nova funcionalidade." primary />
            <QuickAction href={baseHref("/projects/new")} icon={Boxes} title="Conectar um projeto" text="Adicione um repositório GitHub e escolha a branch padrão." />
            <QuickAction href={baseHref("/executions")} icon={Activity} title="Acompanhar execuções" text="Veja o que a IA está fazendo e continue pelo chat." />
            <QuickAction href={baseHref("/environments")} icon={ServerCog} title="Testar ambientes" text="Abra ou acompanhe versões navegáveis das branches." />
            </div>
          </section>
        </div>

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

function FlowStep({ icon: Icon, label, text, tone }) {
  return <article className={`${styles.flowStep} ${styles[tone] ?? ""}`}><span><Icon size={18} /></span><div><strong>{label}</strong><small>{text}</small></div><i aria-hidden="true" /></article>;
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
