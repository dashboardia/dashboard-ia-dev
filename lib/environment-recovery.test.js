import { describe, expect, test } from "vitest";

import { buildEnvironmentRecoveryDraft, summarizeEnvironmentFailure } from "./environment-recovery.js";

describe("environment recovery", () => {
  test("extrai o erro de sintaxe útil de um build Vite", () => {
    const failure = summarizeEnvironmentFailure(`
      error during build:
      /app/client/src/App.jsx:226:3: ERROR: Unexpected ")"
      Command failed: npm --prefix client run build
    `);
    expect(failure.file).toBe("client/src/App.jsx");
    expect(failure.line).toBe(226);
    expect(failure.summary).toContain('Unexpected ")"');
  });

  test("gera mensagem de interação e demanda a partir da mesma falha", () => {
    const draft = buildEnvironmentRecoveryDraft({
      id: "env-1",
      projectId: "project-1",
      branchName: "feature/demo",
      error: '/app/client/src/App.jsx:226:3: ERROR: Unexpected ")"',
    });
    expect(draft.title).toContain("App.jsx");
    expect(draft.description).toContain("feature/demo");
    expect(draft.interactionMessage).toContain("mesmo contexto e Pull Request");
    expect(draft.acceptanceCriteria).toContain("build da branch");
  });
});
