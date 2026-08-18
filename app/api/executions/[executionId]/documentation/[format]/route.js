import { NextResponse } from "next/server";

import { AccessDeniedError, getProjectRole, requireUser } from "../../../../../../lib/access";
import { apiError } from "../../../../../../lib/api";
import { documentationResponseMetadata, generateBusinessDocx, generateBusinessPdf } from "../../../../../../lib/business-document";
import { db } from "../../../../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request, context) {
  try {
    const user = await requireUser();
    const { executionId, format } = await context.params;
    if (!documentationResponseMetadata(format, "documentacao-de-negocio")) {
      return NextResponse.json({ error: "Formato de documentação inválido" }, { status: 404 });
    }

    const execution = await db.execution.findUnique({
      where: { id: executionId },
      select: {
        summary: true,
        finishedAt: true,
        demand: { select: { title: true, type: true, projectId: true, project: { select: { name: true, repositoryFullName: true } } } },
      },
    });
    if (!execution || execution.demand.type !== "DOCUMENTATION" || !execution.summary) {
      return NextResponse.json({ error: "Documentação de negócio não encontrada" }, { status: 404 });
    }
    if (!await getProjectRole(user, execution.demand.projectId)) throw new AccessDeniedError();

    const metadata = documentationResponseMetadata(format, execution.demand.title);
    const input = {
      title: execution.demand.title,
      projectName: execution.demand.project.name,
      repository: execution.demand.project.repositoryFullName,
      generatedAt: execution.finishedAt ?? new Date(),
      content: execution.summary,
    };
    const output = format === "docx" ? await generateBusinessDocx(input) : await generateBusinessPdf(input);
    return new NextResponse(new Uint8Array(output), {
      headers: {
        "Content-Type": metadata.contentType,
        "Content-Disposition": metadata.contentDisposition,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
