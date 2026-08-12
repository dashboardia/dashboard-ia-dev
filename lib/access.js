import { getServerSession } from "next-auth";

import { authOptions } from "./auth";
import { db } from "./db";
import { env } from "./env";

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

  if (user && user.globalRole !== "ADMIN" && isConfiguredAdmin(user.githubLogin)) {
    return db.user.update({
      where: { id: user.id },
      data: { globalRole: "ADMIN" },
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
