import { getServerSession } from "next-auth";

import { authOptions } from "./auth";
import { db } from "./db";
import { env } from "./env";
import { getGitHubAccessToken } from "./github";

const PROJECT_ROLE_LEVEL = {
  VIEWER: 10,
  DEVELOPER: 20,
  MANAGER: 30,
};

export class AccessDeniedError extends Error {
  constructor(message = "Acesso negado", status = 403) {
    super(message);
    this.name = "AccessDeniedError";
    this.status = status;
  }
}

export function isAtLeastProjectRole(actualRole, requiredRole) {
  return (PROJECT_ROLE_LEVEL[actualRole] ?? 0) >= (PROJECT_ROLE_LEVEL[requiredRole] ?? Infinity);
}

export function isConfiguredAdmin(githubLogin, configuredLogin = env.ADMIN_GITHUB_LOGIN) {
  if (!githubLogin || !configuredLogin) return false;
  return githubLogin.trim().toLowerCase() === configuredLogin.trim().toLowerCase();
}

async function recoverGitHubLogin(userId) {
  try {
    const accessToken = await getGitHubAccessToken(userId);
    const response = await fetch("https://api.github.com/user", {
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Forgeboard",
      },
    });
    if (!response.ok) return null;

    const profile = await response.json();
    return typeof profile?.login === "string" && profile.login.trim() ? profile.login.trim() : null;
  } catch (error) {
    console.error("[auth] Falha ao recuperar login do GitHub", error);
    return null;
  }
}

export async function getCurrentUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      githubLogin: true,
      globalRole: true,
      status: true,
    },
  });

  const githubLogin = user?.githubLogin ?? (user ? await recoverGitHubLogin(user.id) : null);
  const shouldPromote = user && user.globalRole !== "ADMIN" && isConfiguredAdmin(githubLogin);
  const shouldPersistLogin = user && !user.githubLogin && githubLogin;

  if (shouldPromote || shouldPersistLogin) {
    return db.user.update({
      where: { id: user.id },
      data: {
        ...(shouldPersistLogin ? { githubLogin } : {}),
        ...(shouldPromote ? { globalRole: "ADMIN" } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        githubLogin: true,
        globalRole: true,
        status: true,
      },
    });
  }

  return user;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new AccessDeniedError("Autenticação necessária", 401);
  if (user.status !== "ACTIVE") throw new AccessDeniedError("Usuário suspenso", 403);
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.globalRole !== "ADMIN") throw new AccessDeniedError();
  return user;
}

export async function getProjectRole(user, projectId) {
  if (user.globalRole === "ADMIN") return "MANAGER";

  const membership = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: user.id } },
    select: { role: true },
  });

  return membership?.role ?? null;
}

export async function requireProjectRole(projectId, requiredRole = "VIEWER") {
  const user = await requireUser();
  const role = await getProjectRole(user, projectId);

  if (!role || !isAtLeastProjectRole(role, requiredRole)) {
    throw new AccessDeniedError();
  }

  return { user, role };
}
