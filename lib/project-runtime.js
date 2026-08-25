import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { githubRequest } from "./github.js";

const CONFIG_FIELDS = ["installCommand", "lintCommand", "testCommand", "buildCommand", "previewCommand", "previewPort"];

function packageRunner(files) {
  if (files.has("pnpm-lock.yaml")) return { install: "pnpm install --frozen-lockfile", run: "pnpm" };
  if (files.has("yarn.lock")) return { install: "yarn install --frozen-lockfile", run: "yarn" };
  return { install: files.has("package-lock.json") ? "npm ci" : "npm install", run: "npm" };
}

function scriptCommand(run, name) {
  return run === "yarn" ? `yarn ${name}` : `${run} run ${name}`;
}

function normalizeJavaVersion(value) {
  const version = String(value || "").trim();
  const legacy = version.match(/^1\.(\d+)$/);
  const major = Number(legacy?.[1] ?? version.match(/^\d+$/)?.[0]);
  if (!Number.isInteger(major) || major < 1) return null;
  // As imagens atuais do Maven/Temurin começam no JDK 8. O JDK 8 ainda
  // compila e executa projetos configurados para Java 6/7.
  return String(Math.max(8, major));
}

function dirname(path) {
  const index = path.lastIndexOf("/");
  return index === -1 ? "." : path.slice(0, index);
}

function relativeFiles(fileNames, directory) {
  const prefix = directory === "." ? "" : `${directory}/`;
  return fileNames.filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length));
}

function manifestCandidates(fileNames, name, preferredDirectories = []) {
  return fileNames
    .filter((path) => (path === name || path.endsWith(`/${name}`)) && !/(^|\/)(node_modules|dist|build|\.next|vendor)(\/|$)/.test(path))
    .sort((left, right) => {
      const leftDirectory = dirname(left);
      const rightDirectory = dirname(right);
      const leftPreference = leftDirectory === "." ? -1 : preferredDirectories.indexOf(leftDirectory.split("/")[0]);
      const rightPreference = rightDirectory === "." ? -1 : preferredDirectories.indexOf(rightDirectory.split("/")[0]);
      const leftScore = leftPreference >= 0 ? leftPreference : preferredDirectories.length + left.split("/").length;
      const rightScore = rightPreference >= 0 ? rightPreference : preferredDirectories.length + right.split("/").length;
      return leftScore - rightScore || left.localeCompare(right);
    });
}

function extensionCandidates(fileNames, extension, preferredDirectories = []) {
  const normalizedExtension = extension.toLowerCase();
  return fileNames
    .filter((file) => file.toLowerCase().endsWith(normalizedExtension) && !/(^|\/)(node_modules|dist|build|\.next|vendor|bin|obj)(\/|$)/i.test(file))
    .sort((left, right) => {
      const leftDirectory = dirname(left);
      const rightDirectory = dirname(right);
      const leftPreference = leftDirectory === "." ? -1 : preferredDirectories.indexOf(leftDirectory.split("/")[0]);
      const rightPreference = rightDirectory === "." ? -1 : preferredDirectories.indexOf(rightDirectory.split("/")[0]);
      const leftScore = leftPreference >= 0 ? leftPreference : preferredDirectories.length + left.split("/").length;
      const rightScore = rightPreference >= 0 ? rightPreference : preferredDirectories.length + right.split("/").length;
      return leftScore - rightScore || left.localeCompare(right);
    });
}

function commandInDirectory(command, directory) {
  if (!command || directory === ".") return command;
  if (command.startsWith(`(cd ${directory} && `)) return command;
  if (command.startsWith(`npm --prefix ${directory} `)) return command;
  if (command.startsWith(`pnpm --dir ${directory} `)) return command;
  if (command.startsWith(`yarn --cwd ${directory} `)) return command;
  if (command.startsWith("npm ")) return command.replace(/^npm /, `npm --prefix ${directory} `);
  if (command.startsWith("pnpm ")) return command.replace(/^pnpm /, `pnpm --dir ${directory} `);
  if (command.startsWith("yarn ")) return command.replace(/^yarn /, `yarn --cwd ${directory} `);
  return `(cd ${directory} && ${command})`;
}

