import { describe, expect, it } from "vitest";

import {
  normalizeValidationConfiguration,
  validationContainerCreateArguments,
  validationContainerExecArguments,
  validationRuntimeImage,
} from "./validation-runtime.mjs";

const baseInput = {
  runtime: "NODE",
  workingDirectory: ".",
  commands: [{ scope: "test", command: "npm test" }],
};

describe("validation runtime", () => {
  it("seleciona imagens por runtime", () => {
    expect(validationRuntimeImage("NODE")).toBe("node:22-bookworm");
    expect(validationRuntimeImage("PYTHON_FASTAPI")).toBe("python:3.12-bookworm");
    expect(validationRuntimeImage("JAVA_MAVEN_8")).toContain("temurin-8");
    expect(validationRuntimeImage("DOTNET_8")).toContain("dotnet/sdk:8.0");
  });

  it("recusa caminhos fora do workspace e escopos duplicados", () => {
    expect(() => normalizeValidationConfiguration({ ...baseInput, workingDirectory: "../segredo" })).toThrow(/Diretório/);
    expect(() => normalizeValidationConfiguration({
      ...baseInput,
      commands: [
        { scope: "test", command: "npm test" },
        { scope: "test", command: "npm run test:unit" },
      ],
    })).toThrow(/duplicado/);
  });

  it("cria container sem mounts do host e com limites fortes", () => {
    const configuration = normalizeValidationConfiguration(baseInput);
    const args = validationContainerCreateArguments("validation_123", configuration);
    const text = args.join(" ");
    expect(text).toContain("--read-only");
    expect(text).toContain("--cap-drop ALL");
    expect(text).toContain("no-new-privileges:true");
    expect(text).toContain("--pids-limit 256");
    expect(text).toContain("--user 1000:1000");
    expect(text).not.toContain("/var/run/docker.sock");
    expect(text).not.toContain("--privileged");
    expect(text).not.toContain("--mount");
  });

  it("executa Python dentro de venv descartável", () => {
    const configuration = normalizeValidationConfiguration({
      ...baseInput,
      runtime: "PYTHON_FASTAPI",
      commands: [{ scope: "test", command: "pytest" }],
    });
    const args = validationContainerExecArguments("validation_123", configuration, configuration.commands[0]);
    expect(args.at(-1)).toContain("python3 -m venv /workspace/.dashboardia-venv");
    expect(args.at(-1)).toContain("pytest");
  });
});
