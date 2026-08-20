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

export function detectProjectRuntime({ fileNames, packageJson, requirements = "", pomXml = "", composerJson }) {
  const files = new Set(fileNames.map((name) => name.toLowerCase()));
  const scripts = packageJson?.scripts ?? {};

  if (packageJson) {
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
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

  if (files.has("pom.xml")) {
    const spring = /spring-boot/i.test(pomXml);
    return { runtime: "JAVA_MAVEN", commands: { installCommand: null, lintCommand: null, testCommand: "mvn -B test", buildCommand: "mvn -B -DskipTests package", previewCommand: spring ? "mvn spring-boot:run -Dspring-boot.run.arguments=--server.port=$PORT" : null, previewPort: spring ? 8080 : null } };
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
  const fileNames = (tree.tree ?? []).filter((entry) => entry.type === "blob").map((entry) => entry.path.toLowerCase());
  const wanted = [
    ...manifestCandidates(fileNames, "package.json", ["frontend", "client", "web", "app"]),
    ...manifestCandidates(fileNames, "requirements.txt", ["backend", "api", "server"]),
    ...manifestCandidates(fileNames, "pyproject.toml", ["backend", "api", "server"]),
    ...manifestCandidates(fileNames, "pom.xml", ["backend", "api", "server"]),
    ...manifestCandidates(fileNames, "composer.json", ["backend", "api", "server"]),
  ];
  const uniqueWanted = [...new Set(wanted)];
  const contents = Object.fromEntries(await Promise.all(uniqueWanted.map(async (path) => [path, await readRepositoryFile(token, repositoryFullName, branch, path)])));
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
    ...manifestCandidates(fileNames, "package.json", ["frontend", "client", "web", "app"]),
    ...manifestCandidates(fileNames, "requirements.txt", ["backend", "api", "server"]),
    ...manifestCandidates(fileNames, "pyproject.toml", ["backend", "api", "server"]),
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
  const packagePath = manifestCandidates(fileNames, "package.json", ["frontend", "client", "web", "app"])[0];
  const pythonPath = manifestCandidates(fileNames, "requirements.txt", ["backend", "api", "server"])[0]
    ?? manifestCandidates(fileNames, "pyproject.toml", ["backend", "api", "server"])[0];
  const packageDirectory = packagePath ? dirname(packagePath) : null;
  const pythonDirectory = pythonPath ? dirname(pythonPath) : null;

  const node = packagePath
    ? detectProjectRuntime({ fileNames: relativeFiles(fileNames, packageDirectory), packageJson: parseJson(contents[packagePath]) })
    : null;
  const python = pythonPath
    ? detectProjectRuntime({
        fileNames: relativeFiles(fileNames, pythonDirectory),
        requirements: `${contents[pythonPath] ?? ""}\n${contents[`${pythonDirectory === "." ? "" : `${pythonDirectory}/`}pyproject.toml`] ?? ""}`,
      })
    : null;

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

  const rootPom = manifestCandidates(fileNames, "pom.xml", ["backend", "api", "server"])[0];
  const rootComposer = manifestCandidates(fileNames, "composer.json", ["backend", "api", "server"])[0];
  const fallbackDirectory = rootPom ? dirname(rootPom) : rootComposer ? dirname(rootComposer) : ".";
  const fallback = detectProjectRuntime({
    fileNames: relativeFiles(fileNames, fallbackDirectory),
    pomXml: rootPom ? contents[rootPom] : "",
    composerJson: rootComposer ? parseJson(contents[rootComposer]) : null,
  });
  return { ...fallback, workingDirectory: fallbackDirectory, commands: commandsInDirectory(fallback.commands, fallbackDirectory) };
}

export function applyDetectedRuntime(input, detected) {
  const resolved = { ...input };
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
