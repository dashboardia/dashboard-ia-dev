import { db } from "./db";
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
