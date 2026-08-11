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
