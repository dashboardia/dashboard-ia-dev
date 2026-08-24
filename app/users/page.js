import { Coins, ShieldCheck, Users } from "lucide-react";

import AppShell from "../../components/app-shell";
import SectionHeader from "../../components/section-header";
import { db } from "../../lib/db";
import { requirePageAdmin } from "../../lib/page-access";
import UserControls from "./user-controls";

export const dynamic = "force-dynamic";

function availableCredits(user) {
  if (user.globalRole === "ADMIN" || user.billingAccount?.plan === "CUSTOM") return null;
  const balance = user.billingAccount?.creditBuckets.reduce((total, bucket) => total + bucket.remaining - bucket.reserved, 0) ?? 0;
  return Math.max(0, balance - (user.billingAccount?.creditDebt ?? 0));
}

export default async function UsersPage() {
  const user = await requirePageAdmin();
  const now = new Date();
  const users = await db.user.findMany({
    include: {
      billingAccount: { include: { creditBuckets: { where: { expiresAt: { gt: now }, remaining: { gt: 0 } }, select: { remaining: true, reserved: true } } } },
      _count: { select: { projectMemberships: true, demandsCreated: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return <AppShell user={user}><div className="section-page"><SectionHeader eyebrow="ADMINISTRAÇÃO" title="Usuários" description="Gerencie acesso, créditos e exclusão dos dados vinculados a cada conta." /><section className="form-card table-card"><div className="data-table users-table"><div className="data-head"><span>Usuário</span><span>GitHub</span><span>Projetos</span><span>Créditos</span><span>Ações</span></div>{users.map((item) => { const credits = availableCredits(item); return <div className="data-row" key={item.id}><span className="table-title"><i><Users size={16} /></i><strong>{item.name ?? item.email}</strong><small>{item.email}</small></span><span>{item.githubLogin ?? "—"}</span><span><ShieldCheck size={13} /> {item._count.projectMemberships}</span><span className="user-credit-balance"><Coins size={13} />{credits == null ? "Ilimitados" : credits.toLocaleString("pt-BR")}</span><UserControls userId={item.id} initialRole={item.globalRole} initialStatus={item.status} currentUser={item.id === user.id} targetLabel={item.email ?? item.githubLogin ?? item.id} /></div>; })}{!users.length && <div className="list-empty">Nenhum usuário.</div>}</div></section></div></AppShell>;
}
