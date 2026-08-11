import { AccessDeniedError } from "./access";

export function assertProjectMemberMutationAllowed({ targetRole, nextRole, deleting = false, managerCount }) {
  const removesManager = targetRole === "MANAGER" && (deleting || nextRole !== "MANAGER");
  if (removesManager && managerCount <= 1) {
    throw new AccessDeniedError("O projeto precisa manter ao menos um Gestor", 409);
  }
}
