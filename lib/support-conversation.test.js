import { describe, expect, it } from "vitest";

import { SUPPORT_CONVERSATION_TIMEOUT_MS, supportConversationDeadline, supportMessageToClient } from "./support-conversation";

describe("support conversation", () => {
  it("expira após 24 horas de inatividade", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    expect(supportConversationDeadline(now).getTime() - now.getTime()).toBe(SUPPORT_CONVERSATION_TIMEOUT_MS);
  });

  it("serializa mensagens e anexos persistidos para o cliente", () => {
    expect(supportMessageToClient({
      id: "message-1",
      role: "USER",
      content: "Veja este print",
      createdAt: new Date("2026-08-24T12:00:00.000Z"),
      metadata: null,
      attachments: [{ id: "attachment-1", name: "erro.png", mimeType: "image/png", sizeBytes: 512 }],
    })).toMatchObject({
      id: "message-1",
      role: "user",
      content: "Veja este print",
      attachments: [{ previewUrl: "/api/support/chat/attachments/attachment-1" }],
    });
  });
});
