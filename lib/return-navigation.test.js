import { describe, expect, it } from "vitest";

import { loginReturnPath, safeInternalReturnPath, withReturnState } from "./return-navigation";

describe("return navigation", () => {
  it("aceita somente caminhos internos", () => {
    expect(safeInternalReturnPath("/executions/abc?tab=logs")).toBe("/executions/abc?tab=logs");
    expect(safeInternalReturnPath("https://evil.example/test")).toBe("/");
    expect(safeInternalReturnPath("//evil.example/test")).toBe("/");
  });

  it("anexa o ponto de retorno à autorização do GitHub", () => {
    const result = withReturnState("https://github.com/apps/dashboard-ia/installations/new", "/projects/new");
    expect(new URL(result).searchParams.get("state")).toBe("/projects/new");
  });

  it("envia login normal sempre para a visão geral", () => {
    expect(loginReturnPath({ callbackUrl: "/billing", state: "/projects/new" }, "/executions/abc")).toBe("/");
  });

  it("retorna à tela de origem após autorizar um repositório", () => {
    expect(loginReturnPath({ installation_id: "123", setup_action: "install", state: "/projects/new" }, "/")).toBe("/projects/new");
    expect(loginReturnPath({ installation_id: "123" }, "/executions/abc")).toBe("/executions/abc");
  });
});
