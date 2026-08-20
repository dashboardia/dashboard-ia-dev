const PROJECT_MARKERS = new Set([
  "package.json",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "requirements.txt",
  "pyproject.toml",
  "poetry.lock",
  "pipfile",
  "composer.json",
  "cargo.toml",
  "go.mod",
  "gemfile",
  "dockerfile",
]);

const SOURCE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sql",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
]);

const IGNORED_PREFIXES = [".github/", ".gitlab/", "docs/", "documentation/"];

export function isUsableProjectPath(value) {
  const path = String(value || "").replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
  if (!path || path.endsWith("/")) return false;
  if (IGNORED_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;
  const name = path.split("/").at(-1);
  if (PROJECT_MARKERS.has(name) || name.endsWith(".csproj") || name.endsWith(".sln")) return true;
  const extensionIndex = name.lastIndexOf(".");
  return extensionIndex >= 0 && SOURCE_EXTENSIONS.has(name.slice(extensionIndex));
}

export function repositoryHasUsableProject(paths) {
  return Array.from(paths || []).some(isUsableProjectPath);
}
