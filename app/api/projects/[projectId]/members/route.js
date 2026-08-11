import { NextResponse } from "next/server";

import { requireProjectRole } from "../../../../../lib/access";
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
      select: { id: true },
    });

    if (!target) return NextResponse.json({ error: "O usuário precisa entrar uma vez antes de ser adicionado" }, { status: 404 });

    const member = await db.projectMember.upsert({
      where: { projectId_userId: { projectId, userId: target.id } },
      create: { projectId, userId: target.id, role: input.role },
      update: { role: input.role },
      include: { user: { select: { id: true, name: true, email: true, image: true, githubLogin: true } } },
    });
    await db.auditLog.create({
      data: auditData({ actorId: user.id, projectId, action: "project.member.upsert", entityType: "ProjectMember", entityId: member.id, metadata: { targetUserId: target.id, role: input.role }, request }),
    });
    return NextResponse.json({ member }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
