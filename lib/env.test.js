import { describe, expect, it } from "vitest";

import { runtimeSecurityConfigurationErrors, tokenEncryptionKeyIsValid } from "./env";

const encryptionKey = Buffer.alloc(32, 9).toString("base64url");

const secureWebConfiguration = {
  DATABASE_URL: "postgresql://database/internal",
  GITHUB_ID: "github-client-id",
  GITHUB_SECRET: "github-client-secret",
  ADMIN_GITHUB_LOGIN: "dashboardia",
  NEXTAUTH_SECRET: "n".repeat(48),
  NEXTAUTH_URL: "https://dashboardia.app",
  TOKEN_ENCRYPTION_KEY: encryptionKey,
  PUBLIC_EXECUTIONS_ENABLED: false,
  EXECUTION_ISOLATION_MODE: "trusted-worker",
};

describe("runtime security configuration", () => {
  it("aceita uma chave de criptografia base64url de 32 bytes", () => {
    expect(tokenEncryptionKeyIsValid(encryptionKey)).toBe(true);
    expect(tokenEncryptionKeyIsValid("insegura")).toBe(false);
  });

  it("aceita a configuração segura do serviço web", () => {
    expect(runtimeSecurityConfigurationErrors("web", secureWebConfiguration)).toEqual([]);
  });

  it("exige HTTPS e segredos fortes no serviço web", () => {
    const errors = runtimeSecurityConfigurationErrors("web", {
      ...secureWebConfiguration,
      NEXTAUTH_URL: "http://dashboardia.app",
      NEXTAUTH_SECRET: "curta",
      TOKEN_ENCRYPTION_KEY: undefined,
    });

    expect(errors).toContain("NEXTAUTH_URL deve usar HTTPS em produção");
    expect(errors).toContain("NEXTAUTH_SECRET deve possuir ao menos 32 caracteres");
    expect(errors).toContain("TOKEN_ENCRYPTION_KEY deve ser uma chave base64url de 32 bytes");
  });

  it("não aceita execução pública no worker confiável", () => {
    expect(runtimeSecurityConfigurationErrors("web", {
      ...secureWebConfiguration,
      PUBLIC_EXECUTIONS_ENABLED: true,
    })).toContain("PUBLIC_EXECUTIONS_ENABLED exige EXECUTION_ISOLATION_MODE=isolated-container");
  });

  it("exige banco, OpenAI e criptografia no worker", () => {
    expect(runtimeSecurityConfigurationErrors("worker", {
      DATABASE_URL: secureWebConfiguration.DATABASE_URL,
      OPENAI_API_KEY: "openai-key",
      TOKEN_ENCRYPTION_KEY: encryptionKey,
      PUBLIC_EXECUTIONS_ENABLED: false,
      EXECUTION_ISOLATION_MODE: "trusted-worker",
    })).toEqual([]);

    expect(runtimeSecurityConfigurationErrors("worker", {
      PUBLIC_EXECUTIONS_ENABLED: false,
      EXECUTION_ISOLATION_MODE: "trusted-worker",
    })).toEqual(expect.arrayContaining([
      "DATABASE_URL é obrigatória",
      "OPENAI_API_KEY é obrigatória",
      "TOKEN_ENCRYPTION_KEY deve ser uma chave base64url de 32 bytes",
    ]));
  });
});
