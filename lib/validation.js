import { z } from "zod";

import { AI_MODEL_VALUES, DEFAULT_AI_MODEL } from "./ai-models";
import {
  MAX_NODE_MEMORY_MB,
  MAX_PARALLEL_EXECUTIONS,
} from "./execution-limits";

const optionalUrl = z
  .union([z.string().url("Informe uma URL válida"), z.literal("")])
  .optional()
  .transform((value) => value || undefined);

const optionalCommand = z
  .union([z.string().trim().min(1).max(500), z.literal("")])
  .optional()
  .transform((value) => value || undefined);

const optionalPort = z.preprocess(
  (value) => (value === "" || value == null ? undefined : value),
  z.coerce
    .number()
    .int("Informe uma porta válida")
    .min(1, "A porta deve ser maior que zero")
    .max(65535, "A porta deve ser menor ou igual a 65535")
    .optional(),
);

const githubRepositoryFullName = z
  .string()
  .trim()
  .max(300)
  .transform((value) => value
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, ""))
  .pipe(z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "Informe dono/repositório ou a URL do GitHub"));

export const projectInputSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do projeto").max(80),
  repositoryFullName: githubRepositoryFullName,
  defaultBranch: z.string().trim().min(1).max(255).default("main"),
  productionUrl: optionalUrl,
  workingDirectory: z.string().trim().min(1).max(255).refine((value) => !value.startsWith("/") && !value.split(/[\\/]/).includes(".."), "Use um diretório relativo").default("."),
  installCommand: optionalCommand,
  lintCommand: optionalCommand,
  testCommand: optionalCommand,
  buildCommand: optionalCommand,
  previewCommand: optionalCommand,
  previewPort: optionalPort,
  githubInstallationId: z.string().regex(/^\d+$/, "Instalação do GitHub App inválida").optional(),
});

const nullableUrl = z
  .union([z.string().url("Informe uma URL válida"), z.literal(""), z.null()])
  .optional()
  .transform((value) => (value === "" ? null : value));

const nullableCommand = z
  .union([z.string().trim().min(1).max(500), z.literal(""), z.null()])
  .optional()
  .transform((value) => (value === "" ? null : value));

