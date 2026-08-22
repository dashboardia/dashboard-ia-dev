import { describe, expect, it } from "vitest";

import { githubInstallationPublicationAccess, installationRepositoryListIncludes, isGitHubAuthorizationFailure } from "./github-authorization-recovery";

describe("GitHub authorization recovery", () => {
  it("detecta push negado pelo GitHub", () => {
    expect(isGitHubAuthorizationFailure("remote: Permission to owner/repo.git denied to dashboardia. requested URL returned error: 403")).toBe(true);
  });

  it("detecta repositório privado ainda não autorizado", () => {
    expect(isGitHubAuthorizationFailure("GitHub: Not Found")).toBe(true);
  });

  it("não confunde falha de build com autorização", () => {
    expect(isGitHubAuthorizationFailure("vite build failed: Unexpected token")).toBe(false);
  });

  it("usa as permissões da instalação do GitHub App para decidir se pode publicar", () => {
    expect(githubInstallationPublicationAccess({ permissions: { contents: "write", pull_requests: "write" } })).toMatchObject({ canPublish: true });
    expect(githubInstallationPublicationAccess({ permissions: { contents: "read", pull_requests: "write" } })).toMatchObject({ canPublish: false });
    expect(githubInstallationPublicationAccess({ permissions: { contents: "write", pull_requests: "read" } })).toMatchObject({ canPublish: false });
  });

  it("confirma que o repositório foi realmente incluído na instalação", () => {
    const payload = { repositories: [{ full_name: "Empresa/Outro" }, { full_name: "MeuPrimritoProjeto25/SpringBoot" }] };
    expect(installationRepositoryListIncludes(payload, "meuprimritoprojeto25/springboot")).toBe(true);
    expect(installationRepositoryListIncludes(payload, "meuprimritoprojeto25/nao-selecionado")).toBe(false);
  });
});
