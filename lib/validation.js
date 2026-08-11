import { z } from "zod";

const optionalUrl = z
  .union([z.string().url("Informe uma URL válida"), z.literal("")])
  .optional()
  .transform((value) => value || undefined);

const optionalId = z
  .union([z.string().trim().min(1).max(160), z.literal("")])
  .optional()
  .transform((value) => value || undefined);

const optionalCommand = z
  .union([z.string().trim().min(1).max(500), z.literal("")])
  .optional()
  .transform((value) => value || undefined);

export const projectInputSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do projeto").max(80),
  repositoryFullName: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "Use o formato proprietário/repositório"),
  defaultBranch: z.string().trim().min(1).max(255).default("main"),
  productionUrl: optionalUrl,
  railwayProjectId: optionalId,
  railwayEnvironmentId: optionalId,
  railwayServiceId: optionalId,
  workingDirectory: z.string().trim().min(1).max(255).refine((value) => !value.startsWith("/") && !value.split(/[\\/]/).includes(".."), "Use um diretório relativo").default("."),
  installCommand: optionalCommand,
  lintCommand: optionalCommand,
  testCommand: optionalCommand,
  buildCommand: optionalCommand,
});

export const projectUpdateSchema = projectInputSchema.partial().extend({
  status: z.enum(["ACTIVE", "ARCHIVED", "DISCONNECTED"]).optional(),
});

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

export const demandInputSchema = z.object({
  projectId: z.string().cuid(),
  title: z.string().trim().min(5, "Descreva a demanda em pelo menos 5 caracteres").max(140),
  description: z.string().trim().min(20, "Forneça contexto suficiente para a execução").max(12000),
  acceptanceCriteria: z.string().trim().max(6000).optional(),
  type: z.enum(["BUG", "FEATURE", "REFACTOR", "TEST", "INVESTIGATION"]),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
});

export const demandUpdateSchema = demandInputSchema.omit({ projectId: true }).partial();
