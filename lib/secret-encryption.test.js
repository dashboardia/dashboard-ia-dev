import { describe, expect, it } from "vitest";

import { createSecretCipher, protectGitHubOAuthTokens } from "./secret-encryption";

const encryptionKey = Buffer.alloc(32, 7).toString("base64url");

describe("secret encryption", () => {
  it("criptografa e descriptografa um segredo com AES-256-GCM", () => {
    const cipher = createSecretCipher(encryptionKey);
    const encrypted = cipher.encrypt("github-token", "github:access_token");

    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain("github-token");
    expect(cipher.decrypt(encrypted, "github:access_token")).toBe("github-token");
  });

  it("produz textos cifrados diferentes para o mesmo segredo", () => {
    const cipher = createSecretCipher(encryptionKey);

    expect(cipher.encrypt("github-token", "github:access_token"))
      .not.toBe(cipher.encrypt("github-token", "github:access_token"));
  });

  it("rejeita adulteração e troca de finalidade", () => {
    const cipher = createSecretCipher(encryptionKey);
    const encrypted = cipher.encrypt("github-token", "github:access_token");
    const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith("A") ? "B" : "A"}`;

    expect(() => cipher.decrypt(tampered, "github:access_token")).toThrow(/autenticado/);
    expect(() => cipher.decrypt(encrypted, "github:refresh_token")).toThrow(/autenticado/);
  });

  it("mantém compatibilidade com tokens legados enquanto a chave não está ativa", () => {
    const cipher = createSecretCipher(undefined);

    expect(cipher.configured).toBe(false);
    expect(cipher.encrypt("legacy-token", "github:access_token")).toBe("legacy-token");
    expect(cipher.decrypt("legacy-token", "github:access_token")).toBe("legacy-token");
  });

  it("protege todos os campos sensíveis retornados pelo GitHub", () => {
    const cipher = createSecretCipher(encryptionKey);
    const result = protectGitHubOAuthTokens({
      access_token: "access",
      refresh_token: "refresh",
      id_token: "identity",
      token_type: "bearer",
    }, cipher);

    expect(Object.keys(result)).toEqual(["access_token", "refresh_token", "id_token"]);
    expect(cipher.decrypt(result.access_token, "github:access_token")).toBe("access");
    expect(result).not.toHaveProperty("token_type");
  });
});
