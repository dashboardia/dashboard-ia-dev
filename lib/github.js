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

export function createGitHubPullRequest(token, repositoryFullName, input) {
  return githubRequest(token, `/repos/${repositoryFullName}/pulls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
