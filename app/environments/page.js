import AppShell from "../../components/app-shell";
import SectionHeader from "../../components/section-header";
import { db } from "../../lib/db";
import { requirePageUser } from "../../lib/page-access";
import { projectAccessWhere } from "../../lib/projects";
import EnvironmentsClient from "./environments-client";

export const dynamic = "force-dynamic";

function executionPreviewView(environment) {
  const execution = environment.execution;
  return {
    id: environment.id,
    source: "EXECUTION",
    executionId: execution.id,
    projectId: execution.demand.projectId,
    branchName: execution.branchName ?? execution.demand.baseBranch,
    status: environment.status,
    provider: environment.provider,
    externalId: environment.externalId,
    url: environment.url,
    runtime: environment.runtime,
    imageReference: environment.imageReference,
    port: environment.port,
    error: environment.error,
    requestedAt: environment.requestedAt,
    createdAt: environment.createdAt,
    updatedAt: environment.updatedAt,
    startedAt: environment.startedAt,
    readyAt: environment.readyAt,
    expiresAt: environment.expiresAt,
    stoppedAt: environment.stoppedAt,
    lastHeartbeatAt: environment.lastHeartbeatAt,
    creditCost: 0,
    creditCharge: null,
    creditChargedAt: null,
    creditRefundedAt: null,
    adjustments: [],
    credentials: null,
    activity: [],
    project: {
      name: execution.demand.project.name,
      repositoryFullName: execution.demand.project.repositoryFullName,
    },
    requestedBy: execution.requestedBy,
  };
}

export default async function EnvironmentsPage({ searchParams }) {
  const user = await requirePageUser();
  const query = await searchParams;
  const access = projectAccessWhere(user);
  const [projects, devEnvironments, executionPreviews] = await Promise.all([
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
    db.previewEnvironment.findMany({
      where: { execution: { demand: { project: access } } },
      include: {
        execution: {
          select: {
            id: true,
            branchName: true,
            requestedBy: { select: { name: true, githubLogin: true } },
            demand: {
              select: {
                projectId: true,
                baseBranch: true,
                project: { select: { name: true, repositoryFullName: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  const environments = [
    ...devEnvironments.map((environment) => ({ ...environment, source: "MANUAL", executionId: null })),
    ...executionPreviews.map(executionPreviewView),
  ]
    .sort((left, right) => new Date(right.createdAt ?? right.requestedAt ?? 0) - new Date(left.createdAt ?? left.requestedAt ?? 0))
    .slice(0, 50);

  const requestedProject = projects.find((project) => project.id === query?.projectId);
  const initialSelection = requestedProject && typeof query?.branch === "string" && query.branch.length <= 255
    ? { projectId: requestedProject.id, branchName: query.branch }
    : null;

  return <AppShell user={user}><div className="section-page"><SectionHeader eyebrow="DOCKER" title="Ambientes" description="Veja ambientes automáticos das execuções ou suba manualmente uma branch para testes. A Dashboard IA mantém apenas um ambiente ativo por projeto." /><EnvironmentsClient initialProjects={projects} initialEnvironments={environments} initialSelection={initialSelection} /></div></AppShell>;
}
