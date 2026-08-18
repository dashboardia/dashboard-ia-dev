import { describe, expect, it, vi } from "vitest";

import { findDeploymentPreview, inspectDeploymentPreview } from "./deployment-preview";

const publicResolver = async () => [{ address: "203.0.113.10", family: 4 }];

describe("findDeploymentPreview", () => {
  it("ignora produção e retorna o ambiente temporário associado ao commit", async () => {
    const apiRequest = vi.fn(async (_token, path) => {
      if (path.includes("/deployments?")) {
        return [
          { id: 1, environment: "Production", production_environment: true, created_at: "2026-08-18T10:00:00Z" },
          { id: 2, environment: "Preview", production_environment: false, created_at: "2026-08-18T11:00:00Z" },
        ];
      }
      return [{ state: "success", environment_url: "https://preview.example.com", creator: { login: "railway" }, updated_at: "2026-08-18T11:05:00Z" }];
    });

    await expect(findDeploymentPreview({
      token: "token",
      repositoryFullName: "acme/app",
      sha: "abc123",
      apiRequest,
    })).resolves.toMatchObject({ state: "AVAILABLE", url: "https://preview.example.com", provider: "railway" });
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it("mantém o estado preparando enquanto o provedor ainda não publicou uma URL", async () => {
    const apiRequest = vi.fn(async (_token, path) => path.includes("/deployments?")
      ? [{ id: 2, environment: "Preview", production_environment: false }]
      : [{ state: "in_progress", description: "Building" }]);

    await expect(findDeploymentPreview({ token: "token", repositoryFullName: "acme/app", sha: "abc", apiRequest }))
      .resolves.toMatchObject({ state: "PREPARING", url: null, message: "Building" });
  });

  it("informa quando nenhum provedor registrou deployment para o commit", async () => {
    const apiRequest = vi.fn(async () => []);
    await expect(findDeploymentPreview({ token: "token", repositoryFullName: "acme/app", sha: "abc", apiRequest }))
      .resolves.toMatchObject({ state: "NOT_FOUND", url: null });
  });
});

describe("inspectDeploymentPreview", () => {
  it("detecta OpenAPI e executa somente um GET sem parâmetros obrigatórios", async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (new URL(url).pathname === "/openapi.json") {
        return new Response(JSON.stringify({
          info: { title: "Catálogo", version: "1.0" },
          paths: {
            "/items": { get: { summary: "Lista itens" }, post: { summary: "Cria item" } },
            "/items/{id}": { get: { summary: "Busca item" } },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (new URL(url).pathname === "/items") {
        return new Response(JSON.stringify([{ id: 1 }]), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await inspectDeploymentPreview("https://preview.example.com", { fetchImpl, resolver: publicResolver });
    expect(result).toMatchObject({ mode: "API", title: "Catálogo", example: { method: "GET", path: "/items", status: 200 } });
    expect(result.endpoints).toHaveLength(3);
    expect(fetchImpl.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(expect.arrayContaining([
      "/openapi.json",
      "/swagger.json",
      "/v3/api-docs",
      "/api-docs",
      "/items",
    ]));
  });

  it("não acessa endereços internos informados como preview", async () => {
    const fetchImpl = vi.fn();
    const result = await inspectDeploymentPreview("https://127.0.0.1", { fetchImpl });
    expect(result.mode).toBe("WEB");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
