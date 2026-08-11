import { db } from "./db.js";

export async function getGitHubAccessToken(userId) {
  const account = await db.account.findFirst({
    where: { userId, provider: "github" },
    select: { access_token: true },
  });
  if (!account?.access_token) throw new Error("Conta GitHub sem token de acesso");
  return account.access_token;
}

export async function githubRequest(token, path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Forgeboard",
      ...options.headers,
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.message ? `GitHub: ${payload.message}` : `GitHub respondeu ${response.status}`);
  }
  return payload;
}

export function verifyRepositoryAccess(token, repositoryFullName) {
  return githubRequest(token, `/repos/${repositoryFullName}`);
}

export function verifyRepositoryBranch(token, repositoryFullName, branchName) {
  return githubRequest(token, `/repos/${repositoryFullName}/branches/${encodeURIComponent(branchName)}`);
}

export function createGitHubPullRequest(token, repositoryFullName, input) {
  return githubRequest(token, `/repos/${repositoryFullName}/pulls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function ensureGitHubWebhook(token, repositoryFullName, input) {
  const hooks = await githubRequest(token, `/repos/${repositoryFullName}/hooks?per_page=100`);
  const existing = hooks.find((hook) => hook.name === "web" && hook.config?.url === input.url);
  const body = {
    name: "web",
    active: true,
    events: ["pull_request"],
    config: {
      url: input.url,
      content_type: "json",
      secret: input.secret,
      insecure_ssl: "0",
    },
  };

  if (existing) {
    return githubRequest(token, `/repos/${repositoryFullName}/hooks/${existing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  return githubRequest(token, `/repos/${repositoryFullName}/hooks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
