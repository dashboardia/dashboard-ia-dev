import { describe, expect, it } from "vitest";

import { billingPlanCatalogSchema, demandInputSchema, demandUpdateSchema, globalSettingsSchema, projectInputSchema, projectUpdateSchema } from "./validation";

describe("billingPlanCatalogSchema", () => {
  const paidPlan = {
    code: "GO_1000",
    name: "1.000 créditos",
    description: "Para desenvolvedores",
    priceCents: 5000,
    includedCredits: 1000,
    projectLimit: 2,
    parallelExecutionLimit: 1,
    trialDays: null,
    active: true,
    public: true,
    sortOrder: 50,
  };

  it("aceita código sem espaços", () => {
    expect(billingPlanCatalogSchema.parse(paidPlan).code).toBe("GO_1000");
  });

  it("explica claramente que código não aceita espaços", () => {
    expect(() => billingPlanCatalogSchema.parse({ ...paidPlan, code: "GO 1000" })).toThrow("sem espaços");
  });
});

describe("projectInputSchema", () => {
  it("aceita a porta de preview vazia para permitir detecção automática", () => {
    const input = projectInputSchema.parse({
      name: "Cotações",
      repositoryFullName: "MatheusAugsburger/cotacoes_moderno",
      previewPort: "",
    });

    expect(input.previewPort).toBeUndefined();
  });

  it("aceita um repositório GitHub válido", () => {
    const input = projectInputSchema.parse({
      name: "Dashboard IA",
      repositoryFullName: "dashboardia/dashboard-ia-dev",
      defaultBranch: "main",
    });
    expect(input.repositoryFullName).toBe("dashboardia/dashboard-ia-dev");
  });

  it("normaliza a URL completa do GitHub", () => {
    const input = projectInputSchema.parse({
      name: "Dashboard IA",
      repositoryFullName: "https://github.com/dashboardia/dashboard-ia-dev.git",
    });
    expect(input.repositoryFullName).toBe("dashboardia/dashboard-ia-dev");
  });

  it("permite trabalhar somente com o GitHub", () => {
    const input = projectInputSchema.parse({
      name: "Dashboard IA",
      repositoryFullName: "dashboardia/dashboard-ia-dev",
    });
    expect(input.productionUrl).toBeUndefined();
  });

  it("aceita uma aplicação publicada em qualquer plataforma", () => {
    const input = projectInputSchema.parse({
      name: "Dashboard IA",
      repositoryFullName: "dashboardia/dashboard-ia-dev",
      productionUrl: "https://app.exemplo.com",
    });
    expect(input.productionUrl).toBe("https://app.exemplo.com");
  });

  it("recusa repositório sem proprietário", () => {
    expect(() => projectInputSchema.parse({ name: "Dashboard IA", repositoryFullName: "dashboard-ia-dev" })).toThrow();
  });

  it("aceita somente um identificador numérico de instalação", () => {
    const input = projectInputSchema.parse({
      name: "Dashboard IA",
      repositoryFullName: "dashboardia/dashboard-ia-dev",
      githubInstallationId: "123456",
    });
    expect(input.githubInstallationId).toBe("123456");
    expect(() => projectInputSchema.parse({ name: "Dashboard IA", repositoryFullName: "dashboardia/dashboard-ia-dev", githubInstallationId: "inválido" })).toThrow();
  });
});

