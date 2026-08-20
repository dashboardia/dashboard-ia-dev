import { z } from "zod";

const optionalText = z.string().trim().min(1).optional();
const optionalUrl = z.string().url().optional();

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
  NEXTAUTH_SECRET: optionalText,
  NEXTAUTH_URL: optionalUrl,
  TOKEN_ENCRYPTION_KEY: optionalText,
  OPENAI_API_KEY: optionalText,
  OPENAI_MODEL: optionalText,
  SUPPORT_AI_MODEL: z.string().trim().min(1).default("gpt-5.6-luna"),
  ASAAS_API_KEY: optionalText,
  ASAAS_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  ASAAS_WEBHOOK_TOKEN: z.string().trim().min(32).max(255).optional(),
  BILLING_CONTACT_URL: optionalUrl,
  RAILWAY_API_TOKEN: optionalText,
  RAILWAY_SERVICE_ID: optionalText,
  RAILWAY_ENVIRONMENT_ID: optionalText,
  PREVIEW_HOST_URL: optionalUrl,
  PREVIEW_HOST_TOKEN: z.string().trim().min(32).optional(),
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
