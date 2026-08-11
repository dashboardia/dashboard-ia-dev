export function auditData({ actorId, projectId, action, entityType, entityId, metadata, request }) {
  const forwardedFor = request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  return {
    actorId,
    projectId,
    action,
    entityType,
    entityId,
    metadata,
    ip: forwardedFor ?? null,
    userAgent: request?.headers.get("user-agent") ?? null,
  };
}
