import { NextResponse } from "next/server";

import { AccessDeniedError, getProjectRole, requireUser } from "../../../../lib/access";
import { apiError } from "../../../../lib/api";
import { db } from "../../../../lib/db";
import { getPrivateObject } from "../../../../lib/visual-storage";

export async function GET(_request, context) {
  try {
    const user = await requireUser();
    const { attachmentId } = await context.params;
    const attachment = await db.executionMessageAttachment.findUnique({
      where: { id: attachmentId },
      include: { message: { include: { execution: { include: { demand: { select: { projectId: true } } } } } } },
    });
    if (!attachment) return NextResponse.json({ error: "Anexo não encontrado" }, { status: 404 });
    if (!await getProjectRole(user, attachment.message.execution.demand.projectId)) throw new AccessDeniedError();
    const object = await getPrivateObject(attachment.storageKey);
    const inline = attachment.mimeType.startsWith("image/");
    const disposition = `${inline ? "inline" : "attachment"}; filename="${attachment.name.replaceAll('"', "")}"`;
    return new NextResponse(object.Body.transformToWebStream(), {
      headers: {
        "Content-Type": object.ContentType ?? attachment.mimeType,
        "Content-Length": String(attachment.sizeBytes),
        "Content-Disposition": disposition,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
