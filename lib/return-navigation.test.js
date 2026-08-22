import { describe, expect, it } from "vitest";

import { safeInternalReturnPath, withReturnState } from "./return-navigation";

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
});
