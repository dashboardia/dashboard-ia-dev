import AppShell from "../../components/app-shell";
import SectionHeader from "../../components/section-header";
import { db } from "../../lib/db";
import { requirePageUser } from "../../lib/page-access";
import { projectAccessWhere } from "../../lib/projects";
import EnvironmentsClient from "./environments-client";

export const dynamic = "force-dynamic";

export default async function EnvironmentsPage({ searchParams }) {
  const user = await requirePageUser();
  const query = await searchParams;
  const access = projectAccessWhere(user);
  const [projects, environments] = await Promise.all([
    db.project.findMany({
      where: { ...access, status: { not: "ARCHIVED" } },
      select: { id: true, name: true, repositoryFullName: true, defaultBranch: true },
      orderBy: { name: "asc" },
    }),
    db.devEnvironment.findMany({
      where: { project: access },
      include: { project: { select: { name: true, repositoryFullName: true } }, requestedBy: { select: { name: true, githubLogin: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  const requestedProject = projects.find((project) => project.id === query?.projectId);
  const initialSelection = requestedProject && typeof query?.branch === "string" && query.branch.length <= 255
    ? { projectId: requestedProject.id, branchName: query.branch }
    : null;

  return <AppShell user={user}><div className="section-page"><SectionHeader eyebrow="DOCKER" title="Ambientes" description="Suba uma branch do cliente em um container isolado, sem vincular o ambiente à execução de uma demanda." /><EnvironmentsClient initialProjects={projects} initialEnvironments={environments} initialSelection={initialSelection} /></div></AppShell>;
}
