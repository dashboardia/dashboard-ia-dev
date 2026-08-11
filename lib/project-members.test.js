import { describe, expect, it } from "vitest";

import { assertProjectMemberMutationAllowed } from "./project-members";

describe("assertProjectMemberMutationAllowed", () => {
  it("protege o último Gestor do projeto", () => {
    expect(() => assertProjectMemberMutationAllowed({ targetRole: "MANAGER", nextRole: "VIEWER", managerCount: 1 })).toThrow("ao menos um Gestor");
    expect(() => assertProjectMemberMutationAllowed({ targetRole: "MANAGER", deleting: true, managerCount: 1 })).toThrow("ao menos um Gestor");
  });

  it("permite alterar membros sem deixar o projeto sem Gestor", () => {
    expect(() => assertProjectMemberMutationAllowed({ targetRole: "MANAGER", nextRole: "DEVELOPER", managerCount: 2 })).not.toThrow();
    expect(() => assertProjectMemberMutationAllowed({ targetRole: "VIEWER", nextRole: "DEVELOPER", managerCount: 1 })).not.toThrow();
  });
});
