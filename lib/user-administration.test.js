import { describe, expect, it } from "vitest";

import { assertUserAdministrationAllowed, assertUserDeletionAllowed } from "./user-administration";

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

describe("assertUserDeletionAllowed", () => {
  it("impede excluir a própria conta", () => {
    expect(() => assertUserDeletionAllowed({ actorId: admin.id, target: { ...admin, email: "admin@example.com" }, activeAdminCount: 2, confirmation: "admin@example.com" })).toThrow("própria conta");
  });

  it("exige confirmação literal e permite excluir outro usuário", () => {
    const target = { id: "user-1", email: "cliente@example.com", githubLogin: "cliente", globalRole: "USER", status: "ACTIVE" };
    expect(() => assertUserDeletionAllowed({ actorId: admin.id, target, activeAdminCount: 1, confirmation: "errado" })).toThrow("confirmação");
    expect(() => assertUserDeletionAllowed({ actorId: admin.id, target, activeAdminCount: 1, confirmation: "cliente@example.com" })).not.toThrow();
  });
});
