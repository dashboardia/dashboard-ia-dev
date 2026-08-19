import { createPrivateKey, sign } from "node:crypto";

import { db } from "./db.js";
import { env } from "./env.js";
import { oauthTokenCipher, protectGitHubOAuthTokens } from "./secret-encryption.js";

export async function getGitHubAccessToken(userId) {
  const account = await db.account.findFirst({
    where: { userId, provider: "github" },
    select: { id: true, provider: true, access_token: true, refresh_token: true, id_token: true },
  });
  if (!account?.access_token) throw new Error("Conta GitHub sem token de acesso");

  const accessToken = oauthTokenCipher.decrypt(account.access_token, "github:access_token");
  const hasUnprotectedToken = [account.access_token, account.refresh_token, account.id_token]
    .some((token) => token && !oauthTokenCipher.isEncrypted(token));
  if (oauthTokenCipher.configured && hasUnprotectedToken) {
    const protectedTokens = protectGitHubOAuthTokens(account, oauthTokenCipher);
    await db.account.update({
      where: { id: account.id },
      data: protectedTokens,
    });
  }
  return accessToken;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

export function createGitHubAppJwt(now = Math.floor(Date.now() / 1000)) {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) throw new Error("GitHub App não configurado");
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: env.GITHUB_APP_ID }));
  const unsigned = `${header}.${payload}`;
  const privateKey = createPrivateKey(env.GITHUB_APP_PRIVATE_KEY.replaceAll("\\n", "\n"));
  return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")}`;
}

export async function getGitHubInstallationToken(installationId) {
  if (!installationId) throw new Error("Instalação do GitHub App não informada");
  const result = await githubRequest(createGitHubAppJwt(), `/app/installations/${encodeURIComponent(installationId)}/access_tokens`, { method: "POST" });
  if (!result?.token) throw new Error("GitHub não retornou o token da instalação");
  return result.token;
}

export async function getProjectGitHubAccessToken(project, fallbackUserId) {
  if (project.githubInstallationId) return getGitHubInstallationToken(project.githubInstallationId);
  if (!fallbackUserId) throw new Error("Projeto sem instalação do GitHub App");
  return getGitHubAccessToken(fallbackUserId);
}

export function getGitHubAppInstallUrl() {
  return env.GITHUB_APP_SLUG ? `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new` : null;
}

export async function findGitHubRepositoryInstallation(repositoryFullName) {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) return null;
  try {
    return await githubRequest(
      createGitHubAppJwt(),
      `/repos/${repositoryFullName.toLowerCase()}/installation`,
    );
  } catch (error) {
    if (error instanceof Error && error.message === "GitHub: Not Found") return null;
    throw error;
  }
}

export async function githubRequest(token, path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(30_000),
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

export async function findOpenGitHubPullRequest(token, repositoryFullName, headBranch, baseBranch) {
  const owner = repositoryFullName.split("/")[0];
  const search = new URLSearchParams({
    state: "open",
    head: `${owner}:${headBranch}`,
    base: baseBranch,
    per_page: "20",
  });
  const pullRequests = await githubRequest(token, `/repos/${repositoryFullName}/pulls?${search}`);
  return pullRequests.find((pullRequest) => pullRequest.head?.ref === headBranch && pullRequest.base?.ref === baseBranch) ?? null;
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
