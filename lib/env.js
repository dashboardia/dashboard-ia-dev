import { z } from "zod";

const optionalText = z.string().trim().min(1).optional();
const optionalUrl = z.string().url().optional();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: optionalText,
  GITHUB_ID: optionalText,
  GITHUB_SECRET: optionalText,
  GITHUB_WEBHOOK_SECRET: optionalText,
  ADMIN_GITHUB_LOGIN: optionalText,
  NEXTAUTH_SECRET: optionalText,
  NEXTAUTH_URL: optionalUrl,
  OPENAI_API_KEY: optionalText,
  OPENAI_MODEL: optionalText,
  RAILWAY_API_TOKEN: optionalText,
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
    githubWebhook: Boolean(env.GITHUB_WEBHOOK_SECRET && env.NEXTAUTH_URL),
    openai: Boolean(env.OPENAI_API_KEY),
    railway: Boolean(env.RAILWAY_API_TOKEN),
    worker: Boolean(env.DATABASE_URL && env.OPENAI_API_KEY),
  };
}
