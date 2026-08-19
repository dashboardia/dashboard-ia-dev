import { db } from "./db";
import { BillingAccessError } from "./billing";
import { toSlug } from "./slug";

export function projectAccessWhere(user) {
  if (user.globalRole === "ADMIN") return {};
  return { members: { some: { userId: user.id } } };
}

export async function createUniqueProjectSlug(name, client = db) {
  const base = toSlug(name) || "projeto";

  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base.slice(0, 60)}-${suffix + 1}`;
    const existing = await client.project.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing) return candidate;
  }

  return `${base.slice(0, 48)}-${Date.now().toString(36)}`;
}

export function projectConnectionMode(existingProject, user) {
  if (!existingProject) return "CREATE";
  if (existingProject.createdById !== user.id) {
    throw new BillingAccessError(
      "Este repositório já está vinculado a outra conta.",
      409,
      "PROJECT_OWNERSHIP_CONFLICT",
    );
  }
  if (existingProject.status === "ARCHIVED") return "RESTORE";
  throw new BillingAccessError(
    "Este repositório já está conectado.",
    409,
    "PROJECT_ALREADY_CONNECTED",
  );
}
