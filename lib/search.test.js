import { describe, expect, it, vi } from "vitest";

import { normalizeSearchQuery, searchDashboard } from "./search";

function createClient(overrides = {}) {
  return {
    project: { findMany: vi.fn().mockResolvedValue(overrides.projects ?? []) },
    demand: { findMany: vi.fn().mockResolvedValue(overrides.demands ?? []) },
    execution: { findMany: vi.fn().mockResolvedValue(overrides.executions ?? []) },
    pullRequest: { findMany: vi.fn().mockResolvedValue(overrides.pullRequests ?? []) },
    executionLog: { findMany: vi.fn().mockResolvedValue(overrides.logs ?? []) },
  };
}

describe("normalizeSearchQuery", () => {
  it("normaliza espaços e limita o tamanho da consulta", () => {
    expect(normalizeSearchQuery("  corrigir   login  ")).toBe("corrigir login");
    expect(normalizeSearchQuery("a".repeat(120))).toHaveLength(100);
  });
});

describe("searchDashboard", () => {
  it("não consulta o banco para termos menores que dois caracteres", async () => {
    const client = createClient();
    await expect(searchDashboard({ user: { id: "user-1", globalRole: "USER" }, query: "a", client })).resolves.toEqual({ groups: [], total: 0 });
    expect(client.project.findMany).not.toHaveBeenCalled();
  });

  it("restringe todos os grupos aos projetos do usuário", async () => {
    const client = createClient();
    await searchDashboard({ user: { id: "user-1", globalRole: "USER" }, query: "login", client });

    const access = { members: { some: { userId: "user-1" } } };
    expect(client.project.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining(access) }));
    expect(client.demand.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ project: access }) }));
    expect(client.execution.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ demand: { project: access } }) }));
    expect(client.pullRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ project: access }) }));
    expect(client.executionLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ execution: { demand: { project: access } } }) }));
  });

  it("formata resultados navegáveis por grupo", async () => {
    const client = createClient({
      demands: [{ id: "demand-1", title: "Corrigir login", status: "APPROVED", project: { name: "Portal" } }],
    });

    const result = await searchDashboard({ user: { id: "admin-1", globalRole: "ADMIN" }, query: "login", client });
    expect(result).toEqual({
      total: 1,
      groups: [{
        type: "DEMAND",
        label: "Demandas",
        items: [{ id: "demand-1", title: "Corrigir login", subtitle: "Portal", meta: "Aprovada", href: "/demands/demand-1" }],
      }],
    });
  });
});
