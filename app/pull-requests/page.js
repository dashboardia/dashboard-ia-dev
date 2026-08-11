import { ExternalLink, GitPullRequest } from "lucide-react";

import AppShell from "../../components/app-shell";
import SectionHeader from "../../components/section-header";
import { db } from "../../lib/db";
import { requirePageUser } from "../../lib/page-access";
import { projectAccessWhere } from "../../lib/projects";

export const dynamic = "force-dynamic";

export default async function PullRequestsPage() {
  const user = await requirePageUser();
  const pullRequests = await db.pullRequest.findMany({
    where: { project: projectAccessWhere(user) },
    include: { project: { select: { name: true } }, demand: { select: { title: true } } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return <AppShell user={user}><div className="section-page"><SectionHeader eyebrow="ENTREGAS" title="Pull Requests" description="Alterações abertas no GitHub somente após aprovação de um Gestor." /><section className="resource-grid">{pullRequests.map((pullRequest) => <a className="resource-card" href={pullRequest.url} target="_blank" rel="noreferrer" key={pullRequest.id}><span className="resource-icon"><GitPullRequest size={21} /></span><div className="resource-title"><strong>#{pullRequest.externalNumber} · {pullRequest.title}</strong></div><p>{pullRequest.project.name}</p><div className="resource-meta"><span>{pullRequest.status}</span><span>{pullRequest.headBranch} → {pullRequest.baseBranch}</span></div><ExternalLink className="card-external" size={15} /></a>)}{!pullRequests.length && <div className="resource-empty"><GitPullRequest size={28} /><strong>Nenhum Pull Request</strong><span>As entregas aprovadas aparecerão aqui.</span></div>}</section></div></AppShell>;
}