export function applyWorkingDirectory(input, directory) {
  const normalizedDirectory = directory?.trim() || ".";
  if (normalizedDirectory === ".") return { ...input, workingDirectory: "." };
  const resolved = { ...input, workingDirectory: normalizedDirectory };
  for (const field of CONFIG_FIELDS.filter((field) => field !== "previewPort")) {
    if (input[field] != null) resolved[field] = commandInDirectory(input[field], normalizedDirectory);
  }
  return resolved;
}

function commandsInDirectory(commands, directory) {
  return Object.fromEntries(Object.entries(commands).map(([field, value]) => [field, field === "previewPort" ? value : commandInDirectory(value, directory)]));
}

function combineCommands(...commands) {
  const values = commands.filter(Boolean);
  return values.length ? [...new Set(values)].join(" && ") : null;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export function mavenBuildCommandInRepository(command, workingDirectory = ".") {
  const configured = String(command || "mvn -B -DskipTests package").trim();
  const scoped = configured.match(/^\(cd\s+.+?\s+&&\s+((?:\.\/)?mvn(?:w)?\s+.+)\)$/s);
  const invocation = scoped?.[1] ?? configured;
  if (!/^(?:\.\/)?mvn(?:w)?(?:\s|$)/.test(invocation) || /(?:^|\s)(?:-f|--file)(?:\s|=)/.test(invocation)) return configured;
  const preferredDirectory = shellQuote(workingDirectory || ".");
  return [
    `project_dir=${preferredDirectory}`,
    'if [ ! -f "$project_dir/pom.xml" ]; then pom="$(find . -type f -name pom.xml -not -path "*/target/*" -printf \'%d %p\\n\' | sort -n | head -n 1 | cut -d\' \' -f2-)"; project_dir="$(dirname "$pom")"; fi',
    'test -f "$project_dir/pom.xml"',
    'cd "$project_dir"',
    invocation,
  ].join("; ");
}

export function detectProjectRuntime({ fileNames, packageJson, requirements = "", pomXml = "", dotnetProject = "", composerJson }) {
  const files = new Set(fileNames.map((name) => name.toLowerCase()));
  const scripts = packageJson?.scripts ?? {};

  if (packageJson) {
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    const hasNodeConfiguration = Object.keys(dependencies).length > 0
      || ["dev", "start", "build", "test", "lint"].some((name) => String(scripts[name] ?? "").trim());
    // package.json também é usado por ferramentas auxiliares em projetos Java,
    // PHP e outras stacks. Sem dependências nem scripts executáveis, ele não é
    // evidência suficiente para instalar Node ou classificar o projeto como Node.
    if (!hasNodeConfiguration) {
      return { runtime: "UNKNOWN", commands: Object.fromEntries(CONFIG_FIELDS.map((field) => [field, null])) };
    }
    const runner = packageRunner(files);
    const result = {
      installCommand: runner.install,
      lintCommand: scripts.lint ? scriptCommand(runner.run, "lint") : null,
      testCommand: scripts.test && !String(scripts.test).includes("no test specified") ? scriptCommand(runner.run, "test") : null,
      buildCommand: scripts.build ? scriptCommand(runner.run, "build") : null,
      previewCommand: null,
      previewPort: null,
    };

    if (dependencies.next || scripts.dev?.includes("next")) {
      result.previewCommand = `${scriptCommand(runner.run, "dev")} -- --hostname 127.0.0.1 --port $PORT`;
      result.previewPort = 3000;
    } else if (dependencies.vite || scripts.dev?.includes("vite")) {
      result.previewCommand = `${scriptCommand(runner.run, "dev")} -- --host 127.0.0.1 --port $PORT`;
      result.previewPort = 5173;
    } else if (dependencies["react-scripts"] || scripts.start?.includes("react-scripts")) {
      result.previewCommand = `HOST=127.0.0.1 PORT=$PORT ${scriptCommand(runner.run, "start")}`;
      result.previewPort = 3000;
    } else if (scripts.dev) {
      result.previewCommand = scriptCommand(runner.run, "dev");
      result.previewPort = 3000;
    } else if (scripts.start) {
      result.previewCommand = scriptCommand(runner.run, "start");
      result.previewPort = 3000;
    }
    return { runtime: "NODE", commands: result };
  }

  if (files.has("manage.py")) {
    return { runtime: "PYTHON_DJANGO", commands: { installCommand: files.has("requirements.txt") ? "pip install -r requirements.txt" : null, lintCommand: null, testCommand: "python manage.py test", buildCommand: null, previewCommand: "python manage.py runserver 127.0.0.1:$PORT", previewPort: 8000 } };
  }
  if (files.has("requirements.txt") || files.has("pyproject.toml")) {
    const installCommand = files.has("requirements.txt") ? "pip install -r requirements.txt" : "pip install .";
    if (/fastapi|uvicorn/i.test(requirements)) return { runtime: "PYTHON_FASTAPI", commands: { installCommand, lintCommand: null, testCommand: files.has("pytest.ini") || files.has("tests") ? "pytest" : null, buildCommand: null, previewCommand: "uvicorn main:app --host 127.0.0.1 --port $PORT", previewPort: 8000 } };
    if (/flask/i.test(requirements) || files.has("app.py")) return { runtime: "PYTHON_FLASK", commands: { installCommand, lintCommand: null, testCommand: files.has("pytest.ini") || files.has("tests") ? "pytest" : null, buildCommand: null, previewCommand: "flask --app app run --host 127.0.0.1 --port $PORT", previewPort: 5000 } };
  }

  const dotnetProjectFile = fileNames.find((name) => name.toLowerCase().endsWith(".csproj"));
  if (dotnetProjectFile) {
    const targetMajor = dotnetProject.match(/<TargetFramework>\s*net(\d+)(?:\.|<)/i)?.[1] ?? "8";
    return {
      runtime: `DOTNET_${targetMajor}`,
      commands: {
        installCommand: "dotnet restore",
        lintCommand: null,
        testCommand: null,
        buildCommand: "dotnet build -c Release --no-restore",
        previewCommand: "dotnet run -c Release --no-build --no-launch-profile --urls http://127.0.0.1:$PORT",
        previewPort: 8080,
      },
    };
  }

  if (files.has("pom.xml")) {
    const spring = /spring-boot/i.test(pomXml);
    const war = /<packaging>\s*war\s*<\/packaging>/i.test(pomXml);
    const javaVersion = [
      /<java\.version>\s*(\d+(?:\.\d+)?)/i,
      /<maven\.compiler\.release>\s*(\d+(?:\.\d+)?)/i,
      /<maven\.compiler\.source>\s*(\d+(?:\.\d+)?)/i,
      /<maven\.compiler\.target>\s*(\d+(?:\.\d+)?)/i,
      /<release>\s*(\d+(?:\.\d+)?)/i,
      /<source>\s*(\d+(?:\.\d+)?)/i,
      /<target>\s*(\d+(?:\.\d+)?)/i,
    ].map((pattern) => normalizeJavaVersion(pomXml.match(pattern)?.[1])).find(Boolean);
    const runtime = javaVersion ? `JAVA_MAVEN_${javaVersion}` : "JAVA_MAVEN";
    return { runtime, commands: { installCommand: null, lintCommand: null, testCommand: "mvn -B test", buildCommand: "mvn -B -DskipTests package", previewCommand: spring ? "mvn spring-boot:run -Dspring-boot.run.arguments=--server.port=$PORT" : war ? "__MAVEN_WAR__" : null, previewPort: spring || war ? 8080 : null } };
  }
  if (files.has("gradlew") || files.has("build.gradle") || files.has("build.gradle.kts")) {
    const spring = files.has("src/main/resources/application.properties") || files.has("src/main/resources/application.yml");
    return { runtime: "JAVA_GRADLE", commands: { installCommand: null, lintCommand: null, testCommand: "./gradlew test", buildCommand: "./gradlew build -x test", previewCommand: spring ? "./gradlew bootRun --args='--server.port=$PORT'" : null, previewPort: spring ? 8080 : null } };
  }

  if (composerJson || files.has("composer.json") || files.has("index.php") || files.has("public/index.php")) {
    const documentRoot = files.has("public/index.php") ? " -t public" : "";
    return { runtime: "PHP", commands: { installCommand: composerJson ? "composer install --no-interaction" : null, lintCommand: null, testCommand: composerJson?.scripts?.test ? "composer test" : null, buildCommand: null, previewCommand: `php -S 127.0.0.1:$PORT${documentRoot}`, previewPort: 8000 } };
  }

  if (files.has("index.html")) {
    return { runtime: "STATIC", commands: { installCommand: null, lintCommand: null, testCommand: null, buildCommand: null, previewCommand: "python3 -m http.server $PORT --bind 127.0.0.1", previewPort: 3000 } };
  }

  return { runtime: "UNKNOWN", commands: Object.fromEntries(CONFIG_FIELDS.map((field) => [field, null])) };
}

function imageManagedCommands(previewPort = 8080) {
  return {
    installCommand: null,
    lintCommand: null,
    testCommand: null,
    buildCommand: null,
    previewCommand: "__IMAGE_CMD__",
    previewPort,
  };
}

function dockerfilePort(source) {
  const expose = String(source || "").match(/^\s*EXPOSE\s+(\d{2,5})(?:\/tcp)?\s*$/im)?.[1];
  const environment = String(source || "").match(/^\s*ENV\s+PORT(?:=|\s+)(\d{2,5})\s*$/im)?.[1];
  const port = Number(expose ?? environment ?? 8080);
  return port >= 1 && port <= 65535 ? port : 8080;
}

async function readRepositoryFile(token, repositoryFullName, branch, path) {
  try {
    const file = await githubRequest(token, `/repos/${repositoryFullName}/contents/${path}?ref=${encodeURIComponent(branch)}`);
    return file?.content ? Buffer.from(file.content, "base64").toString("utf8") : "";
  } catch {
    return "";
  }
}

export async function detectGitHubProjectRuntime(token, repositoryFullName, branch) {
  const tree = await githubRequest(token, `/repos/${repositoryFullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  const actualFileNames = (tree.tree ?? []).filter((entry) => entry.type === "blob").map((entry) => entry.path);
  const filesByNormalizedPath = new Map(actualFileNames.map((file) => [file.toLowerCase(), file]));
  const fileNames = [...filesByNormalizedPath.keys()];
  const wanted = [
    ...manifestCandidates(fileNames, "dockerfile"),
    ...manifestCandidates(fileNames, "package.json", ["frontend", "client", "web", "app"]),
    ...manifestCandidates(fileNames, "requirements.txt", ["backend", "api", "server"]),
    ...manifestCandidates(fileNames, "pyproject.toml", ["backend", "api", "server"]),
    ...extensionCandidates(fileNames, ".csproj", ["backend", "api", "server", "src"]),
    ...manifestCandidates(fileNames, "pom.xml", ["backend", "api", "server"]),
    ...manifestCandidates(fileNames, "composer.json", ["backend", "api", "server"]),
  ];
  const uniqueWanted = [...new Set(wanted)];
  const contents = Object.fromEntries(await Promise.all(uniqueWanted.map(async (path) => [
    path,
    await readRepositoryFile(token, repositoryFullName, branch, filesByNormalizedPath.get(path) ?? path),
  ])));
  return detectRepositoryRuntime({ fileNames, contents });
}

async function workspaceFiles(root, directory = "") {
  const ignoredDirectories = new Set([".git", ".forgeboard-venv", ".next", "build", "dist", "node_modules", "vendor"]);
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const relativePath = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await workspaceFiles(root, relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

export async function detectWorkspaceProjectRuntime(root) {
  const actualFiles = await workspaceFiles(root);
  const filesByNormalizedPath = new Map(actualFiles.map((file) => [file.toLowerCase(), file]));
  const fileNames = [...filesByNormalizedPath.keys()];
  const wanted = [
    ...manifestCandidates(fileNames, "dockerfile"),
    ...manifestCandidates(fileNames, "package.json", ["frontend", "client", "web", "app"]),
    ...manifestCandidates(fileNames, "requirements.txt", ["backend", "api", "server"]),
    ...manifestCandidates(fileNames, "pyproject.toml", ["backend", "api", "server"]),
    ...extensionCandidates(fileNames, ".csproj", ["backend", "api", "server", "src"]),
    ...manifestCandidates(fileNames, "pom.xml", ["backend", "api", "server"]),
    ...manifestCandidates(fileNames, "composer.json", ["backend", "api", "server"]),
  ];
  const contents = Object.fromEntries(await Promise.all([...new Set(wanted)].map(async (file) => {
    const actualFile = filesByNormalizedPath.get(file);
    return [file, actualFile ? await readFile(path.join(root, actualFile), "utf8") : ""];
  })));
  return detectRepositoryRuntime({ fileNames, contents });
}

export function detectRepositoryRuntime({ fileNames, contents }) {
  const parseJson = (value) => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
  if (fileNames.includes("dockerfile")) {
    return {
      runtime: "DOCKERFILE",
      workingDirectory: ".",
      commands: imageManagedCommands(dockerfilePort(contents.dockerfile)),
    };
  }
  const packagePath = manifestCandidates(fileNames, "package.json", ["frontend", "client", "web", "app"])[0];
  const pythonPath = manifestCandidates(fileNames, "requirements.txt", ["backend", "api", "server"])[0]
    ?? manifestCandidates(fileNames, "pyproject.toml", ["backend", "api", "server"])[0];
  const mavenPath = manifestCandidates(fileNames, "pom.xml", ["backend", "api", "server"])[0];
  const dotnetPath = extensionCandidates(fileNames, ".csproj", ["backend", "api", "server", "src"])[0];
  const packageDirectory = packagePath ? dirname(packagePath) : null;
  const pythonDirectory = pythonPath ? dirname(pythonPath) : null;
  const mavenDirectory = mavenPath ? dirname(mavenPath) : null;
  const dotnetDirectory = dotnetPath ? dirname(dotnetPath) : null;

  const dotnet = dotnetPath
    ? detectProjectRuntime({
        fileNames: relativeFiles(fileNames, dotnetDirectory),
        dotnetProject: contents[dotnetPath] ?? "",
      })
    : null;

  const node = packagePath
    ? detectProjectRuntime({ fileNames: relativeFiles(fileNames, packageDirectory), packageJson: parseJson(contents[packagePath]) })
    : null;
  const python = pythonPath
    ? detectProjectRuntime({
        fileNames: relativeFiles(fileNames, pythonDirectory),
        requirements: `${contents[pythonPath] ?? ""}\n${contents[`${pythonDirectory === "." ? "" : `${pythonDirectory}/`}pyproject.toml`] ?? ""}`,
      })
    : null;
  const maven = mavenPath
    ? detectProjectRuntime({
        fileNames: relativeFiles(fileNames, mavenDirectory),
        pomXml: contents[mavenPath] ?? "",
      })
    : null;

  // Um projeto ASP.NET Core é a aplicação principal mesmo quando a branch ainda
  // contém descritores residuais da stack anterior, como pom.xml ou index.html.
  if (dotnet && dotnet.runtime !== "UNKNOWN") {
    return { ...dotnet, workingDirectory: dotnetDirectory, commands: commandsInDirectory(dotnet.commands, dotnetDirectory) };
  }

  if (node && maven && node.runtime !== "UNKNOWN" && maven.runtime !== "UNKNOWN") {
    const nodeCommands = commandsInDirectory(node.commands, packageDirectory);
    const mavenCommands = commandsInDirectory(maven.commands, mavenDirectory);
    return {
      runtime: `MONOREPO_${maven.runtime}_${node.runtime}`,
      workingDirectory: ".",
      commands: {
        installCommand: combineCommands(mavenCommands.installCommand, nodeCommands.installCommand),
        lintCommand: combineCommands(mavenCommands.lintCommand, nodeCommands.lintCommand),
        testCommand: combineCommands(mavenCommands.testCommand, nodeCommands.testCommand),
        buildCommand: combineCommands(mavenCommands.buildCommand, nodeCommands.buildCommand),
        previewCommand: nodeCommands.previewCommand ?? mavenCommands.previewCommand,
        previewPort: nodeCommands.previewCommand ? nodeCommands.previewPort : mavenCommands.previewPort,
        auxiliaryPreviewCommand: nodeCommands.previewCommand ? mavenCommands.previewCommand : null,
        auxiliaryPreviewPort: nodeCommands.previewCommand ? mavenCommands.previewPort : null,
      },
    };
  }

  if (node && python && node.runtime !== "UNKNOWN" && python.runtime !== "UNKNOWN") {
    const nodeCommands = commandsInDirectory(node.commands, packageDirectory);
    const pythonCommands = commandsInDirectory(python.commands, pythonDirectory);
    return {
      runtime: `MONOREPO_${python.runtime}_${node.runtime}`,
      workingDirectory: ".",
      commands: {
        installCommand: combineCommands(pythonCommands.installCommand, nodeCommands.installCommand),
        lintCommand: combineCommands(pythonCommands.lintCommand, nodeCommands.lintCommand),
        testCommand: combineCommands(pythonCommands.testCommand, nodeCommands.testCommand),
        buildCommand: combineCommands(pythonCommands.buildCommand, nodeCommands.buildCommand),
        previewCommand: nodeCommands.previewCommand ?? pythonCommands.previewCommand,
        previewPort: nodeCommands.previewCommand ? nodeCommands.previewPort : pythonCommands.previewPort,
        auxiliaryPreviewCommand: nodeCommands.previewCommand ? pythonCommands.previewCommand : null,
        auxiliaryPreviewPort: nodeCommands.previewCommand ? pythonCommands.previewPort : null,
      },
    };
  }

  if (node && node.runtime !== "UNKNOWN") return { ...node, workingDirectory: packageDirectory, commands: commandsInDirectory(node.commands, packageDirectory) };
  if (python && python.runtime !== "UNKNOWN") return { ...python, workingDirectory: pythonDirectory, commands: commandsInDirectory(python.commands, pythonDirectory) };

  const rootComposer = manifestCandidates(fileNames, "composer.json", ["backend", "api", "server"])[0];
  const fallbackDirectory = mavenPath ? dirname(mavenPath) : rootComposer ? dirname(rootComposer) : ".";
  const fallback = detectProjectRuntime({
    fileNames: relativeFiles(fileNames, fallbackDirectory),
    pomXml: mavenPath ? contents[mavenPath] : "",
    composerJson: rootComposer ? parseJson(contents[rootComposer]) : null,
  });
  if (fallback.runtime !== "UNKNOWN") {
    return { ...fallback, workingDirectory: fallbackDirectory, commands: commandsInDirectory(fallback.commands, fallbackDirectory) };
  }
  return { runtime: "RAILPACK", workingDirectory: ".", commands: imageManagedCommands() };
}

export function configuredRuntime(input) {
  const commands = CONFIG_FIELDS
    .filter((field) => field !== "previewPort")
    .map((field) => input?.[field])
    .filter(Boolean)
    .join("\n");
  if (/\bdotnet\b/i.test(commands)) return "DOTNET";
  if (/(?:^|\s)(?:\.\/)?mvn(?:w)?(?:\s|$)/m.test(commands)) return "JAVA_MAVEN";
  if (/gradlew|bootRun/i.test(commands)) return "JAVA_GRADLE";
  if (/uvicorn/i.test(commands)) return "PYTHON_FASTAPI";
  if (/flask/i.test(commands)) return "PYTHON_FLASK";
  if (/manage\.py/i.test(commands)) return "PYTHON_DJANGO";
  if (/\bphp\b/i.test(commands)) return "PHP";
  if (/\b(?:npm|pnpm|yarn)\b/i.test(commands)) return "NODE";
  if (/python3?\s+-m\s+http\.server/i.test(commands)) return "STATIC";
  return null;
}

function runtimeFamily(runtime) {
  const value = String(runtime || "");
  if (value.startsWith("DOTNET_")) return "DOTNET";
  if (value.startsWith("JAVA_MAVEN_")) return "JAVA_MAVEN";
  return runtime;
}

export function applyDetectedRuntime(input, detected, { replaceExisting = false } = {}) {
  const resolved = { ...input };
  if (replaceExisting) {
    resolved.workingDirectory = detected.workingDirectory ?? ".";
    for (const field of CONFIG_FIELDS) resolved[field] = detected.commands[field] ?? null;
    return resolved;
  }
  for (const field of CONFIG_FIELDS.filter((field) => field !== "previewCommand" && field !== "previewPort")) {
    if (resolved[field] == null && detected.commands[field] != null) resolved[field] = detected.commands[field];
  }

  // Comando e porta formam uma única configuração. Quando o comando não foi
  // informado manualmente, use o par detectado completo para não persistir uma
  // porta padrão incompatível com o runtime (por exemplo, FastAPI na 8000).
  if (resolved.previewCommand == null && detected.commands.previewCommand != null) {
    resolved.previewCommand = detected.commands.previewCommand;
    resolved.previewPort = detected.commands.previewPort;
  } else if (resolved.previewCommand != null && resolved.previewPort == null && detected.commands.previewPort != null) {
    resolved.previewPort = detected.commands.previewPort;
  }

  return resolved;
}

export function environmentRuntimeConfiguration(input, detected) {
  // Ambientes são efêmeros e pertencem a uma branch específica. Portanto, os
  // comandos detectados nessa branch são a fonte de verdade; configurações
  // persistidas no projeto podem pertencer a outra versão ou stack.
  return applyDetectedRuntime(input, detected, { replaceExisting: true });
}

export function detectedRuntimeReplacesConfiguration(input, detected) {
  const current = configuredRuntime(input);
  return Boolean(current && runtimeFamily(current) !== runtimeFamily(detected.runtime));
}
