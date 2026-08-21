import { AccessDeniedError, requireUser } from "./access.js";
import { db } from "./db.js";
import { env } from "./env.js";
import { getPublicOperationalAccessEnabled } from "./public-operational-access.js";

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

function betaAccessAllowed(user, configuration = env) {
  const githubLogin = user?.githubLogin?.trim().toLowerCase();
  return Boolean(githubLogin && normalizedGitHubLogins(configuration.BETA_ALLOWED_GITHUB_LOGINS).has(githubLogin));
}

export function operationalAccessAllowed(user, configuration = env, publicOperationalAccessEnabled = false) {
  if (!user) return false;
  if (user.globalRole === "ADMIN") return true;
  if (betaAccessAllowed(user, configuration)) return true;
  return publicExecutionAccessEnabled(configuration) && publicOperationalAccessEnabled;
}

export async function assertOperationalAccess(user, configuration = env, database = db) {
  if (!user) throw new AccessDeniedError("Usuário não autenticado", 401);
  if (user.globalRole === "ADMIN" || betaAccessAllowed(user, configuration)) return user;

  if (!publicExecutionAccessEnabled(configuration)) {
    throw new AccessDeniedError(
      configuration.PUBLIC_EXECUTIONS_ENABLED === true
        ? "Execuções públicas permanecem bloqueadas até o isolamento por container estar ativo"
        : "Execuções e ambientes para clientes estão desativados na infraestrutura",
      403,
    );
  }

  const publicOperationalAccessEnabled = await getPublicOperationalAccessEnabled(database);
  if (publicOperationalAccessEnabled) return user;

  throw new AccessDeniedError("Execuções e ambientes estão temporariamente desativados pelo administrador da plataforma", 403);
}

export async function requireOperationalUser() {
  return assertOperationalAccess(await requireUser());
}
