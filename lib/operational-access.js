import { AccessDeniedError, requireUser } from "./access.js";
import { env } from "./env.js";

function normalizedGitHubLogins(value) {
  return new Set(String(value ?? "")
    .split(",")
    .map((login) => login.trim().toLowerCase())
    .filter(Boolean));
}

export function publicExecutionAccessEnabled(configuration = env) {
  return configuration.PUBLIC_EXECUTIONS_ENABLED === true
    && configuration.EXECUTION_ISOLATION_MODE === "isolated-container";
}

export function operationalAccessAllowed(user, configuration = env) {
  if (!user) return false;
  if (user.globalRole === "ADMIN") return true;
  if (publicExecutionAccessEnabled(configuration)) return true;

  const githubLogin = user.githubLogin?.trim().toLowerCase();
  return Boolean(githubLogin && normalizedGitHubLogins(configuration.BETA_ALLOWED_GITHUB_LOGINS).has(githubLogin));
}

export function assertOperationalAccess(user, configuration = env) {
  if (operationalAccessAllowed(user, configuration)) return user;

  const publicReleaseWasRequested = configuration.PUBLIC_EXECUTIONS_ENABLED === true
    && configuration.EXECUTION_ISOLATION_MODE !== "isolated-container";
  throw new AccessDeniedError(
    publicReleaseWasRequested
      ? "Execuções públicas permanecem bloqueadas até o isolamento por container estar ativo"
      : "Esta funcionalidade está disponível somente para o beta fechado do Dashboard IA",
    403,
  );
}

export async function requireOperationalUser() {
  return assertOperationalAccess(await requireUser());
}
