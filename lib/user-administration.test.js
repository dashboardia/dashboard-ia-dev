import { describe, expect, it } from "vitest";

import { assertUserAdministrationAllowed } from "./user-administration";

const admin = { id: "admin-1", globalRole: "ADMIN", status: "ACTIVE" };

describe("assertUserAdministrationAllowed", () => {
  it("impede auto-suspensao e auto-rebaixamento", () => {
    expect(() => assertUserAdministrationAllowed({ actorId: admin.id, target: admin, nextGlobalRole: "ADMIN", nextStatus: "SUSPENDED", activeAdminCount: 2 })).toThrow("própria conta");
    expect(() => assertUserAdministrationAllowed({ actorId: admin.id, target: admin, nextGlobalRole: "USER", nextStatus: "ACTIVE", activeAdminCount: 2 })).toThrow("próprio acesso");
  });

  it("protege o ultimo administrador ativo", () => {
    expect(() => assertUserAdministrationAllowed({ actorId: "admin-2", target: admin, nextGlobalRole: "USER", nextStatus: "ACTIVE", activeAdminCount: 1 })).toThrow("ao menos um administrador");
  });

  it("permite administrar outro usuario quando resta um admin ativo", () => {
    expect(() => assertUserAdministrationAllowed({ actorId: "admin-2", target: admin, nextGlobalRole: "USER", nextStatus: "ACTIVE", activeAdminCount: 2 })).not.toThrow();
  });
});
