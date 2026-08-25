import { describe, expect, it } from "vitest";

import { buildAgentPrompt, classifyImplementationScope, resolveAgentRunPolicy } from "./agent-policy.mjs";

const project = { name: "Legado", repositoryFullName: "empresa/legado", defaultBranch: "main" };
const baseBranch = "main";

describe("agent policy", () => {
  it("classifica arquitetura completa em várias camadas como escopo amplo", () => {
    const demand = {
      project,
      baseBranch,
      title: "Desenvolva um projeto completo legado em Java 7",
      description: "Use JSP, Hibernate, persistência em banco, controllers, services e repositories em um monólito com vários módulos.",
      acceptanceCriteria: "O cadastro e os indicadores devem persistir no banco de dados.",
    };

    expect(classifyImplementationScope(demand)).toBe("COMPLEX");
    expect(resolveAgentRunPolicy({ demand, model: "gpt-5.6-terra", configuredTimeoutMinutes: 5 }))
      .toMatchObject({ scope: "COMPLEX", maxTurns: 64, timeoutMinutes: 15, reasoningEffort: "high" });
  });

  it("permite ao administrador reduzir ou ampliar o orçamento do agente", () => {
    const demand = { project, baseBranch, title: "Projeto completo", description: "Criar persistência, banco, controllers, services e repositories.", acceptanceCriteria: "Aplicação completa em vários módulos." };
    const economy = resolveAgentRunPolicy({ demand, model: "gpt-5.6-terra", configuredTimeoutMinutes: 5, powerMode: "ECONOMY" });
    const maximum = resolveAgentRunPolicy({ demand, model: "gpt-5.6-terra", configuredTimeoutMinutes: 5, powerMode: "MAXIMUM" });

    expect(economy).toMatchObject({ maxTurns: 40, maxTokens: 24_000, timeoutMinutes: 10 });
    expect(maximum).toMatchObject({ maxTurns: 96, maxTokens: 48_000, timeoutMinutes: 30 });
  });

  it("mantém orçamento menor para uma correção pontual", () => {
    const demand = { project, baseBranch, title: "Corrigir rótulo", description: "Corrija o texto do botão de salvar.", acceptanceCriteria: "Exibir Salvar alterações." };

    expect(classifyImplementationScope(demand)).toBe("STANDARD");
    expect(resolveAgentRunPolicy({ demand, model: "gpt-5.6-terra", configuredTimeoutMinutes: 7 }))
      .toMatchObject({ scope: "STANDARD", maxTurns: 36, timeoutMinutes: 7, reasoningEffort: "medium" });
  });

  it("proíbe que um mock visual substitua requisitos funcionais em escopo amplo", () => {
    const demand = {
      project,
      baseBranch,
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

  it("inclui somente o conhecimento de negócio aprovado fornecido pela aplicação", () => {
    const demand = {
      project,
      baseBranch,
      type: "FEATURE",
      priority: "NORMAL",
      title: "Calcular margem industrial",
      description: "Adicionar o cálculo ao relatório.",
      acceptanceCriteria: "Exibir a margem consolidada.",
      visualValidation: false,
    };

    const prompt = buildAgentPrompt(demand, "STANDARD", {
      businessKnowledge: "- [Projeto] Margem industrial\nSempre descontar perdas confirmadas.",
    });

    expect(prompt).toContain("Conhecimento de negócio aprovado pelo cliente");
    expect(prompt).toContain("Sempre descontar perdas confirmadas");
    expect(prompt).toContain("A demanda aprovada e o código atual têm precedência");
  });

  it("instrui a criação completa quando a branch vazia foi confirmada", () => {
    const demand = {
      project,
      baseBranch,
      type: "FEATURE",
      priority: "NORMAL",
      title: "Criar portal do cliente",
      description: "Desenvolver a primeira versão funcional do portal.",
      acceptanceCriteria: "Aplicação deve iniciar com banco limpo.",
      visualValidation: false,
    };

    const prompt = buildAgentPrompt(demand, "STANDARD", { emptyRepository: true });

    expect(prompt).toContain("autorizou expressamente a criação do projeto do zero");
    expect(prompt).toContain("Crie toda a estrutura executável necessária");
  });

  it("torna obrigatório o contrato de acesso demonstrativo em aplicações autenticadas", () => {
    const demand = {
      project,
      baseBranch,
      type: "FEATURE",
      priority: "NORMAL",
      title: "Adicionar painel autenticado",
      description: "Criar login e área administrativa.",
      acceptanceCriteria: "Administrador consegue acessar o painel.",
      visualValidation: true,
      visualPaths: ["/login"],
    };

    const prompt = buildAgentPrompt(demand, "STANDARD");

    expect(prompt).toContain("é obrigatório criar um acesso administrativo");
    expect(prompt).toContain("DASHBOARDIA_DEMO_PASSWORD");
    expect(prompt).toContain(".dashboardia/demo-access.json");
  });

  it("entrega à IA o runtime real e exige inicialização compatível com o preview", () => {
    const demand = {
      project,
      baseBranch,
      type: "FEATURE",
      priority: "NORMAL",
      title: "Adicionar relatório",
      description: "Criar o relatório solicitado.",
      acceptanceCriteria: "Relatório acessível no navegador.",
      visualValidation: false,
    };
    const prompt = buildAgentPrompt(demand, "STANDARD", {
      runtimeContext: { runtime: "JAVA_MAVEN_17", workingDirectory: ".", commands: { buildCommand: "mvn package" } },
    });

    expect(prompt).toContain("Não presuma npm, Maven, Gradle, pip ou Composer");
    expect(prompt).toContain("porta fornecida por PORT");
    expect(prompt).toContain("JAVA_MAVEN_17");
  });
});
