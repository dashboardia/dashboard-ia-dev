import { githubRequest } from "./github.js";

function baseName(value) {
  return String(value || "").replaceAll("\\", "/").split("/").at(-1)?.toLowerCase() ?? "";
}

export async function detectEnvironmentRuntimeLabel(token, repositoryFullName, branchName, detectedRuntime) {
  if (detectedRuntime && !["UNKNOWN", "RAILPACK"].includes(detectedRuntime)) return detectedRuntime;

  const tree = await githubRequest(token, `/repos/${repositoryFullName}/git/trees/${encodeURIComponent(branchName)}?recursive=1`);
  const files = (tree.tree ?? [])
    .filter((entry) => entry.type === "blob")
    .map((entry) => String(entry.path || "").replaceAll("\\", "/").toLowerCase());
  const names = new Set(files.map(baseName));

  if (names.has("gemfile")) return "RUBY";
  if (names.has("package.json")) return "NODE";
  if (files.some((file) => file.endsWith(".csproj"))) return "DOTNET";
  if (names.has("pom.xml")) return "JAVA_MAVEN";
  if (names.has("build.gradle") || names.has("build.gradle.kts") || names.has("gradlew")) return "JAVA_GRADLE";
  if (names.has("manage.py")) return "PYTHON_DJANGO";
  if (names.has("requirements.txt") || names.has("pyproject.toml")) return "PYTHON";
  if (names.has("composer.json") || names.has("index.php")) return "PHP";
  if (names.has("index.html")) return "STATIC";
  if (names.has("cargo.toml")) return "RUST";
  if (names.has("go.mod")) return "GO";

  return detectedRuntime === "RAILPACK" ? "AUTO" : (detectedRuntime || "AUTO");
}
