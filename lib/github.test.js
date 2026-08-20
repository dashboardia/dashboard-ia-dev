import { afterEach, describe, expect, it, vi } from "vitest";

import { findOpenGitHubPullRequest, githubRequest, listRepositoryBranches } from "./github";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHub API", () => {
  it("limita o tempo das chamadas e preserva os cabeçalhos de autenticação", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 1 }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(githubRequest("token", "/user")).resolves.toEqual({ id: 1 });
    expect(fetchMock).toHaveBeenCalledWith("https://api.github.com/user", expect.objectContaining({
      signal: expect.any(AbortSignal),
      headers: expect.objectContaining({ Authorization: "Bearer token" }),
    }));
  });

  it("reutiliza somente o Pull Request aberto para a mesma branch e base", async () => {
    const matching = { number: 12, head: { ref: "forgeboard/demand-1" }, base: { ref: "main" } };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { number: 11, head: { ref: "outra-branch" }, base: { ref: "main" } },
        matching,
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(findOpenGitHubPullRequest("token", "acme/app", "forgeboard/demand-1", "main")).resolves.toEqual(matching);
    expect(fetchMock.mock.calls[0][0]).toContain("head=acme%3Aforgeboard%2Fdemand-1");
    expect(fetchMock.mock.calls[0][0]).toContain("base=main");
  });

  it("pagina e normaliza todas as branches do repositório", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ name: `branch-${index}`, protected: index === 0, commit: { sha: `sha-${index}` } }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => firstPage })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ name: "release", protected: false, commit: { sha: "sha-release" } }] });
    vi.stubGlobal("fetch", fetchMock);

    const branches = await listRepositoryBranches("token", "acme/app");

    expect(branches).toHaveLength(101);
    expect(branches[0]).toEqual({ name: "branch-0", protected: true, sha: "sha-0" });
    expect(branches.at(-1)).toEqual({ name: "release", protected: false, sha: "sha-release" });
    expect(fetchMock.mock.calls[0][0]).toContain("page=1");
    expect(fetchMock.mock.calls[1][0]).toContain("page=2");
  });
});
