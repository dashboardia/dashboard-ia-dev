const actionLabels = {
  "auth.sign_in": "Login realizado",
  "user.update_access": "Acesso de usuário alterado",
  "project.create": "Projeto conectado",
  "project.update": "Projeto atualizado",
  "project.member.add": "Membro adicionado",
  "project.member.update": "Papel de membro alterado",
  "project.member.remove": "Membro removido",
  "demand.create": "Demanda criada",
  "demand.update": "Demanda atualizada",
  "demand.approve": "Demanda aprovada",
  "execution.queue": "Execução iniciada",
  "execution.cancel": "Execução cancelada",
  "pull_request.create": "Pull Request criado",
  "pull_request.sync": "Pull Request sincronizado",
};

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

export function auditActionLabel(action) {
  return actionLabels[action] ?? action;
}

export function auditEntityHref(entityType, entityId) {
  if (!entityId) return null;
  if (entityType === "Project") return `/projects/${entityId}`;
  if (entityType === "Demand") return `/demands/${entityId}`;
  if (entityType === "Execution") return `/executions/${entityId}`;
  return null;
}
