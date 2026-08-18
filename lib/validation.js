import { z } from "zod";

import { AI_MODEL_VALUES, DEFAULT_AI_MODEL } from "./ai-models";
import {
  MAX_NODE_MEMORY_MB,
  MAX_PARALLEL_EXECUTIONS,
  maximumNodeMemoryForParallelExecutions,
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

export const demandInputSchema = z.object({
  projectId: z.string().cuid(),
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

export const globalSettingsSchema = z
  .object({
    timeZone: z.enum(["America/Sao_Paulo", "UTC"]),
    nodeMemoryMb: z.coerce
      .number()
      .int("Informe a memória em MB")
      .min(256, "Reserve ao menos 256 MB para o Node")
      .max(MAX_NODE_MEMORY_MB, `O limite seguro por execução é ${MAX_NODE_MEMORY_MB} MB`),
    commandTimeoutMinutes: z.coerce.number().int().min(1).max(30),
    agentTimeoutMinutes: z.coerce.number().int().min(1).max(15),
    parallelExecutions: z.coerce
      .number()
      .int()
      .min(1, "Permita ao menos uma execução")
      .max(MAX_PARALLEL_EXECUTIONS, "O limite seguro atual é de cinco execuções paralelas"),
    financialShadowEnabled: z.boolean(),
    usdToBrlCents: z.coerce.number().int().min(100).max(2_000),
    aiSafetyPercent: z.coerce.number().int().min(0).max(100),
    targetGrossMarginPercent: z.coerce.number().int().min(50).max(95),
    creditValueCents: z.coerce.number().int().min(1).max(1_000),
    reservationBufferPercent: z.coerce.number().int().min(0).max(100),
    workerCostCentsPerHour: z.coerce.number().int().min(0).max(100_000),
    visualValidationCostCents: z.coerce.number().int().min(0).max(100_000),
  })
  .superRefine((settings, context) => {
    const maximumMemoryMb = maximumNodeMemoryForParallelExecutions(settings.parallelExecutions);
    if (settings.nodeMemoryMb > maximumMemoryMb) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodeMemoryMb"],
        message: `Com ${settings.parallelExecutions} execuções paralelas, selecione no máximo ${maximumMemoryMb} MB por execução`,
      });
    }
  });

export const billingCheckoutSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PLAN"), plan: z.enum(["STUDIO", "AGENCY"]) }),
  z.object({ kind: z.literal("CREDIT_PACK"), pack: z.enum(["CREDITS_1000", "CREDITS_3000", "CREDITS_7000"]) }),
]);

export const billingChangePlanSchema = z.object({ plan: z.enum(["STUDIO", "AGENCY"]) });
