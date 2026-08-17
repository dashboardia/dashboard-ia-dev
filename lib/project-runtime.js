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
  const wanted = ["package.json", "requirements.txt", "pyproject.toml", "pom.xml", "composer.json"];
  const contents = Object.fromEntries(await Promise.all(wanted.map(async (path) => [path, fileNames.includes(path) ? await readRepositoryFile(token, repositoryFullName, branch, path) : ""])));
  const parseJson = (value) => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
  return detectProjectRuntime({ fileNames, packageJson: parseJson(contents["package.json"]), requirements: `${contents["requirements.txt"]}\n${contents["pyproject.toml"]}`, pomXml: contents["pom.xml"], composerJson: parseJson(contents["composer.json"]) });
}

export function applyDetectedRuntime(input, detected) {
  const resolved = { ...input };
  for (const field of CONFIG_FIELDS) {
    if (resolved[field] == null && detected.commands[field] != null) resolved[field] = detected.commands[field];
  }
  return resolved;
}
