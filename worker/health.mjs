import { db } from "../lib/db.js";

export async function checkProjectHealth() {
  const projects = await db.project.findMany({
    where: { status: "ACTIVE", productionUrl: { not: null } },
    select: { id: true, productionUrl: true },
    take: 100,
  });

  await Promise.allSettled(projects.map(async (project) => {
    const startedAt = Date.now();
    let status = "DOWN";
    let statusCode = null;
    let summary = null;
    try {
      const response = await fetch(project.productionUrl, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(10_000),
        headers: { "User-Agent": "Forgeboard-Health/1.0" },
      });
      statusCode = response.status;
      status = response.ok ? "HEALTHY" : response.status < 500 ? "DEGRADED" : "DOWN";
      summary = `HTTP ${response.status}`;
    } catch (error) {
      summary = error instanceof Error ? error.message.slice(0, 240) : "Falha na verificação";
    }
    await db.healthCheck.create({
      data: {
        projectId: project.id,
        status,
        statusCode,
        responseTimeMs: Date.now() - startedAt,
        summary,
      },
    });
  }));
}
