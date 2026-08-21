import { z } from "zod";

const emptyStringToUndefined = (value) => (
  typeof value === "string" && value.trim() === "" ? undefined : value
);
const optionalText = z.preprocess(emptyStringToUndefined, z.string().trim().min(1).optional());
const optionalUrl = z.preprocess(emptyStringToUndefined, z.string().url().optional());
const booleanText = z.preprocess((value) => {
  if (value === undefined || typeof value === "boolean") return value;
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off", ""].includes(normalized)) return false;
  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: optionalText,
  GITHUB_ID: optionalText,
  GITHUB_SECRET: optionalText,
  GITHUB_APP_ID: optionalText,
  GITHUB_APP_PRIVATE_KEY: optionalText,
  GITHUB_APP_SLUG: optionalText,
  GITHUB_WEBHOOK_SECRET: optionalText,
  ADMIN_GITHUB_LOGIN: optionalText,
  BETA_ALLOWED_GITHUB_LOGINS: optionalText,
  NEXTAUTH_SECRET: optionalText,
  NEXTAUTH_URL: optionalUrl,
  TOKEN_ENCRYPTION_KEY: optionalText,
  PUBLIC_EXECUTIONS_ENABLED: booleanText.default(false),
  EXECUTION_ISOLATION_MODE: z.enum(["trusted-worker", "isolated-container"]).default("trusted-worker"),
  OPENAI_API_KEY: optionalText,
  OPENAI_MODEL: optionalText,
  SUPPORT_AI_MODEL: z.string().trim().min(1).default("gpt-5.6-luna"),
  ASAAS_API_KEY: optionalText,
  ASAAS_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  ASAAS_WEBHOOK_TOKEN: z.preprocess(emptyStringToUndefined, z.string().trim().min(32).max(255).optional()),
  BILLING_CONTACT_URL: optionalUrl,
  RAILWAY_API_TOKEN: optionalText,
  RAILWAY_SERVICE_ID: optionalText,
  RAILWAY_ENVIRONMENT_ID: optionalText,
  PREVIEW_HOST_URL: optionalUrl,
  PREVIEW_HOST_TOKEN: z.preprocess(emptyStringToUndefined, z.string().trim().min(32).optional()),
  PREVIEW_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  BUCKET_ENDPOINT: optionalUrl,
  BUCKET_NAME: optionalText,
  BUCKET_ACCESS_KEY_ID: optionalText,
  BUCKET_SECRET_ACCESS_KEY: optionalText,
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).max(60000).default(5000),
  HEALTH_CHECK_INTERVAL_MS: z.coerce.number().int().min(60000).max(3600000).default(300000),
  HEALTH_CHECK_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(10000).max(300000).default(30000),
  RAILWAY_GIT_COMMIT_SHA: optionalText,
});

export const env = envSchema.parse(process.env);

export function tokenEncryptionKeyIsValid(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  try {
    return Buffer.from(value, "base64url").length === 32;
  } catch {
    return false;
  }
}

function required(errors, configuration, key) {
  if (!configuration[key]) errors.push(`${key} é obrigatória`);
}

export function runtimeSecurityConfigurationErrors(service = "web", configuration = env) {
  const errors = [];

  required(errors, configuration, "DATABASE_URL");
  if (!tokenEncryptionKeyIsValid(configuration.TOKEN_ENCRYPTION_KEY)) {
    errors.push("TOKEN_ENCRYPTION_KEY deve ser uma chave base64url de 32 bytes");
  }

  if (configuration.PUBLIC_EXECUTIONS_ENABLED && configuration.EXECUTION_ISOLATION_MODE !== "isolated-container") {
    errors.push("PUBLIC_EXECUTIONS_ENABLED exige EXECUTION_ISOLATION_MODE=isolated-container");
  }

  if (service === "web") {
    required(errors, configuration, "GITHUB_ID");
    required(errors, configuration, "GITHUB_SECRET");
    required(errors, configuration, "ADMIN_GITHUB_LOGIN");

    if (typeof configuration.NEXTAUTH_SECRET !== "string" || configuration.NEXTAUTH_SECRET.length < 32) {
      errors.push("NEXTAUTH_SECRET deve possuir ao menos 32 caracteres");
    }

    try {
      const nextAuthUrl = new URL(configuration.NEXTAUTH_URL);
      if (nextAuthUrl.protocol !== "https:") errors.push("NEXTAUTH_URL deve usar HTTPS em produção");
    } catch {
      errors.push("NEXTAUTH_URL deve ser uma URL HTTPS válida");
    }

    const githubAppValues = [
      configuration.GITHUB_APP_ID,
      configuration.GITHUB_APP_PRIVATE_KEY,
      configuration.GITHUB_APP_SLUG,
    ];
    if (githubAppValues.some(Boolean) && !githubAppValues.every(Boolean)) {
      errors.push("GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY e GITHUB_APP_SLUG devem ser configuradas em conjunto");
    }
  } else if (service === "worker") {
    required(errors, configuration, "OPENAI_API_KEY");
  } else {
    errors.push(`Serviço de runtime desconhecido: ${service}`);
  }

  return errors;
}

export function assertSecureRuntimeConfiguration(service = "web", configuration = env) {
  const errors = runtimeSecurityConfigurationErrors(service, configuration);
  if (!errors.length) return configuration;
  throw new Error(`Configuração insegura para ${service}:\n- ${errors.join("\n- ")}`);
}

export function getConfigurationStatus() {
  return {
    database: Boolean(env.DATABASE_URL),
    githubAuth: Boolean(env.GITHUB_ID && env.GITHUB_SECRET && env.NEXTAUTH_SECRET),
    tokenEncryption: Boolean(env.TOKEN_ENCRYPTION_KEY),
    githubApp: Boolean(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY && env.GITHUB_APP_SLUG),
    githubWebhook: Boolean(env.GITHUB_WEBHOOK_SECRET && env.NEXTAUTH_URL),
    openai: Boolean(env.OPENAI_API_KEY),
    railway: Boolean(env.RAILWAY_API_TOKEN),
    previewHost: Boolean(env.PREVIEW_HOST_URL && env.PREVIEW_HOST_TOKEN),
    visualStorage: Boolean(env.BUCKET_ENDPOINT && env.BUCKET_NAME && env.BUCKET_ACCESS_KEY_ID && env.BUCKET_SECRET_ACCESS_KEY),
    worker: Boolean(env.DATABASE_URL && env.OPENAI_API_KEY),
    asaas: Boolean(env.ASAAS_API_KEY && env.ASAAS_WEBHOOK_TOKEN && env.NEXTAUTH_URL),
  };
}
