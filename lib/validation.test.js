import { describe, expect, it } from "vitest";

import { demandInputSchema, demandUpdateSchema, globalSettingsSchema, projectInputSchema, projectUpdateSchema } from "./validation";

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
  };

  it("aceita de uma a quatro execuções paralelas", () => {
    expect(globalSettingsSchema.parse({ ...base, parallelExecutions: "2" }).parallelExecutions).toBe(2);
    expect(() => globalSettingsSchema.parse({ ...base, parallelExecutions: 0 })).toThrow("ao menos uma execução");
    expect(() => globalSettingsSchema.parse({ ...base, parallelExecutions: 5 })).toThrow("quatro execuções");
  });

  it("aceita até 2 GB de memória Node por execução", () => {
    expect(globalSettingsSchema.parse({ ...base, nodeMemoryMb: "2048", parallelExecutions: 2 }).nodeMemoryMb).toBe(2048);
    expect(() => globalSettingsSchema.parse({ ...base, nodeMemoryMb: 2049, parallelExecutions: 1 })).toThrow("limite seguro por execução");
  });

  it("protege a memória total quando há execuções paralelas", () => {
    expect(globalSettingsSchema.parse({ ...base, nodeMemoryMb: 1024, parallelExecutions: 4 }).nodeMemoryMb).toBe(1024);
    expect(() => globalSettingsSchema.parse({ ...base, nodeMemoryMb: 1536, parallelExecutions: 4 })).toThrow("no máximo 1024 MB");
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
