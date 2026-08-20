import { describe, expect, it } from "vitest";

import { isUsableProjectPath, repositoryHasUsableProject } from "./repository-content";

describe("repository project content", () => {
  it("não considera documentação e configuração do GitHub como projeto", () => {
    expect(repositoryHasUsableProject(["README.md", ".github/workflows/ci.yml", "docs/architecture.md"])).toBe(false);
  });

  it("reconhece aplicações na raiz ou em monorepos", () => {
    expect(repositoryHasUsableProject(["frontend/package.json"])).toBe(true);
    expect(isUsableProjectPath("backend/src/main/java/App.java")).toBe(true);
    expect(isUsableProjectPath("index.html")).toBe(true);
  });
});
