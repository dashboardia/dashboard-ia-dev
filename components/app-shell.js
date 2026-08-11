"use client";

import {
  Bell,
  Boxes,
  CheckCircle2,
  ChevronDown,
  Code2,
  GitBranch,
  Github,
  HeartPulse,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Logs,
  Menu,
  Settings,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useState } from "react";

import GlobalSearch from "./global-search";

const navigation = [
  { href: "/", label: "Visão geral", icon: LayoutDashboard },
  { href: "/projects", label: "Projetos", icon: Boxes },
  { href: "/demands", label: "Demandas", icon: ListChecks },
  { href: "/executions", label: "Execuções", icon: Code2 },
  { href: "/pull-requests", label: "Pull Requests", icon: GitBranch },
  { href: "/logs", label: "Logs", icon: Logs },
  { href: "/health", label: "Saúde", icon: HeartPulse },
];

function isActive(pathname, href) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export default function AppShell({ children, user = null, setupMode = false }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState("");
  const displayName = user?.name ?? "Admin Demo";
  const displayEmail = user?.email ?? "configuração pendente";
  const initials = displayName
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  function notify(message) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  return (
    <main className="shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <Link href="/" className="brand"><span className="brand-mark"><Code2 size={19} /></span><span>Forgeboard</span></Link>
        <button className="close" onClick={() => setSidebarOpen(false)} aria-label="Fechar menu"><X /></button>
        <div className="workspace-label">ESPAÇO DE TRABALHO</div>
        <button className="workspace" onClick={() => notify("Espaço de trabalho principal")}><span className="workspace-avatar">DW</span><span><strong>Dev Workspace</strong><small>{user?.globalRole === "ADMIN" ? "Administrador global" : "Acesso por projeto"}</small></span><ChevronDown size={16} /></button>
        <nav>
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link className={isActive(pathname, href) ? "active" : ""} href={setupMode ? "/login" : href} key={href} onClick={() => setSidebarOpen(false)}><Icon size={18} /><span>{label}</span></Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {user?.globalRole === "ADMIN" && <Link href={setupMode ? "/login" : "/users"}><Users size={18} />Usuários</Link>}
          <Link href={setupMode ? "/login" : "/settings"}><Settings size={18} />Configurações</Link>
          <div className="user"><span className="user-avatar">{initials}</span><span><strong>{displayName}</strong><small>{displayEmail}</small></span>{user && <button className="signout" onClick={() => signOut({ callbackUrl: "/login" })} aria-label="Sair"><LogOut size={16} /></button>}</div>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <button className="menu" onClick={() => setSidebarOpen(true)} aria-label="Abrir menu"><Menu /></button>
          <GlobalSearch disabled={setupMode} />
          <button className="icon-button" onClick={() => notify("Nenhuma notificação nova")} aria-label="Notificações"><Bell size={19} /><i /></button>
          <button className="github-status" onClick={() => notify(setupMode ? "GitHub OAuth aguardando configuração" : "GitHub conectado e operacional")}><Github size={18} /><span>{setupMode ? "Configurar GitHub" : "GitHub conectado"}</span><CheckCircle2 size={15} /></button>
        </header>
        {children}
      </section>
      {sidebarOpen && <button className="overlay" onClick={() => setSidebarOpen(false)} aria-label="Fechar menu" />}
      {toast && <div className="toast"><CheckCircle2 size={17} />{toast}</div>}
    </main>
  );
}
