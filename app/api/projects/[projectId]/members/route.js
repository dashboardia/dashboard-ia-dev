import { NextResponse } from "next/server";

import { AccessDeniedError, requireProjectRole } from "../../../../../lib/access";
import { apiError, assertSameOrigin } from "../../../../../lib/api";
import { auditData } from "../../../../../lib/audit";
import { db } from "../../../../../lib/db";
import { projectMemberInputSchema } from "../../../../../lib/validation";

export const dynamic = "force-dynamic";

export async function GET(_request, context) {
  try {
    const { projectId } = await context.params;
    await requireProjectRole(projectId, "VIEWER");
    const members = await db.projectMember.findMany({
      where: { projectId },
      include: { user: { select: { id: true, name: true, email: true, image: true, githubLogin: true, status: true } } },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ members });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request, context) {
  try {
    assertSameOrigin(request);
    const { projectId } = await context.params;
    const { user } = await requireProjectRole(projectId, "MANAGER");
    const input = projectMemberInputSchema.parse(await request.json());
    const target = await db.user.findFirst({
      where: input.userId
        ? { id: input.userId }
        : input.email
          ? { email: input.email.toLowerCase() }
          : { githubLogin: { equals: input.githubLogin, mode: "insensitive" } },
      select: { id: true, status: true },
    });

    if (!target) return NextResponse.json({ error: "O usuário precisa entrar uma vez antes de ser adicionado" }, { status: 404 });
    if (target.status !== "ACTIVE") return NextResponse.json({ error: "Usuários suspensos não podem ser adicionados" }, { status: 409 });

    const member = await db.$transaction(async (transaction) => {
      const existing = await transaction.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: target.id } }, select: { id: true } });
      if (existing) throw new AccessDeniedError("Este usuário já faz parte do projeto", 409);
      const created = await transaction.projectMember.create({
        data: { projectId, userId: target.id, role: input.role },
        include: { user: { select: { id: true, name: true, email: true, image: true, githubLogin: true } } },
      });
      await transaction.auditLog.create({
        data: auditData({ actorId: user.id, projectId, action: "project.member.add", entityType: "ProjectMember", entityId: created.id, metadata: { targetUserId: target.id, role: input.role }, request }),
      });
      return created;
    });
    return NextResponse.json({ member }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
