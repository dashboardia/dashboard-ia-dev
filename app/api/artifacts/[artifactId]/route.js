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
    if (!artifact) return NextResponse.json({ error: "Evidência não encontrada" }, { status: 404 });
    if (!await getProjectRole(user, artifact.execution.demand.projectId)) throw new AccessDeniedError();
    if (artifact.content != null) {
      const contentType = artifact.name.endsWith(".xml") ? "application/xml" : artifact.name.endsWith(".json") ? "application/json" : "text/plain; charset=utf-8";
      return new NextResponse(artifact.content, { headers: { "Content-Type": contentType, "Content-Disposition": `attachment; filename="${artifact.name.replaceAll('"', '')}"`, "Cache-Control": "private, max-age=60" } });
    }
    if (artifact.type !== "visual" || !artifact.url) return NextResponse.json({ error: "Evidência indisponível" }, { status: 404 });
    const object = await getVisualEvidence(artifact.url);
    return new NextResponse(object.Body.transformToWebStream(), { headers: { "Content-Type": object.ContentType ?? "image/png", "Cache-Control": "private, max-age=300" } });
  } catch (error) {
    return apiError(error);
  }
}
