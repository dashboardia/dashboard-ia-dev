import { db } from "./db";
import { projectAccessWhere } from "./projects";

const demandTypeLabel = {
  BUG: "Correção",
  FEATURE: "Funcionalidade",
  REFACTOR: "Refatoração",
  TEST: "Testes",
  INVESTIGATION: "Investigação",
  DOCUMENTATION: "Documentação de negócio",
};

const demandStatus = {
  DRAFT: ["Rascunho", "gray"],
  PENDING_APPROVAL: ["Aguardando aprovação", "amber"],
  APPROVED: ["Aprovada", "blue"],
  QUEUED: ["Na fila", "blue"],
  RUNNING: ["Em execução", "purple"],
  REVIEW: ["Em revisão", "amber"],
  SUCCEEDED: ["Concluída", "green"],
  AWAITING_CLIENT: ["Aguardando cliente", "yellow"],
  FAILED: ["Falhou", "red"],
  CANCELLED: ["Cancelada", "gray"],
  STOPPED: ["Parada pelo administrador", "gray"],
};

const projectColors = ["#7c5cff", "#0ea5e9", "#16a06b", "#f59e0b", "#e25372"];

function relativeTime(date) {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "agora";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "ontem" : `há ${days} dias`;
}

export async function getDashboardData(user) {
  const access = projectAccessWhere(user);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const lastDay = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [projects, connectedProjects, recentDemands, activeDemands, executionsToday, successfulToday, healthCheckCount, healthyHealthCheckCount, recentHealthChecks] = await Promise.all([
    db.project.findMany({
      where: { ...access, status: "ACTIVE" },
      include: { healthChecks: { orderBy: { checkedAt: "desc" }, take: 1 } },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
    db.project.count({ where: { ...access, status: "ACTIVE" } }),
    db.demand.findMany({
      where: { project: access },
      include: { project: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
    db.demand.count({ where: { project: access, status: { in: ["PENDING_APPROVAL", "APPROVED", "QUEUED", "RUNNING", "REVIEW"] } } }),
    db.execution.count({ where: { demand: { project: access }, createdAt: { gte: startOfDay } } }),
    db.execution.count({ where: { demand: { project: access }, createdAt: { gte: startOfDay }, status: "SUCCEEDED" } }),
    db.healthCheck.count({ where: { project: access, checkedAt: { gte: lastDay } } }),
    db.healthCheck.count({ where: { project: access, checkedAt: { gte: lastDay }, status: "HEALTHY" } }),
    db.healthCheck.findMany({ where: { project: access, checkedAt: { gte: lastDay } }, orderBy: { checkedAt: "desc" }, take: 24 }),
  ]);

  const availability = healthCheckCount ? (healthyHealthCheckCount / healthCheckCount) * 100 : null;
  const chartSource = recentHealthChecks.reverse();

  return {
    metrics: {
      projects: connectedProjects,
      activeDemands,
      executionsToday,
      successfulToday,
      availability: availability === null ? "—" : `${availability.toFixed(1).replace(".", ",")}%`,
    },
    projects: projects.map((project, index) => {
      const latestHealth = project.healthChecks[0]?.status ?? "UNKNOWN";
      return {
        id: project.id,
        name: project.name,
        repo: project.repositoryFullName,
        branch: project.defaultBranch,
        health: latestHealth === "HEALTHY" ? "Saudável" : latestHealth === "UNKNOWN" ? "Sem dados" : "Atenção",
        deploy: project.productionUrl ? "Configurado" : "Pendente",
        color: projectColors[index % projectColors.length],
      };
    }),
    demands: recentDemands.map((demand) => {
      const [status, tone] = demandStatus[demand.status] ?? [demand.status, "gray"];
      return {
        id: demand.id,
        title: demand.title,
        project: demand.project.name,
        type: demandTypeLabel[demand.type] ?? demand.type,
        status,
        tone,
        time: relativeTime(demand.updatedAt),
      };
    }),
    health: {
      availability: availability === null ? "—" : `${availability.toFixed(1).replace(".", ",")}%`,
      title: healthCheckCount ? (availability >= 99 ? "Operação estável" : "Operação requer atenção") : "Monitoramento pendente",
      subtitle: healthCheckCount ? `Última verificação ${relativeTime(chartSource.at(-1)?.checkedAt ?? new Date())}` : "Conecte a URL de produção dos projetos",
      healthy: projects.filter((project) => project.healthChecks[0]?.status === "HEALTHY").length,
      attention: projects.filter((project) => ["DEGRADED", "DOWN"].includes(project.healthChecks[0]?.status)).length,
      chart: chartSource.map((check) => check.responseTimeMs ?? 0),
    },
  };
}
