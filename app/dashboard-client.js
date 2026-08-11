"use client";

import {
  Activity,
  Boxes,
  CheckCircle2,
  CircleDot,
  Clock3,
  FileCode2,
  GitBranch,
  Github,
  HeartPulse,
  ListChecks,
  Plus,
} from "lucide-react";
import Link from "next/link";

import AppShell from "../components/app-shell";

const demoData = {
  metrics: { projects: 3, activeDemands: 2, executionsToday: 7, successfulToday: 6, availability: "99,8%" },
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
  health: {
    availability: "99,8%",
    title: "Operação estável",
    subtitle: "Última verificação há 18 segundos",
    healthy: 2,
    attention: 1,
    chart: [34, 44, 39, 58, 54, 68, 61, 73, 67, 80, 76, 89, 84, 92, 88, 96, 91, 97, 93, 98, 94, 99, 96, 100],
  },
};

const statusIcon = {
  purple: CircleDot,
  amber: Clock3,
  green: CheckCircle2,
  blue: Clock3,
  gray: Clock3,
  red: CircleDot,
};

export default function Dashboard({ user = null, setupMode = false, data = null }) {
  const dashboard = data ?? demoData;
  const dateLabel = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  }).format(new Date()).toUpperCase();

  return (
    <AppShell user={user} setupMode={setupMode}>
      <div className="page">
        <div className="page-heading">
          <div><p className="eyebrow">{dateLabel}</p><h1>Visão geral</h1><p>Acompanhe seus projetos, execuções e aplicações em um só lugar.</p></div>
          <Link className="primary" href={setupMode ? "/login" : "/demands/new"}><Plus size={18} />Nova demanda</Link>
        </div>

        <section className="metrics">
          <Metric icon={Boxes} label="Projetos conectados" value={String(dashboard.metrics.projects)} note="Acesso atualizado" tone="violet" />
          <Metric icon={ListChecks} label="Demandas ativas" value={String(dashboard.metrics.activeDemands)} note="Inclui fila e revisão" tone="blue" />
          <Metric icon={Activity} label="Execuções hoje" value={String(dashboard.metrics.executionsToday)} note={`${dashboard.metrics.successfulToday} concluídas com sucesso`} tone="green" />
          <Metric icon={HeartPulse} label="Saúde geral" value={dashboard.metrics.availability} note="Últimas 24 horas" tone="amber" />
        </section>

        <div className="grid-main">
          <section className="panel projects-panel">
            <PanelTitle title="Projetos" subtitle="Repositórios conectados e status de produção" action="Ver todos" href="/projects" />
            {dashboard.projects.length ? (
              <div className="project-list">
                {dashboard.projects.map((project) => <Project key={project.id} {...project} setupMode={setupMode} />)}
              </div>
            ) : <EmptyState title="Nenhum projeto conectado" text="Conecte o primeiro repositório para criar demandas." />}
            <Link className="connect" href={setupMode ? "/login" : "/projects/new"}><Plus size={17} />Conectar novo projeto</Link>
          </section>

          <section className="panel health-panel">
            <PanelTitle title="Saúde das aplicações" subtitle="Monitoramento Railway em tempo real" action="Abrir monitor" href="/health" />
            <div className="health-score"><div className="pulse"><HeartPulse size={25} /></div><div><strong>{dashboard.health.title}</strong><span>{dashboard.health.subtitle}</span></div><b>{dashboard.health.availability}</b></div>
            <HealthChart values={dashboard.health.chart} />
            <div className="health-legend"><span><i className="ok" />{dashboard.health.healthy} serviços saudáveis</span><span><i className="warn" />{dashboard.health.attention} requer atenção</span></div>
          </section>
        </div>

        <section className="panel demands-panel">
          <PanelTitle title="Demandas recentes" subtitle="Acompanhe o progresso das alterações solicitadas" action="Ver todas" href="/demands" />
          {dashboard.demands.length ? (
            <>
              <div className="demand-head"><span>DEMANDA</span><span>PROJETO</span><span>TIPO</span><span>STATUS</span><span>ATUALIZAÇÃO</span></div>
              {dashboard.demands.map((demand) => <Demand key={demand.id} {...demand} setupMode={setupMode} />)}
            </>
          ) : <EmptyState title="Nenhuma demanda criada" text="As demandas aparecerão aqui após a criação." />}
        </section>
      </div>
    </AppShell>
  );
}

function Metric({ icon: Icon, label, value, note, tone }) {
  return <article className="metric"><span className={`metric-icon ${tone}`}><Icon size={20} /></span><div><p>{label}</p><strong>{value}</strong><small><CheckCircle2 size={13} />{note}</small></div></article>;
}

function PanelTitle({ title, subtitle, action, href }) {
  return <div className="panel-title"><div><h2>{title}</h2><p>{subtitle}</p></div><Link href={href}>{action}<span>→</span></Link></div>;
}

function Project({ id, name, repo, branch, health, deploy, color, setupMode }) {
  const href = setupMode ? "/login" : `/projects/${id}`;
  return <Link className="project" href={href}><span className="project-logo" style={{ background: color }}><FileCode2 size={20} /></span><span className="project-name"><strong>{name}</strong><small><Github size={13} />{repo}</small></span><span className="branch"><GitBranch size={14} />{branch}</span><span className={`status ${health === "Atenção" ? "attention" : "healthy"}`}><i />{health}</span><span className="deploy">{deploy}</span><span className="arrow">›</span></Link>;
}

function Demand({ id, title, project, type, status, tone, time, setupMode }) {
  const Icon = statusIcon[tone] ?? Clock3;
  const href = setupMode ? "/login" : `/demands/${id}`;
  return <Link className="demand" href={href}><span className="demand-title"><span className="file-icon"><FileCode2 size={17} /></span><strong>{title}</strong></span><span>{project}</span><span className="type">{type}</span><span className={`demand-status ${tone}`}><Icon size={14} />{status}</span><span className="time">{time}<span>›</span></span></Link>;
}

function HealthChart({ values }) {
  const maximum = Math.max(...values, 1);
  const normalized = values.length ? values : Array.from({ length: 24 }, () => 0);
  return <div className={`chart ${values.length ? "" : "empty-chart"}`} aria-label="Disponibilidade das últimas verificações">{normalized.map((value, index) => <span key={index} style={{ height: values.length ? `${Math.max(8, (value / maximum) * 100)}%` : "8%" }} />)}</div>;
}

function EmptyState({ title, text }) {
  return <div className="empty-state"><strong>{title}</strong><span>{text}</span></div>;
}
