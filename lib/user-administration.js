import { AccessDeniedError } from "./access";

export function assertUserAdministrationAllowed({ actorId, target, nextGlobalRole, nextStatus, activeAdminCount }) {
  const removesAdminAccess = target.globalRole === "ADMIN" && (nextGlobalRole !== "ADMIN" || nextStatus !== "ACTIVE");

  if (actorId === target.id && nextStatus === "SUSPENDED") {
    throw new AccessDeniedError("Você não pode suspender sua própria conta", 409);
  }

  if (actorId === target.id && nextGlobalRole !== "ADMIN") {
    throw new AccessDeniedError("Você não pode remover seu próprio acesso administrativo", 409);
  }

  if (removesAdminAccess && activeAdminCount <= 1) {
    throw new AccessDeniedError("O sistema precisa manter ao menos um administrador ativo", 409);
  }
}

export function assertUserDeletionAllowed({ actorId, target, activeAdminCount, confirmation }) {
  if (actorId === target.id) {
    throw new AccessDeniedError("Você não pode excluir sua própria conta", 409);
  }
  if (target.globalRole === "ADMIN" && target.status === "ACTIVE" && activeAdminCount <= 1) {
    throw new AccessDeniedError("O sistema precisa manter ao menos um administrador ativo", 409);
  }
  const accepted = [target.email, target.githubLogin, target.id].filter(Boolean);
  if (!accepted.includes(String(confirmation ?? "").trim())) {
    throw new AccessDeniedError("A confirmação não corresponde ao e-mail ou login do usuário", 422);
  }
}
