export const SUPPORT_CONVERSATION_TIMEOUT_MS = 24 * 60 * 60 * 1_000;

export function supportConversationDeadline(now = new Date()) {
  return new Date(now.getTime() + SUPPORT_CONVERSATION_TIMEOUT_MS);
}

export function supportMessageToClient(message) {
  const metadata = message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata)
    ? message.metadata
    : {};
  return {
    id: message.id,
    role: String(message.role).toLowerCase(),
    content: message.content,
    createdAt: new Date(message.createdAt).toISOString(),
    demandReference: metadata.demandReference ?? null,
    links: Array.isArray(metadata.links) ? metadata.links : [],
    projects: Array.isArray(metadata.projects) ? metadata.projects : [],
    attachments: (message.attachments ?? []).map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      previewUrl: `/api/support/chat/attachments/${encodeURIComponent(attachment.id)}`,
    })),
  };
}
