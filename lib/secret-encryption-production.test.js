import { describe, expect, it } from "vitest";

import { createSecretCipher } from "./secret-encryption";

describe("secret encryption fail closed", () => {
  it("recusa salvar token em texto puro quando o runtime exige criptografia", () => {
    const cipher = createSecretCipher(undefined, { allowPlaintext: false });
    expect(() => cipher.encrypt("github-token", "github:access_token"))
      .toThrow(/não será salvo sem criptografia/);
  });
});
