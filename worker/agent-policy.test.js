import { describe, expect, it } from "vitest";

import { buildAgentPrompt, classifyImplementationScope, resolveAgentRunPolicy } from "./agent-policy.mjs";

const project = { name: "Legado", repositoryFullName: "empresa/legado", defaultBranch: "main" };

describe("agent policy", () => {
  it("classifica arquitetura completa em várias camadas como escopo amplo", () => {
    const demand = {
      project,
      title: "Desenvolva um projeto completo legado em Java 7",
      description: "Use JSP, Hibernate, persistência em banco, controllers, services e repositories em um monólito com vários módulos.",
      acceptanceCriteria: "O cadastro e os indicadores devem persistir no banco de dados.",
    };

    expect(classifyImplementationScope(demand)).toBe("COMPLEX");
    expect(resolveAgentRunPolicy({ demand, model: "gpt-5.6-terra", configuredTimeoutMinutes: 5 }))
      .toMatchObject({ scope: "COMPLEX", maxTurns: 64, timeoutMinutes: 15, reasoningEffort: "high" });
  });

  it("permite ao administrador reduzir ou ampliar o orçamento do agente", () => {
    const demand = { project, title: "Projeto completo", description: "Criar persistência, banco, controllers, services e repositories.", acceptanceCriteria: "Aplicação completa em vários módulos." };
    const economy = resolveAgentRunPolicy({ demand, model: "gpt-5.6-terra", configuredTimeoutMinutes: 5, powerMode: "ECONOMY" });
    const maximum = resolveAgentRunPolicy({ demand, model: "gpt-5.6-terra", configuredTimeoutMinutes: 5, powerMode: "MAXIMUM" });

    expect(economy).toMatchObject({ maxTurns: 40, maxTokens: 24_000, timeoutMinutes: 10 });
    expect(maximum).toMatchObject({ maxTurns: 96, maxTokens: 48_000, timeoutMinutes: 30 });
  });

  it("mantém orçamento menor para uma correção pontual", () => {
    const demand = { project, title: "Corrigir rótulo", description: "Corrija o texto do botão de salvar.", acceptanceCriteria: "Exibir Salvar alterações." };

    expect(classifyImplementationScope(demand)).toBe("STANDARD");
    expect(resolveAgentRunPolicy({ demand, model: "gpt-5.6-terra", configuredTimeoutMinutes: 7 }))
      .toMatchObject({ scope: "STANDARD", maxTurns: 36, timeoutMinutes: 7, reasoningEffort: "medium" });
  });

  it("proíbe que um mock visual substitua requisitos funcionais em escopo amplo", () => {
    const demand = {
      project,
      type: "FEATURE",
      priority: "HIGH",
      title: "Projeto completo com persistência",
      description: "Criar controllers, services, repositories e banco de dados.",
      acceptanceCriteria: "Persistir usuários no banco.",
      visualValidation: false,
    };

    const prompt = buildAgentPrompt(demand, "COMPLEX");
    expect(prompt).toContain("ESCOPO AMPLO");
    expect(prompt).toContain("É proibido substituir backend");
    expect(prompt).toContain("Continue trabalhando enquanto houver requisito obrigatório");
    expect(prompt).not.toContain("alterações pequenas e focadas");
  });
});
