import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { applyDetectedRuntime, applyWorkingDirectory, detectProjectRuntime, detectRepositoryRuntime, detectedRuntimeReplacesConfiguration, detectWorkspaceProjectRuntime, mavenBuildCommandInRepository } from "./project-runtime";

describe("project runtime detection", () => {
  it("prioriza o Dockerfile do projeto e respeita a porta exposta", () => {
    const result = detectRepositoryRuntime({
      fileNames: ["dockerfile", "package.json"],
      contents: {
        dockerfile: "FROM node:22\nEXPOSE 4321\nCMD [\"npm\",\"start\"]",
        "package.json": JSON.stringify({ scripts: { dev: "vite" }, dependencies: { vite: "latest" } }),
      },
    });

    expect(result).toMatchObject({
      runtime: "DOCKERFILE",
      workingDirectory: ".",
      commands: { previewCommand: "__IMAGE_CMD__", previewPort: 4321 },
    });
  });

  it("encaminha stacks sem detector manual para o Railpack", () => {
    const result = detectRepositoryRuntime({
      fileNames: ["Cargo.toml", "src/main.rs"],
      contents: {},
    });

    expect(result).toMatchObject({
      runtime: "RAILPACK",
      workingDirectory: ".",
      commands: { previewCommand: "__IMAGE_CMD__", previewPort: 8080 },
    });
  });

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

  it("detecta e configura um monorepo com backend FastAPI e frontend Vite", () => {
    const result = detectRepositoryRuntime({
      fileNames: [
        "backend/main.py",
        "backend/requirements.txt",
        "frontend/package.json",
        "frontend/package-lock.json",
        "frontend/src/main.jsx",
        "package-lock.json",
      ],
      contents: {
        "backend/requirements.txt": "fastapi==0.115.12\nuvicorn==0.34.3",
        "frontend/package.json": JSON.stringify({
          scripts: { dev: "vite", build: "vite build", lint: "eslint ." },
          dependencies: { vite: "^5.0.0" },
        }),
      },
    });

    expect(result.runtime).toBe("MONOREPO_PYTHON_FASTAPI_NODE");
    expect(result.workingDirectory).toBe(".");
    expect(result.commands).toMatchObject({
      installCommand: "(cd backend && pip install -r requirements.txt) && npm --prefix frontend ci",
      lintCommand: "npm --prefix frontend run lint",
      buildCommand: "npm --prefix frontend run build",
      previewCommand: "npm --prefix frontend run dev -- --host 127.0.0.1 --port $PORT",
      previewPort: 5173,
      auxiliaryPreviewCommand: "(cd backend && uvicorn main:app --host 127.0.0.1 --port $PORT)",
      auxiliaryPreviewPort: 8000,
    });
  });

  it("detecta e configura um monorepo com backend Maven e frontend Vite", () => {
    const result = detectRepositoryRuntime({
      fileNames: [
        "pom.xml",
        "src/main/java/com/dashboardia/Application.java",
        "src/main/resources/application.properties",
        "frontend/package.json",
        "frontend/package-lock.json",
        "frontend/src/main.jsx",
      ],
      contents: {
        "pom.xml": "<project><parent><artifactId>spring-boot-starter-parent</artifactId></parent></project>",
        "frontend/package.json": JSON.stringify({
          scripts: { dev: "vite", build: "vite build", lint: "eslint ." },
          dependencies: { vite: "^5.0.0" },
        }),
      },
    });

    expect(result.runtime).toBe("MONOREPO_JAVA_MAVEN_NODE");
    expect(result.workingDirectory).toBe(".");
    expect(result.commands).toMatchObject({
      installCommand: "npm --prefix frontend ci",
      buildCommand: "mvn -B -DskipTests package && npm --prefix frontend run build",
      previewCommand: "npm --prefix frontend run dev -- --host 127.0.0.1 --port $PORT",
      previewPort: 5173,
      auxiliaryPreviewCommand: "mvn spring-boot:run -Dspring-boot.run.arguments=--server.port=$PORT",
      auxiliaryPreviewPort: 8080,
    });
  });

  it("detecta o diretório de um projeto Maven fora da raiz", () => {
    const result = detectRepositoryRuntime({
      fileNames: ["README.md", "sistema-web/pom.xml", "sistema-web/src/main/webapp/index.jsp"],
      contents: { "sistema-web/pom.xml": "<project><packaging>war</packaging></project>" },
    });

    expect(result.runtime).toBe("JAVA_MAVEN");
    expect(result.workingDirectory).toBe("sistema-web");
    expect(result.commands.buildCommand).toBe("(cd sistema-web && mvn -B -DskipTests package)");
  });

  it("detecta a versão Java declarada no pom do Spring Boot", () => {
    const result = detectRepositoryRuntime({
      fileNames: ["pom.xml", "src/main/java/com/example/Application.java"],
      contents: {
        "pom.xml": "<project><properties><java.version>17</java.version></properties><dependency><artifactId>spring-boot-starter-web</artifactId></dependency></project>",
      },
    });

    expect(result.runtime).toBe("JAVA_MAVEN_17");
    expect(result.commands.previewCommand).toContain("spring-boot:run");
  });

  it("normaliza a declaração Maven legada 1.8 para Java 8", () => {
    const result = detectRepositoryRuntime({
      fileNames: ["pom.xml", "frontend/package.json"],
      contents: {
        "pom.xml": "<project><properties><maven.compiler.source>1.8</maven.compiler.source><maven.compiler.target>1.8</maven.compiler.target></properties></project>",
        "frontend/package.json": JSON.stringify({ scripts: { dev: "vite" } }),
      },
    });

    expect(result.runtime).toBe("MONOREPO_JAVA_MAVEN_8_NODE");
  });

  it("usa JDK 8 para compilar projetos legados configurados como Java 1.7", () => {
    const result = detectRepositoryRuntime({
      fileNames: ["pom.xml", "frontend/package.json"],
      contents: {
        "pom.xml": "<project><properties><maven.compiler.source>1.7</maven.compiler.source><maven.compiler.target>1.7</maven.compiler.target></properties></project>",
        "frontend/package.json": JSON.stringify({ scripts: { dev: "vite" } }),
      },
    });

    expect(result.runtime).toBe("MONOREPO_JAVA_MAVEN_8_NODE");
  });

  it("prioriza ASP.NET Core quando a migração de stack mantém um pom residual", () => {
    const result = detectRepositoryRuntime({
      fileNames: ["FerroGestao.csproj", "Program.cs", "appsettings.json", "pom.xml", "index.html"],
      contents: {
        "FerroGestao.csproj": '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>',
        "pom.xml": "<project><packaging>pom</packaging></project>",
      },
    });

    expect(result.runtime).toBe("DOTNET_8");
    expect(result.workingDirectory).toBe(".");
    expect(result.commands).toMatchObject({
      installCommand: "dotnet restore",
      buildCommand: "dotnet build -c Release --no-restore",
      previewCommand: "dotnet run -c Release --no-build --no-launch-profile --urls http://127.0.0.1:$PORT",
      previewPort: 8080,
    });
  });

  it("substitui comandos Maven quando a branch migrou para ASP.NET Core", () => {
    const saved = {
      workingDirectory: ".",
      buildCommand: "mvn -B -DskipTests package",
      previewCommand: "python3 -m http.server $PORT --bind 127.0.0.1",
      previewPort: 3000,
    };
    const detected = detectRepositoryRuntime({
      fileNames: ["FerroGestao.csproj", "Program.cs", "pom.xml"],
      contents: {
        "FerroGestao.csproj": "<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>",
        "pom.xml": "<project><packaging>pom</packaging></project>",
      },
    });

    expect(detectedRuntimeReplacesConfiguration(saved, detected)).toBe(true);
    expect(applyDetectedRuntime(saved, detected, { replaceExisting: true })).toMatchObject({
      buildCommand: "dotnet build -c Release --no-restore",
      previewCommand: "dotnet run -c Release --no-build --no-launch-profile --urls http://127.0.0.1:$PORT",
      previewPort: 8080,
    });
  });

  it("aplica o diretório detectado aos comandos manuais do projeto", () => {
    const configured = applyWorkingDirectory({
      buildCommand: "mvn -B -DskipTests package",
      previewCommand: "python3 -m http.server $PORT --bind 127.0.0.1",
      previewPort: 8080,
    }, "sistema-web");

    expect(configured).toMatchObject({
      workingDirectory: "sistema-web",
      buildCommand: "(cd sistema-web && mvn -B -DskipTests package)",
      previewCommand: "(cd sistema-web && python3 -m http.server $PORT --bind 127.0.0.1)",
      previewPort: 8080,
    });
  });

  it("não duplica o diretório em comandos que já foram detectados", () => {
    const configured = applyWorkingDirectory({
      buildCommand: "(cd sistema-web && mvn -B -DskipTests package)",
      previewCommand: "npm --prefix sistema-web run dev",
    }, "sistema-web");

    expect(configured.buildCommand).toBe("(cd sistema-web && mvn -B -DskipTests package)");
    expect(configured.previewCommand).toBe("npm --prefix sistema-web run dev");
  });

  it("localiza o pom no build mesmo quando o projeto ainda está configurado na raiz", () => {
    const command = mavenBuildCommandInRepository("mvn -B -DskipTests package", ".");

    expect(command).toContain("find . -type f -name pom.xml");
    expect(command).toContain('cd "$project_dir"');
    expect(command).toContain("mvn -B -DskipTests package");
  });

  it("preserva opções Maven explícitas com pom informado", () => {
    expect(mavenBuildCommandInRepository("mvn -f legado/pom.xml package", ".")).toBe("mvn -f legado/pom.xml package");
  });

  it("detecta um projeto criado pelo agente em um workspace inicialmente vazio", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "forgeboard-runtime-"));
    try {
      await mkdir(path.join(workspace, "frontend"));
      await writeFile(path.join(workspace, "frontend", "package.json"), JSON.stringify({
        scripts: { dev: "vite", build: "vite build" },
        devDependencies: { vite: "^5.0.0" },
      }));
      await writeFile(path.join(workspace, "frontend", "package-lock.json"), "{}");

      const result = await detectWorkspaceProjectRuntime(workspace);

      expect(result.commands).toMatchObject({
        installCommand: "npm --prefix frontend ci",
        buildCommand: "npm --prefix frontend run build",
        previewCommand: "npm --prefix frontend run dev -- --host 127.0.0.1 --port $PORT",
        previewPort: 5173,
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
