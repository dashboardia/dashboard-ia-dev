import { z } from "zod";

const optionalUrl = z
  .union([z.string().url("Informe uma URL válida"), z.literal("")])
  .optional()
  .transform((value) => value || undefined);

const optionalCommand = z
  .union([z.string().trim().min(1).max(500), z.literal("")])
  .optional()
  .transform((value) => value || undefined);

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
  type: z.enum(["BUG", "FEATURE", "REFACTOR", "TEST", "INVESTIGATION"]),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
});

export const demandUpdateSchema = demandInputSchema
  .omit({ projectId: true, priority: true })
  .partial()
  .extend({ priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional() })
  .refine((value) => Object.keys(value).length > 0, { message: "Informe ao menos uma alteração" });

export const userAdministrationSchema = z
  .object({
    globalRole: z.enum(["ADMIN", "USER"]).optional(),
    status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  })
  .refine((value) => value.globalRole || value.status, { message: "Informe ao menos uma alteração" });
