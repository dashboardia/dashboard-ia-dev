import { ShieldCheck, Users } from "lucide-react";

import AppShell from "../../components/app-shell";
import SectionHeader from "../../components/section-header";
import { db } from "../../lib/db";
import { requirePageAdmin } from "../../lib/page-access";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await requirePageAdmin();
  const users = await db.user.findMany({ include: { _count: { select: { projectMemberships: true, demandsCreated: true } } }, orderBy: { createdAt: "desc" } });
  return <AppShell user={user}><div className="section-page"><SectionHeader eyebrow="ADMINISTRAÇÃO" title="Usuários" description="Pessoas autenticadas e respectivos acessos por projeto." /><section className="form-card table-card"><div className="data-table users-table"><div className="data-head"><span>Usuário</span><span>GitHub</span><span>Papel global</span><span>Projetos</span><span>Status</span></div>{users.map((item) => <div className="data-row" key={item.id}><span className="table-title"><i><Users size={16} /></i><strong>{item.name ?? item.email}</strong><small>{item.email}</small></span><span>{item.githubLogin ?? "—"}</span><span><ShieldCheck size={13} /> {item.globalRole}</span><span>{item._count.projectMemberships}</span><span><em className={`status-pill ${item.status.toLowerCase()}`}>{item.status}</em></span></div>)}{!users.length && <div className="list-empty">Nenhum usuário.</div>}</div></section></div></AppShell>;
}
