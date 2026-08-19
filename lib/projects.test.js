import { describe, expect, it } from "vitest";

import { projectConnectionMode } from "./projects";

const user = { id: "user-1" };

describe("projectConnectionMode", () => {
  it("cria quando o repositório nunca foi conectado", () => {
    expect(projectConnectionMode(null, user)).toBe("CREATE");
  });

  it("restaura um repositório arquivado pelo mesmo proprietário", () => {
    expect(projectConnectionMode({ createdById: user.id, status: "ARCHIVED" }, user)).toBe("RESTORE");
  });

  it("bloqueia duplicação de projeto ativo", () => {
    expect(() => projectConnectionMode({ createdById: user.id, status: "ACTIVE" }, user)).toThrowError("Este repositório já está conectado.");
  });

  it("não permite assumir repositório de outra conta", () => {
    expect(() => projectConnectionMode({ createdById: "user-2", status: "ARCHIVED" }, user)).toThrowError("Este repositório já está vinculado a outra conta.");
  });
});
