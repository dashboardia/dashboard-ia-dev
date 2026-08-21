import { describe, expect, it } from "vitest";

import { redactSensitiveData } from "./redaction";

describe("sensitive data redaction", () => {
  it("remove tokens conhecidos e cabeçalhos de autorização", () => {
    expect(redactSensitiveData("Authorization: Bearer abc123 segredo-local", ["segredo-local"]))
      .toBe("Authorization: Bearer [REDACTED] [REDACTED]");
  });

  it("remove senha de URLs de banco e parâmetros sensíveis", () => {
    const value = "DATABASE_URL=postgresql://usuario:senha@database:5432/app?token=abc";
    expect(redactSensitiveData(value)).toBe("DATABASE_URL=postgresql://usuario:[REDACTED]@database:5432/app?token=[REDACTED]");
  });

  it("remove chaves privadas completas", () => {
    const value = "-----BEGIN PRIVATE KEY-----\nconteudo\n-----END PRIVATE KEY-----";
    expect(redactSensitiveData(value)).toBe("[REDACTED PRIVATE KEY]");
  });
});
