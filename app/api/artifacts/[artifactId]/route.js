import { NextResponse } from "next/server";

import { AccessDeniedError, getProjectRole, requireUser } from "../../../../lib/access";
import { apiError } from "../../../../lib/api";
import { db } from "../../../../lib/db";
import { getVisualEvidence } from "../../../../lib/visual-storage";

export async function GET(_request, context) {
  try {
    const user = await requireUser();
    const { artifactId } = await context.params;
    const artifact = await db.executionArtifact.findUnique({ where: { id: artifactId }, include: { execution: { include: { demand: { select: { projectId: true } } } } } });
    if (!artifact || artifact.type !== "visual" || !artifact.url) return NextResponse.json({ error: "Evidência não encontrada" }, { status: 404 });
    if (!await getProjectRole(user, artifact.execution.demand.projectId)) throw new AccessDeniedError();
    const object = await getVisualEvidence(artifact.url);
    return new NextResponse(object.Body.transformToWebStream(), { headers: { "Content-Type": object.ContentType ?? "image/png", "Cache-Control": "private, max-age=300" } });
  } catch (error) {
    return apiError(error);
  }
}
