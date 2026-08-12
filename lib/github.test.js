import { afterEach, describe, expect, it, vi } from "vitest";

import { findOpenGitHubPullRequest, githubRequest } from "./github";

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
});