describe("globalSettingsSchema", () => {
  const base = {
    timeZone: "America/Sao_Paulo",
    nodeMemoryMb: 768,
    commandTimeoutMinutes: 10,
    agentTimeoutMinutes: 5,
    parallelExecutions: 2,
    workerAutoscalingEnabled: true,
    workerMinReplicas: 2,
    workerMaxReplicas: 10,
    workerAutoscaleIntervalSeconds: 60,
    workerScaleDownCooldownMinutes: 5,
    executionProcessingEnabled: true,
    agentPowerMode: "BALANCED",
    executionMaxAttempts: 3,
    staleExecutionMinutes: 30,
    healthCheckIntervalMinutes: 5,
    healthCheckTimeoutSeconds: 10,
    healthCheckConcurrency: 10,
    healthCheckRetentionDays: 30,
    previewPreparationTimeoutMinutes: 15,
    environmentTtlMinutes: 240,
    environmentCreditCost: 300,
    environmentMaxPerUser: 2,
    executionConversationTimeoutMinutes: 1440,
    executionConversationMaxAdjustments: 10,
    executionConversationCreditCost: 25,
    financialShadowEnabled: true,
    usdToBrlCents: 600,
    aiSafetyPercent: 15,
    targetGrossMarginPercent: 80,
    creditValueCents: 10,
    reservationBufferPercent: 20,
    creditBalanceSafetyMarginPercent: 20,
    workerCostCentsPerHour: 100,
    visualValidationCostCents: 10,
  };

  it("aceita capacidade global de uma a vinte execuções", () => {
    expect(globalSettingsSchema.parse({ ...base, parallelExecutions: "2" }).parallelExecutions).toBe(2);
    expect(() => globalSettingsSchema.parse({ ...base, parallelExecutions: 0 })).toThrow("ao menos uma execução");
    expect(globalSettingsSchema.parse({ ...base, nodeMemoryMb: 768, parallelExecutions: 20 }).parallelExecutions).toBe(20);
    expect(() => globalSettingsSchema.parse({ ...base, parallelExecutions: 21 })).toThrow("capacidade global máxima");
  });

  it("aceita até 2 GB de memória Node por execução", () => {
    expect(globalSettingsSchema.parse({ ...base, nodeMemoryMb: "2048", parallelExecutions: 2 }).nodeMemoryMb).toBe(2048);
    expect(() => globalSettingsSchema.parse({ ...base, nodeMemoryMb: 2049, parallelExecutions: 1 })).toThrow("limite seguro por execução");
  });

  it("mantém a memória por execução independente da quantidade de réplicas", () => {
    expect(globalSettingsSchema.parse({ ...base, nodeMemoryMb: 2048, parallelExecutions: 20 }).nodeMemoryMb).toBe(2048);
  });

  it("valida os limites do autoscaling", () => {
    const parsed = globalSettingsSchema.parse({ ...base, workerMinReplicas: "2", workerMaxReplicas: "10" });
    expect(parsed.workerMaxReplicas).toBe(10);
    expect(() => globalSettingsSchema.parse({ ...base, workerMinReplicas: 11, workerMaxReplicas: 10 })).toThrow("mínimo de réplicas");
  });

  it("valida os parâmetros da simulação financeira", () => {
    const parsed = globalSettingsSchema.parse({ ...base, parallelExecutions: 2, usdToBrlCents: "625" });
    expect(parsed.usdToBrlCents).toBe(625);
    expect(() => globalSettingsSchema.parse({ ...base, parallelExecutions: 2, targetGrossMarginPercent: 99 })).toThrow();
  });

  it("valida os controles operacionais do agente", () => {
    const parsed = globalSettingsSchema.parse({ ...base, agentPowerMode: "MAXIMUM", executionProcessingEnabled: false });
    expect(parsed.agentPowerMode).toBe("MAXIMUM");
    expect(parsed.executionProcessingEnabled).toBe(false);
    expect(() => globalSettingsSchema.parse({ ...base, executionMaxAttempts: 11 })).toThrow();
  });
});

describe("projectUpdateSchema", () => {
  it("permite limpar configurações opcionais sem alterar o repositório", () => {
    const input = projectUpdateSchema.parse({ productionUrl: "", buildCommand: "" });
    expect(input).toEqual({ productionUrl: null, buildCommand: null });
    expect(projectUpdateSchema.parse({ repositoryFullName: "outro/repositorio", name: "Portal" })).toEqual({ name: "Portal" });
  });

  it("recusa diretório de trabalho fora do repositório", () => {
    expect(() => projectUpdateSchema.parse({ workingDirectory: "../outro" })).toThrow("diretório relativo");
  });
});

describe("demandInputSchema", () => {
  it("exige contexto suficiente para execução", () => {
    expect(() => demandInputSchema.parse({
      projectId: "cm12345678901234567890123",
      title: "Corrigir login",
      description: "curta",
      type: "BUG",
    })).toThrow();
  });

  it("recusa atualização vazia de demanda", () => {
    expect(() => demandUpdateSchema.parse({})).toThrow("ao menos uma alteração");
  });

  it("aceita validação visual com rotas seguras", () => {
    const input = demandInputSchema.parse({
      projectId: "cm12345678901234567890123",
      title: "Corrigir layout mobile",
      description: "A tela precisa manter o conteúdo legível em celulares.",
      type: "BUG",
      visualValidation: true,
      visualPaths: ["/", "/login"],
    });
    expect(input.visualPaths).toEqual(["/", "/login"]);
    expect(() => demandUpdateSchema.parse({ visualPaths: ["https://externo.test"] })).toThrow("começar com /");
  });

  it("usa o modelo equilibrado por padrão e recusa modelos não oferecidos", () => {
    const input = demandInputSchema.parse({
      projectId: "cm12345678901234567890123",
      title: "Corrigir autenticação",
      description: "A autenticação precisa tratar corretamente sessões expiradas.",
      type: "BUG",
    });
    expect(input.aiModel).toBe("gpt-5.6-terra");
    expect(() => demandUpdateSchema.parse({ aiModel: "modelo-inexistente" })).toThrow();
  });

  it("aceita demanda de documentação de negócio", () => {
    const input = demandInputSchema.parse({
      projectId: "cm12345678901234567890123",
      title: "Documentar regras comerciais",
      description: "Gerar uma documentação de negócio baseada no comportamento confirmado pelo repositório.",
      type: "DOCUMENTATION",
      aiModel: "gpt-5.6-luna",
    });
    expect(input.type).toBe("DOCUMENTATION");
    expect(input.aiModel).toBe("gpt-5.6-luna");
  });
});
