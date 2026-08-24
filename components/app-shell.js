"use client";

import {
  Boxes,
  CheckCircle2,
  ChevronDown,
  Code2,
  GitBranch,
  Github,
  HeartPulse,
  History,
  HelpCircle,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Logs,
  Menu,
  PackageOpen,
  PanelLeftClose,
  PanelLeftOpen,
  ServerCog,
  Settings,
  WalletCards,
  BadgeDollarSign,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import ActionCenter from "./action-center";
import ExecutionGitHubRecovery from "./execution-github-recovery";
import GlobalSearch from "./global-search";
import { PreferencesProvider, usePreferences } from "./preferences-provider";
import SupportChat from "./support-chat";
import LocalizedContent from "./localized-content";

const SIDEBAR_PIN_KEY = "dashboardia:sidebar-pinned";

const navigation = [
  { href: "/", label: "overview", icon: LayoutDashboard },
  { href: "/projects", label: "projects", icon: Boxes },
  { href: "/environments", label: "environments", icon: ServerCog },
  { href: "/demands", label: "demands", icon: ListChecks },
  { href: "/executions", label: "executions", icon: Code2 },
  { href: "/pull-requests", label: "pullRequests", icon: GitBranch },
  { href: "/logs", label: "logs", icon: Logs },
  { href: "/health", label: "health", icon: HeartPulse },
];

function isActive(pathname, href) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function AppShellContent({ children, user = null, setupMode = false }) {
  const { t } = usePreferences();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const [toast, setToast] = useState("");
  const displayName = user?.name ?? "Admin Demo";
  const displayEmail = user?.email ?? "configuração pendente";
  const initials = displayName
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  useEffect(() => {
    try {
      setSidebarPinned(window.localStorage.getItem(SIDEBAR_PIN_KEY) === "1");
    } catch {
      // A preferência é apenas visual; a navegação continua funcionando sem storage.
    }
  }, []);

  function notify(message) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  function toggleSidebarPinned() {
    setSidebarPinned((current) => {
      const next = !current;
      try { window.localStorage.setItem(SIDEBAR_PIN_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  }

  return (
    <main className={`shell ${sidebarPinned ? "sidebar-pinned" : ""}`}>
      <aside className={`sidebar ${sidebarOpen ? "open" : ""} ${sidebarPinned ? "pinned" : ""}`}>
        <Link href="/" className="brand"><span className="brand-mark"><Code2 size={19} /></span><span>Forgeboard</span></Link>
        <button className="close" onClick={() => setSidebarOpen(false)} aria-label={t("closeMenu")}><X /></button>
        <button className="sidebar-pin" type="button" onClick={toggleSidebarPinned} aria-pressed={sidebarPinned} title={sidebarPinned ? "Recolher menu" : "Fixar menu aberto"}>
          {sidebarPinned ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
          <span>{sidebarPinned ? "Recolher menu" : "Fixar menu aberto"}</span>
        </button>
        <div className="workspace-label">{t("workspace")}</div>
        <button className="workspace" onClick={() => notify("Espaço de trabalho principal")}><span className="workspace-avatar">DW</span><span><strong>Dev Workspace</strong><small>{user?.globalRole === "ADMIN" ? t("admin") : t("projectAccess")}</small></span><ChevronDown size={16} /></button>
        <nav>
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link className={isActive(pathname, href) ? "active" : ""} href={setupMode ? "/login" : href} key={href} onClick={() => setSidebarOpen(false)}><Icon size={18} /><span>{t(label)}</span></Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {user?.globalRole === "ADMIN" && <Link href={setupMode ? "/login" : "/users"}><Users size={18} /><span>{t("users")}</span></Link>}
          {user?.globalRole === "ADMIN" && <Link href={setupMode ? "/login" : "/audit"}><History size={18} /><span>{t("audit")}</span></Link>}
          {user?.globalRole === "ADMIN" && <Link href={setupMode ? "/login" : "/financial"}><BadgeDollarSign size={18} /><span>{t("financial")}</span></Link>}
          {user?.globalRole === "ADMIN" && <Link href={setupMode ? "/login" : "/catalog"}><PackageOpen size={18} /><span>{t("catalog")}</span></Link>}
          <Link href={setupMode ? "/login" : "/billing"}><WalletCards size={18} /><span>{t("billing")}</span></Link>
          <Link href={setupMode ? "/login" : "/faq"}><HelpCircle size={18} /><span>{t("faq")}</span></Link>
          <Link href={setupMode ? "/login" : "/settings"}><Settings size={18} /><span>{t("settings")}</span></Link>
          <div className="user"><span className="user-avatar">{initials}</span><span><strong>{displayName}</strong><small>{displayEmail}</small></span>{user && <button className="signout" onClick={() => signOut({ callbackUrl: "/login" })} aria-label={t("signOut")}><LogOut size={16} /></button>}</div>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <button className="menu" onClick={() => setSidebarOpen(true)} aria-label={t("openMenu")}><Menu /></button>
          <GlobalSearch disabled={setupMode} />
          <ActionCenter disabled={setupMode} />
          <button className="github-status" onClick={() => notify(setupMode ? "GitHub OAuth aguardando configuração" : "GitHub conectado e operacional")}><Github size={18} /><span>{setupMode ? "Configurar GitHub" : t("githubConnected")}</span><CheckCircle2 size={15} /></button>
        </header>
        {!setupMode && <ExecutionGitHubRecovery pathname={pathname} />}
        <LocalizedContent>{children}</LocalizedContent>
      </section>
      {sidebarOpen && <button className="overlay" onClick={() => setSidebarOpen(false)} aria-label="Fechar menu" />}
      {toast && <div className="toast"><CheckCircle2 size={17} />{toast}</div>}
      <SupportChat disabled={setupMode} />
    </main>
  );
}

export default function AppShell(props) {
  return <PreferencesProvider initialLocale={props.user?.locale} initialTheme={props.user?.theme}><AppShellContent {...props} /></PreferencesProvider>;
}
