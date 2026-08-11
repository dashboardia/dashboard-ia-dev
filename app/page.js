"use client";

import {
  Activity,
  Bell,
  Boxes,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  Code2,
  FileCode2,
  GitBranch,
  Github,
  HeartPulse,
  LayoutDashboard,
  ListChecks,
  Logs,
  Menu,
  Plus,
  Search,
  Settings,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";

const projects = [
  { name: "Portal Web", repo: "acme/portal-web", branch: "main", health: "Saudável", deploy: "Ativo", color: "#7c5cff" },
  { name: "Site Institucional", repo: "acme/site-institucional", branch: "main", health: "Saudável", deploy: "Ativo", color: "#0ea5e9" },
  { name: "Painel Financeiro", repo: "acme/painel-financeiro", branch: "develop", health: "Atenção", deploy: "Verificar", color: "#f59e0b" },
];

const demands = [
  { title: "Corrigir retorno do botão voltar", project: "Portal Web", type: "Correção", status: "Em execução", icon: CircleDot, tone: "purple", time: "há 8 min" },
  { title: "Adicionar métricas de conversão", project: "Portal Web", type: "Funcionalidade", status: "Aguardando aprovação", icon: Clock3, tone: "amber", time: "há 34 min" },
  { title: "Revisar SEO da página institucional", project: "Site Institucional", type: "Investigação", status: "Concluída", icon: CheckCircle2, tone: "green", time: "ontem" },
];

const navigation = [
  ["Visão geral", LayoutDashboard],
  ["Projetos", Boxes],
  ["Demandas", ListChecks],
  ["Execuções", Code2],
  ["Pull Requests", GitBranch],
  ["Logs", Logs],
  ["Saúde", HeartPulse],
];

export default function Dashboard() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState("");

  function action(message) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  return (
    <main className="shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand"><span className="brand-mark"><Code2 size={19} /></span><span>Forgeboard</span></div>
        <button className="close" onClick={() => setSidebarOpen(false)} aria-label="Fechar menu"><X /></button>
        <div className="workspace-label">ESPAÇO DE TRABALHO</div>
        <button className="workspace"><span className="workspace-avatar">DW</span><span><strong>Dev Workspace</strong><small>Administrador global</small></span><ChevronDown size={16} /></button>
        <nav>
          {navigation.map(([label, Icon], index) => (
            <button className={index === 0 ? "active" : ""} key={label} onClick={() => action(`${label}: módulo preparado para a próxima etapa`)}><Icon size={18} /><span>{label}</span>{label === "Demandas" && <em>2</em>}</button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button onClick={() => action("Gestão de usuários será conectada ao backend")}><Users size={18} />Usuários</button>
          <button onClick={() => action("Configurações serão conectadas ao backend")}><Settings size={18} />Configurações</button>
          <div className="user"><span className="user-avatar">AD</span><span><strong>Admin Demo</strong><small>admin@example.com</small></span></div>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <button className="menu" onClick={() => setSidebarOpen(true)} aria-label="Abrir menu"><Menu /></button>
          <div className="search"><Search size={17} /><input placeholder="Buscar projetos, demandas ou logs..." /><kbd>⌘ K</kbd></div>
          <button className="icon-button" onClick={() => action("Nenhuma notificação nova")}><Bell size={19} /><i /></button>
          <button className="github-status" onClick={() => action("GitHub conectado e operacional")}><Github size={18} /><span>GitHub conectado</span><CheckCircle2 size={15} /></button>
        </header>

        <div className="page">
          <div className="page-heading">
            <div><p className="eyebrow">TERÇA-FEIRA, 11 DE AGOSTO</p><h1>Visão geral</h1><p>Acompanhe seus projetos, execuções e aplicações em um só lugar.</p></div>
            <button className="primary" onClick={() => action("Fluxo de nova demanda iniciado")}><Plus size={18} />Nova demanda</button>
          </div>

          <section className="metrics">
            <Metric icon={Boxes} label="Projetos conectados" value="3" note="Todos sincronizados" tone="violet" />
            <Metric icon={ListChecks} label="Demandas ativas" value="2" note="1 aguardando aprovação" tone="blue" />
            <Metric icon={Activity} label="Execuções hoje" value="7" note="6 concluídas com sucesso" tone="green" />
            <Metric icon={HeartPulse} label="Saúde geral" value="99,8%" note="1 serviço requer atenção" tone="amber" />
          </section>

          <div className="grid-main">
            <section className="panel projects-panel">
              <PanelTitle title="Projetos" subtitle="Repositórios conectados e status de produção" action="Ver todos" onAction={() => action("Listagem completa de projetos")} />
              <div className="project-list">
                {projects.map((project) => <Project key={project.name} {...project} onClick={() => action(`${project.name} selecionado`)} />)}
              </div>
              <button className="connect" onClick={() => action("Conexão de novo repositório iniciada")}><Plus size={17} />Conectar novo projeto</button>
            </section>

            <section className="panel health-panel">
              <PanelTitle title="Saúde das aplicações" subtitle="Monitoramento Railway em tempo real" action="Abrir monitor" onAction={() => action("Monitor Railway selecionado")} />
              <div className="health-score"><div className="pulse"><HeartPulse size={25} /></div><div><strong>Operação estável</strong><span>Última verificação há 18 segundos</span></div><b>99,8%</b></div>
              <div className="chart" aria-label="Gráfico ilustrativo de disponibilidade">
                {[34,44,39,58,54,68,61,73,67,80,76,89,84,92,88,96,91,97,93,98,94,99,96,100].map((h, i) => <span key={i} style={{height:`${h}%`}} />)}
              </div>
              <div className="health-legend"><span><i className="ok" />2 serviços saudáveis</span><span><i className="warn" />1 requer atenção</span></div>
            </section>
          </div>

          <section className="panel demands-panel">
            <PanelTitle title="Demandas recentes" subtitle="Acompanhe o progresso das alterações solicitadas" action="Ver todas" onAction={() => action("Listagem completa de demandas")} />
            <div className="demand-head"><span>DEMANDA</span><span>PROJETO</span><span>TIPO</span><span>STATUS</span><span>ATUALIZAÇÃO</span></div>
            {demands.map((d) => <Demand key={d.title} {...d} onClick={() => action(`Demanda aberta: ${d.title}`)} />)}
          </section>
        </div>
      </section>
      {sidebarOpen && <button className="overlay" onClick={() => setSidebarOpen(false)} aria-label="Fechar menu" />}
      {toast && <div className="toast"><CheckCircle2 size={17} />{toast}</div>}
    </main>
  );
}

function Metric({ icon: Icon, label, value, note, tone }) {
  return <article className="metric"><span className={`metric-icon ${tone}`}><Icon size={20} /></span><div><p>{label}</p><strong>{value}</strong><small><CheckCircle2 size={13} />{note}</small></div></article>;
}

function PanelTitle({ title, subtitle, action, onAction }) {
  return <div className="panel-title"><div><h2>{title}</h2><p>{subtitle}</p></div><button onClick={onAction}>{action}<span>→</span></button></div>;
}

function Project({ name, repo, branch, health, deploy, color, onClick }) {
  return <button className="project" onClick={onClick}><span className="project-logo" style={{background:color}}><FileCode2 size={20} /></span><span className="project-name"><strong>{name}</strong><small><Github size={13} />{repo}</small></span><span className="branch"><GitBranch size={14} />{branch}</span><span className={`status ${health === "Atenção" ? "attention" : "healthy"}`}><i />{health}</span><span className="deploy">{deploy}</span><span className="arrow">›</span></button>;
}

function Demand({ title, project, type, status, tone, time, icon: Icon, onClick }) {
  return <button className="demand" onClick={onClick}><span className="demand-title"><span className="file-icon"><FileCode2 size={17} /></span><strong>{title}</strong></span><span>{project}</span><span className="type">{type}</span><span className={`demand-status ${tone}`}><Icon size={14} />{status}</span><span className="time">{time}<span>›</span></span></button>;
}
