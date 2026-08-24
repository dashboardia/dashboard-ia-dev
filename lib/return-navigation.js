export const RETURN_PATH_COOKIE = "dashboardia_return_path";

export function safeInternalReturnPath(value, fallback = "/") {
  const raw = String(value ?? "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  try {
    const parsed = new URL(raw, "https://dashboardia.local");
    if (parsed.origin !== "https://dashboardia.local") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function loginReturnPath(params = {}, rememberedPath = null) {
  return repositoryAuthorizationReturnPath(params, rememberedPath) ?? "/";
}

export function repositoryAuthorizationReturnPath(params = {}, rememberedPath = null, { allowRemembered = false } = {}) {
  const installationId = Array.isArray(params?.installation_id) ? params.installation_id[0] : params?.installation_id;
  const setupAction = Array.isArray(params?.setup_action) ? params.setup_action[0] : params?.setup_action;
  const returningFromRepositoryAuthorization = Boolean(installationId)
    || ["install", "update"].includes(String(setupAction ?? "").toLowerCase());
  if (!returningFromRepositoryAuthorization && !allowRemembered) return null;
  const target = params?.state ?? rememberedPath;
  if (!target) return null;
  return safeInternalReturnPath(target, null);
}

export function withReturnState(target, returnPath) {
  if (!target) return target;
  try {
    const url = new URL(target);
    url.searchParams.set("state", safeInternalReturnPath(returnPath));
    return url.toString();
  } catch {
    return target;
  }
}

export function rememberReturnPath(returnPath) {
  if (typeof document === "undefined") return;
  const safePath = safeInternalReturnPath(returnPath);
  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${RETURN_PATH_COOKIE}=${encodeURIComponent(safePath)}; Path=/; Max-Age=900; SameSite=Lax${secure}`;
}

export function clearRememberedReturnPath() {
  if (typeof document === "undefined") return;
  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${RETURN_PATH_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

export function decodeRememberedReturnPath(value) {
  if (!value) return null;
  try { return decodeURIComponent(value); } catch { return value; }
}
