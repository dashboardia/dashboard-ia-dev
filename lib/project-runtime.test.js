import { describe, expect, it } from "vitest";

import { applyDetectedRuntime, detectProjectRuntime } from "./project-runtime";

describe("project runtime detection", () => {
  it("configura automaticamente um site estático", () => {
    const result = detectProjectRuntime({ fileNames: ["README.md", "index.html"] });
    expect(result.runtime).toBe("STATIC");
    expect(result.commands).toMatchObject({ buildCommand: null, previewCommand: "python3 -m http.server $PORT --bind 127.0.0.1", previewPort: 3000 });
  });

  it("usa os scripts existentes de um projeto Next.js", () => {
    const result = detectProjectRuntime({ fileNames: ["package.json", "package-lock.json"], packageJson: { scripts: { dev: "next dev", build: "next build", lint: "eslint .", test: "vitest run" }, dependencies: { next: "16.0.0" } } });
    expect(result.commands).toMatchObject({ installCommand: "npm ci", lintCommand: "npm run lint", testCommand: "npm run test", buildCommand: "npm run build", previewPort: 3000 });
  });

  it("preserva comandos informados manualmente", () => {
    const detected = detectProjectRuntime({ fileNames: ["index.html"] });
    expect(applyDetectedRuntime({ previewCommand: "comando customizado", previewPort: 4321 }, detected)).toMatchObject({
      previewCommand: "comando customizado",
      previewPort: 4321,
    });
  });

  it("persiste o comando e a porta detectados como um conjunto", () => {
    const detected = detectProjectRuntime({
      fileNames: ["requirements.txt"],
      requirements: "fastapi==0.115.12\nuvicorn==0.34.3",
    });

    expect(applyDetectedRuntime({ previewCommand: undefined, previewPort: 3000 }, detected)).toMatchObject({
      previewCommand: "uvicorn main:app --host 127.0.0.1 --port $PORT",
      previewPort: 8000,
    });
  });

  it("não cria uma porta sem comando quando o runtime é desconhecido", () => {
    const detected = detectProjectRuntime({ fileNames: ["README.md"] });
    expect(applyDetectedRuntime({ previewCommand: undefined, previewPort: undefined }, detected)).toMatchObject({
      previewCommand: undefined,
      previewPort: undefined,
    });
  });
});
