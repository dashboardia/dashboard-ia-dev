import { describe, expect, it, vi } from "vitest";

import { getActionCenter } from "./action-center";

function createClient(overrides = {}) {
  return {
    demand: { findMany: vi.fn().mockResolvedValue(overrides.pendingDemands ?? []) },
    execution: {
      findMany: vi.fn()
        .mockResolvedValueOnce(overrides.waitingExecutions ?? [])
        .mockResolvedValueOnce(overrides.failedExecutions ?? []),
    },
    project: { findMany: vi.fn().mockResolvedValue(overrides.projects ?? []) },
  };
}

describe("getActionCenter", () => {
  it("restringe aprovações a projetos onde o usuário é Gestor", async () => {
    const client = createClient();
    await getActionCenter({ user: { id: "user-1", globalRole: "USER" }, client });

    const managerAccess = { members: { some: { userId: "user-1", role: "MANAGER" } } };
    expect(client.demand.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { project: managerAccess, status: "PENDING_APPROVAL" } }));
    expect(client.execution.findMany.mock.calls[0][0]).toEqual(expect.objectContaining({ where: { demand: { project: managerAccess }, status: "WAITING_APPROVAL" } }));
  });

  it("permite que Administradores vejam todas as aprovações", async () => {
    const client = createClient();
    await getActionCenter({ user: { id: "admin-1", globalRole: "ADMIN" }, client });
    expect(client.demand.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { project: {}, status: "PENDING_APPROVAL" } }));
  });

  it("prioriza falhas, saúde e ações pendentes", async () => {
    const date = new Date("2026-08-11T20:00:00Z");
    const client = createClient({
      pendingDemands: [{ id: "d1", title: "Adicionar busca", updatedAt: date, project: { name: "Forgeboard" } }],
      failedExecutions: [{ id: "e1", error: "Build falhou", updatedAt: date, demand: { title: "Corrigir login", project: { name: "Portal" } } }],
      projects: [{ id: "p1", name: "API", healthChecks: [{ status: "DOWN", checkedAt: date, summary: "HTTP 503" }] }],
    });

    const result = await getActionCenter({ user: { id: "admin-1", globalRole: "ADMIN" }, client, now: date });
    expect(result.count).toBe(3);
    expect(result.items.map((item) => item.kind)).toEqual(["EXECUTION_FAILED", "PROJECT_HEALTH", "DEMAND_APPROVAL"]);
  });
});