export const projectUpdateSchema = z
  .object({
    name: z.string().trim().min(2, "Informe o nome do projeto").max(80).optional(),
    defaultBranch: z.string().trim().min(1).max(255).optional(),
    productionUrl: nullableUrl,
    workingDirectory: z.string().trim().min(1).max(255).refine((value) => !value.startsWith("/") && !value.split(/[\\/]/).includes(".."), "Use um diretório relativo").optional(),
    installCommand: nullableCommand,
    lintCommand: nullableCommand,
    testCommand: nullableCommand,
    buildCommand: nullableCommand,
    previewCommand: nullableCommand,
    previewPort: z.union([z.coerce.number().int().min(1).max(65535), z.literal(""), z.null()]).optional().transform((value) => value === "" ? null : value),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Informe ao menos uma alteração" });

export const projectMemberInputSchema = z
  .object({
    userId: z.string().cuid().optional(),
    email: z.string().email().optional(),
    githubLogin: z.string().trim().min(1).max(80).optional(),
    role: z.enum(["MANAGER", "DEVELOPER", "VIEWER"]),
  })
  .refine((value) => value.userId || value.email || value.githubLogin, {
    message: "Informe o usuário",
    path: ["userId"],
  });

export const projectMemberUpdateSchema = z.object({
  role: z.enum(["MANAGER", "DEVELOPER", "VIEWER"]),
});

export const businessKnowledgeInputSchema = z.object({
  title: z.string().trim().min(3, "Informe um título com pelo menos 3 caracteres").max(120),
  content: z.string().trim().min(20, "Descreva a regra com pelo menos 20 caracteres").max(12000),
  source: z.enum(["MANUAL", "DEMAND", "REVIEW", "DOCUMENT", "SYSTEM"]).default("MANUAL"),
});

export const businessKnowledgeUpdateSchema = z
  .object({
    title: z.string().trim().min(3).max(120).optional(),
    content: z.string().trim().min(20).max(12000).optional(),
    status: z.enum(["CANDIDATE", "APPROVED", "REJECTED"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Informe ao menos uma alteração" });

export const demandInputSchema = z.object({
  projectId: z.string().cuid(),
  baseBranch: z.string().trim().min(1).max(255).refine((value) => !value.startsWith("-") && !value.includes("..") && !/[~^:?*\[\]\s]/.test(value), "Branch inválida"),
  title: z.string().trim().min(5, "Descreva a demanda em pelo menos 5 caracteres").max(140),
  description: z.string().trim().min(20, "Forneça contexto suficiente para a execução").max(12000),
  acceptanceCriteria: z.string().trim().max(6000).optional(),
  type: z.enum(["BUG", "FEATURE", "REFACTOR", "TEST", "INVESTIGATION", "DOCUMENTATION"]),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  visualValidation: z.boolean().default(false),
  visualPaths: z.array(z.string().trim().regex(/^\//, "Cada rota visual deve começar com /").max(500)).max(10).default([]),
  aiModel: z.enum(AI_MODEL_VALUES).default(DEFAULT_AI_MODEL),
});

export const demandUpdateSchema = demandInputSchema
  .omit({ projectId: true, priority: true, visualValidation: true, visualPaths: true })
  .partial()
  .extend({
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
    visualValidation: z.boolean().optional(),
    visualPaths: z.array(z.string().trim().regex(/^\//, "Cada rota visual deve começar com /").max(500)).max(10).optional(),
    aiModel: z.enum(AI_MODEL_VALUES).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Informe ao menos uma alteração" });

export const userAdministrationSchema = z
  .object({
    globalRole: z.enum(["ADMIN", "USER"]).optional(),
    status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  })
  .refine((value) => value.globalRole || value.status, { message: "Informe ao menos uma alteração" });

export const adminCreditGrantSchema = z.object({
  credits: z.coerce.number().int().min(1).max(1_000_000),
  validityDays: z.coerce.number().int().min(1).max(3650).default(365),
  reason: z.string().trim().min(3).max(300),
});

export const userDeletionSchema = z.object({ confirmation: z.string().trim().min(1).max(320) });

export const devEnvironmentInputSchema = z.object({
  projectId: z.string().min(1),
  branchName: z.string().trim().min(1).max(255).refine((value) => !value.startsWith("-") && !value.includes("..") && !/[~^:?*\\[\\]\\s]/.test(value), "Branch inválida"),
});

export const executionMessageInputSchema = z.object({
  content: z.string().trim().min(3, "Descreva o ajuste desejado").max(12_000, "A mensagem deve ter no máximo 12.000 caracteres"),
});

export const globalSettingsSchema = z
  .object({
    timeZone: z.enum(["America/Sao_Paulo", "UTC"]),
    nodeMemoryMb: z.coerce
      .number()
      .int("Informe a memória em MB")
      .min(256, "Reserve ao menos 256 MB para o Node")
      .max(MAX_NODE_MEMORY_MB, `O limite seguro por execução é ${MAX_NODE_MEMORY_MB} MB`),
    commandTimeoutMinutes: z.coerce.number().int().min(1).max(30),
    agentTimeoutMinutes: z.coerce.number().int().min(1).max(30),
    parallelExecutions: z.coerce
      .number()
      .int()
      .min(1, "Permita ao menos uma execução")
      .max(MAX_PARALLEL_EXECUTIONS, `A capacidade global máxima é de ${MAX_PARALLEL_EXECUTIONS} execuções paralelas`),
    workerAutoscalingEnabled: z.boolean(),
    workerMinReplicas: z.coerce.number().int().min(1).max(MAX_PARALLEL_EXECUTIONS),
    workerMaxReplicas: z.coerce.number().int().min(1).max(MAX_PARALLEL_EXECUTIONS),
    workerAutoscaleIntervalSeconds: z.coerce.number().int().min(30).max(300),
    workerScaleDownCooldownMinutes: z.coerce.number().int().min(1).max(60),
    executionProcessingEnabled: z.boolean(),
    agentPowerMode: z.enum(["ECONOMY", "BALANCED", "MAXIMUM"]),
    executionMaxAttempts: z.coerce.number().int().min(1).max(10),
    staleExecutionMinutes: z.coerce.number().int().min(5).max(180),
    healthCheckIntervalMinutes: z.coerce.number().int().min(1).max(60),
    healthCheckTimeoutSeconds: z.coerce.number().int().min(2).max(60),
    healthCheckConcurrency: z.coerce.number().int().min(1).max(25),
    healthCheckRetentionDays: z.coerce.number().int().min(1).max(365),
    previewPreparationTimeoutMinutes: z.coerce.number().int().min(1).max(60),
    environmentTtlMinutes: z.coerce.number().int().min(15).max(1_440),
    environmentCreditCost: z.coerce.number().int().min(0).max(100_000),
    environmentMaxPerUser: z.coerce.number().int().min(1).max(20),
    executionConversationTimeoutMinutes: z.coerce.number().int().min(1_440, "A interação deve permanecer disponível por pelo menos 24 horas").max(10_080),
    executionConversationMaxAdjustments: z.coerce.number().int().min(1).max(100),
    financialShadowEnabled: z.boolean(),
    usdToBrlCents: z.coerce.number().int().min(100).max(2_000),
    aiSafetyPercent: z.coerce.number().int().min(0).max(100),
    targetGrossMarginPercent: z.coerce.number().int().min(50).max(95),
    creditValueCents: z.coerce.number().int().min(1).max(1_000),
    reservationBufferPercent: z.coerce.number().int().min(0).max(100),
    creditBalanceSafetyMarginPercent: z.coerce.number().int().min(0).max(100),
    workerCostCentsPerHour: z.coerce.number().int().min(0).max(100_000),
    visualValidationCostCents: z.coerce.number().int().min(0).max(100_000),
  }).superRefine((settings, context) => {
    if (settings.workerMinReplicas > settings.workerMaxReplicas) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workerMinReplicas"],
        message: "O mínimo de réplicas não pode superar o máximo",
      });
    }
  });

const billingPlanCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,31}$/, "Use um código de 2 a 32 caracteres, sem espaços. Permitidos: letras, números, hífen (-) e sublinhado (_).");
const nullableInteger = (minimum, maximum) => z.preprocess(
  (value) => value === "" || value == null ? null : value,
  z.coerce.number().int().min(minimum).max(maximum).nullable(),
);

export const billingPlanCatalogSchema = z.object({
  code: billingPlanCodeSchema,
  name: z.string().trim().min(2).max(60),
  description: z.preprocess((value) => value === "" ? null : value, z.string().trim().max(240).nullable().optional()),
  priceCents: nullableInteger(0, 100_000_000),
  includedCredits: nullableInteger(0, 100_000_000),
  projectLimit: nullableInteger(1, 100_000),
  parallelExecutionLimit: nullableInteger(1, 1_000),
  trialDays: nullableInteger(1, 365),
  active: z.boolean(),
  public: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(10_000),
}).superRefine((plan, context) => {
  const requiredLimitsMissing = !plan.includedCredits || !plan.projectLimit || !plan.parallelExecutionLimit;
  if (plan.code === "TRIAL" && (plan.priceCents !== 0 || requiredLimitsMissing || !plan.trialDays)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["code"], message: "O plano de teste precisa ser gratuito e ter créditos, limites e duração maiores que zero" });
  }
  if (!["TRIAL", "CUSTOM"].includes(plan.code) && (!plan.priceCents || requiredLimitsMissing)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["priceCents"], message: "Um plano pago precisa ter preço, créditos e limites maiores que zero" });
  }
  if (plan.public && (!plan.active || !plan.priceCents || requiredLimitsMissing)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["public"], message: "Um plano público precisa estar ativo e ter preço, créditos e limites maiores que zero" });
  }
});

export const billingCreditPackCatalogSchema = z.object({
  code: billingPlanCodeSchema,
  name: z.string().trim().min(2).max(60),
  credits: z.coerce.number().int().min(1).max(100_000_000),
  priceCents: z.coerce.number().int().min(1).max(100_000_000),
  validityMonths: z.coerce.number().int().min(1).max(120),
  active: z.boolean(),
  public: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(10_000),
}).superRefine((pack, context) => {
  if (pack.public && !pack.active) context.addIssue({ code: z.ZodIssueCode.custom, path: ["public"], message: "Um pacote visível para compra precisa estar ativo" });
});

export const billingCheckoutSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PLAN"), plan: billingPlanCodeSchema, returnTo: z.string().regex(/^\/executions\/[A-Za-z0-9_-]+$/).optional() }),
  z.object({ kind: z.literal("CREDIT_PACK"), pack: billingPlanCodeSchema, returnTo: z.string().regex(/^\/executions\/[A-Za-z0-9_-]+$/).optional() }),
]);

export const billingChangePlanSchema = z.object({ plan: billingPlanCodeSchema });
