import { db } from "./db";
import { projectAccessWhere } from "./projects";

const LIMIT_PER_GROUP = 5;

const demandStatusLabels = {
  DRAFT: "Rascunho",
  PENDING_APPROVAL: "Aguardando aprovação",
  APPROVED: "Aprovada",
  QUEUED: "Na fila",
  RUNNING: "Em execução",
  REVIEW: "Em revisão",
  SUCCEEDED: "Concluída",
  FAILED: "Falhou",
  CANCELLED: "Cancelada",
};

const executionStatusLabels = {
  QUEUED: "Na fila",
  PREPARING: "Preparando",
  RUNNING: "Em execução",
  VALIDATING: "Validando",
  WAITING_APPROVAL: "Aguardando aprovação",
  SUCCEEDED: "Concluída",
  FAILED: "Falhou",
  CANCELLED: "Cancelada",
};

const pullRequestStatusLabels = {
  DRAFT: "Rascunho",
  OPEN: "Aberto",
  MERGED: "Mesclado",
  CLOSED: "Fechado",
};

export function normalizeSearchQuery(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 100) : "";
}

function textContains(query) {
  return { contains: query, mode: "insensitive" };
}

export async function searchDashboard({ user, query, client = db }) {
  const normalizedQuery = normalizeSearchQuery(query);
  if (normalizedQuery.length < 2) return { groups: [], total: 0 };

  const projectAccess = projectAccessWhere(user);
  const contains = textContains(normalizedQuery);

  const [projects, demands, executions, pullRequests, logs] = await Promise.all([
    client.project.findMany({
      where: {
        ...projectAccess,
        OR: [{ name: contains }, { repositoryFullName: contains }],
      },
      select: { id: true, name: true, repositoryFullName: true, status: true },
      orderBy: { updatedAt: "desc" },
      take: LIMIT_PER_GROUP,
    }),
    client.demand.findMany({
      where: {
        project: projectAccess,
        OR: [{ title: contains }, { description: contains }, { acceptanceCriteria: contains }],
      },
      select: { id: true, title: true, status: true, project: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: LIMIT_PER_GROUP,
    }),
    client.execution.findMany({
      where: {
        demand: { project: projectAccess },
        OR: [
          { branchName: contains },
          { summary: contains },
          { error: contains },
          { demand: { title: contains } },
        ],
      },
      select: {
        id: true,
        status: true,
        stage: true,
        demand: { select: { title: true, project: { select: { name: true } } } },
      },
      orderBy: { updatedAt: "desc" },
      take: LIMIT_PER_GROUP,
    }),
    client.pullRequest.findMany({
      where: {
        project: projectAccess,
        OR: [{ title: contains }, { headBranch: contains }, { baseBranch: contains }],
      },
      select: {
        id: true,
        executionId: true,
        externalNumber: true,
        title: true,
        status: true,
        project: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: LIMIT_PER_GROUP,
    }),
    client.executionLog.findMany({
      where: {
        execution: { demand: { project: projectAccess } },
        OR: [{ scope: contains }, { message: contains }],
      },
      select: {
        id: true,
        executionId: true,
        level: true,
        scope: true,
        message: true,
        execution: {
          select: { demand: { select: { title: true, project: { select: { name: true } } } } },
        },
      },
      orderBy: { createdAt: "desc" },
      take: LIMIT_PER_GROUP,
    }),
  ]);

  const groups = [
    {
      type: "PROJECT",
      label: "Projetos",
      items: projects.map((project) => ({
        id: project.id,
        title: project.name,
        subtitle: project.repositoryFullName,
        meta: project.status,
        href: `/projects/${project.id}`,
      })),
    },
    {
      type: "DEMAND",
      label: "Demandas",
      items: demands.map((demand) => ({
        id: demand.id,
        title: demand.title,
        subtitle: demand.project.name,
        meta: demandStatusLabels[demand.status] ?? demand.status,
        href: `/demands/${demand.id}`,
      })),
    },
    {
      type: "EXECUTION",
      label: "Execuções",
      items: executions.map((execution) => ({
        id: execution.id,
        title: execution.demand.title,
        subtitle: `${execution.demand.project.name} · ${execution.stage}`,
        meta: executionStatusLabels[execution.status] ?? execution.status,
        href: `/executions/${execution.id}`,
      })),
    },
    {
      type: "PULL_REQUEST",
      label: "Pull Requests",
      items: pullRequests.map((pullRequest) => ({
        id: pullRequest.id,
        title: `#${pullRequest.externalNumber} · ${pullRequest.title}`,
        subtitle: pullRequest.project.name,
        meta: pullRequestStatusLabels[pullRequest.status] ?? pullRequest.status,
        href: `/executions/${pullRequest.executionId}`,
      })),
    },
    {
      type: "LOG",
      label: "Logs",
      items: logs.map((entry) => ({
        id: entry.id,
        title: `${entry.scope} · ${entry.message}`,
        subtitle: `${entry.execution.demand.project.name} · ${entry.execution.demand.title}`,
        meta: entry.level.toUpperCase(),
        href: `/executions/${entry.executionId}`,
      })),
    },
  ].filter((group) => group.items.length > 0);

  return {
    groups,
    total: groups.reduce((sum, group) => sum + group.items.length, 0),
  };
}
