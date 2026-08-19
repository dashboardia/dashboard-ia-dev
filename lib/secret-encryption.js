import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { env } from "./env.js";

const ENCRYPTED_PREFIX = "enc:v1:";
const TOKEN_FIELDS = ["access_token", "refresh_token", "id_token"];

function decodeEncryptionKey(encodedKey) {
  if (!encodedKey) return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(encodedKey)) {
    throw new Error("TOKEN_ENCRYPTION_KEY deve ser uma chave base64url de 32 bytes");
  }

  const key = Buffer.from(encodedKey, "base64url");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY deve possuir exatamente 32 bytes");
  }
  return key;
}

export function createSecretCipher(encodedKey) {
  const key = decodeEncryptionKey(encodedKey);

  function isEncrypted(value) {
    return typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX);
  }

  function encrypt(value, purpose) {
    if (!value || !key || isEncrypted(value)) return value;

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(purpose, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const authenticationTag = cipher.getAuthTag();

    return `${ENCRYPTED_PREFIX}${iv.toString("base64url")}.${authenticationTag.toString("base64url")}.${ciphertext.toString("base64url")}`;
  }

  function decrypt(value, purpose) {
    if (!value || !isEncrypted(value)) return value;
    if (!key) {
      throw new Error("TOKEN_ENCRYPTION_KEY não está configurada para ler o token OAuth");
    }

    try {
      const [ivValue, tagValue, ciphertextValue, extra] = value.slice(ENCRYPTED_PREFIX.length).split(".");
      if (!ivValue || !tagValue || !ciphertextValue || extra) throw new Error("formato inválido");

      const iv = Buffer.from(ivValue, "base64url");
      const authenticationTag = Buffer.from(tagValue, "base64url");
      const ciphertext = Buffer.from(ciphertextValue, "base64url");
      if (iv.length !== 12 || authenticationTag.length !== 16 || ciphertext.length === 0) {
        throw new Error("formato inválido");
      }

      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(Buffer.from(purpose, "utf8"));
      decipher.setAuthTag(authenticationTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
      throw new Error("Token OAuth criptografado não pôde ser autenticado");
    }
  }

  return {
    configured: Boolean(key),
    decrypt,
    encrypt,
    isEncrypted,
  };
}

export function protectGitHubOAuthTokens(account, cipher) {
  return TOKEN_FIELDS.reduce((protectedFields, field) => {
    if (typeof account?.[field] === "string" && account[field]) {
      protectedFields[field] = cipher.encrypt(account[field], `github:${field}`);
    }
    return protectedFields;
  }, {});
}

export const oauthTokenCipher = createSecretCipher(env.TOKEN_ENCRYPTION_KEY);
