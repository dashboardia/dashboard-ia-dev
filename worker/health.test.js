import { describe, expect, it, vi } from "vitest";

import { checkProjectHealth } from "./health.mjs";

describe("project health monitor", () => {
  it("verifica todos os projetos com concorrência limitada", async () => {
    const projects = Array.from({ length: 23 }, (_, index) => ({ id: `project-${index}`, productionUrl: `https://app-${index}.test` }));
    let activeRequests = 0;
    let maximumConcurrency = 0;
    const fetchImpl = vi.fn(async () => {
      activeRequests += 1;
      maximumConcurrency = Math.max(maximumConcurrency, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 2));
      activeRequests -= 1;
      return { ok: true, status: 200, body: { cancel: vi.fn().mockResolvedValue(undefined) } };
    });
    const client = {
      project: { findMany: vi.fn().mockResolvedValue(projects) },
      healthCheck: { create: vi.fn().mockResolvedValue({}) },
    };

    await checkProjectHealth({ client, fetchImpl, concurrency: 5 });

    expect(fetchImpl).toHaveBeenCalledTimes(23);
    expect(client.healthCheck.create).toHaveBeenCalledTimes(23);
    expect(maximumConcurrency).toBeLessThanOrEqual(5);
    expect(client.project.findMany.mock.calls[0][0]).not.toHaveProperty("take");
  });

  it("classifica respostas e falhas sem interromper as demais verificações", async () => {
    const projects = [
      { id: "healthy", productionUrl: "https://healthy.test" },
      { id: "degraded", productionUrl: "https://degraded.test" },
      { id: "down", productionUrl: "https://down.test" },
    ];
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes("healthy")) return { ok: true, status: 200 };
      if (url.includes("degraded")) return { ok: false, status: 404 };
      throw new Error("timeout");
    });
    const client = {
      project: { findMany: vi.fn().mockResolvedValue(projects) },
      healthCheck: { create: vi.fn().mockResolvedValue({}) },
    };

    await checkProjectHealth({ client, fetchImpl, concurrency: 3 });

    const statuses = Object.fromEntries(client.healthCheck.create.mock.calls.map(([input]) => [input.data.projectId, input.data.status]));
    expect(statuses).toEqual({ healthy: "HEALTHY", degraded: "DEGRADED", down: "DOWN" });
  });
});
