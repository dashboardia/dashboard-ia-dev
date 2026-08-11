import { db } from "./db";
import { projectAccessWhere } from "./projects";

const RESULT_LIMIT = 5;

function managerProjectAccessWhere(user) {
  if (user.globalRole === "ADMIN") return {};
  return { members: { some: { userId: user.id, role: "MANAGER" } } };
}

export async function getActionCenter({ user, client = db, now = new Date() }) {
  const projectAccess = projectAccessWhere(user);
  const managerAccess = managerProjectAccessWhere(user);
  const recentFailureCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [pendingDemands, waitingExecutions, failedExecutions, projects] = await Promise.all([
    client.demand.findMany({
      where: { project: managerAccess, status: "PENDING_APPROVAL" },
      select: { id: true, title: true, updatedAt: true, project: { select: { name: true } } },
      orderBy: { updatedAt: "asc" },
      take: RESULT_LIMIT,
    }),
    client.execution.findMany({
      where: { demand: { project: managerAccess }, status: "WAITING_APPROVAL" },
      select: {
        id: true,
        updatedAt: true,
        demand: { select: { title: true, project: { select: { name: true } } } },
      },
      orderBy: { updatedAt: "asc" },
      take: RESULT_LIMIT,
    }),
    client.execution.findMany({
      where: {
        demand: { project: projectAccess },
        status: "FAILED",
        updatedAt: { gte: recentFailureCutoff },
      },
      select: {
        id: true,
        error: true,
        updatedAt: true,
        demand: { select: { title: true, project: { select: { name: true } } } },
      },
      orderBy: { updatedAt: "desc" },
      take: RESULT_LIMIT,
    }),
    client.project.findMany({
      where: { ...projectAccess, status: "ACTIVE", productionUrl: { not: null } },
      select: {
        id: true,
        name: true,
        healthChecks: {
          select: { status: true, checkedAt: true, summary: true },
          orderBy: { checkedAt: "desc" },
          take: 1,
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const unhealthyProjects = projects
    .filter((project) => ["DOWN", "DEGRADED"].includes(project.healthChecks[0]?.status))
    .slice(0, RESULT_LIMIT);

  const items = [
    ...failedExecutions.map((execution) => ({
      id: `execution-failed-${execution.id}`,
      kind: "EXECUTION_FAILED",
      tone: "critical",
      title: `Execução falhou: ${execution.demand.title}`,
      subtitle: execution.error ?? execution.demand.project.name,
      href: `/executions/${execution.id}`,
      occurredAt: execution.updatedAt,
    })),
    ...unhealthyProjects.map((project) => ({
      id: `project-health-${project.id}`,
      kind: "PROJECT_HEALTH",
      tone: "warning",
      title: `${project.name} requer atenção`,
      subtitle: project.healthChecks[0].summary ?? `Saúde: ${project.healthChecks[0].status}`,
      href: "/health",
      occurredAt: project.healthChecks[0].checkedAt,
    })),
    ...pendingDemands.map((demand) => ({
      id: `demand-approval-${demand.id}`,
      kind: "DEMAND_APPROVAL",
      tone: "action",
      title: `Aprovar demanda: ${demand.title}`,
      subtitle: demand.project.name,
      href: `/demands/${demand.id}`,
      occurredAt: demand.updatedAt,
    })),
    ...waitingExecutions.map((execution) => ({
      id: `execution-approval-${execution.id}`,
      kind: "EXECUTION_APPROVAL",
      tone: "action",
      title: `Revisar alteração: ${execution.demand.title}`,
      subtitle: execution.demand.project.name,
      href: `/executions/${execution.id}`,
      occurredAt: execution.updatedAt,
    })),
  ];

  return { count: items.length, items };
}
