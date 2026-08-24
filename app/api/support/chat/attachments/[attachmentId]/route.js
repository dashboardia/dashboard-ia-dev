import { NextResponse } from "next/server";

import { requireUser } from "../../../../../../lib/access";
import { apiError } from "../../../../../../lib/api";
import { db } from "../../../../../../lib/db";
import { getPrivateObject } from "../../../../../../lib/visual-storage";

export async function GET(_request, context) {
  try {
    const user = await requireUser();
    const { attachmentId } = await context.params;
    const attachment = await db.supportMessageAttachment.findFirst({
      where: { id: attachmentId, message: { conversation: { userId: user.id } } },
    });
    if (!attachment) return NextResponse.json({ error: "Anexo não encontrado" }, { status: 404 });
    const object = await getPrivateObject(attachment.storageKey);
    const inline = attachment.mimeType.startsWith("image/");
    return new NextResponse(object.Body.transformToWebStream(), {
      headers: {
        "Content-Type": object.ContentType ?? attachment.mimeType,
        "Content-Length": String(attachment.sizeBytes),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${attachment.name.replaceAll('"', "")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
