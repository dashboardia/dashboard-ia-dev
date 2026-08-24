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
  const installationId = Array.isArray(params?.installation_id) ? params.installation_id[0] : params?.installation_id;
  const setupAction = Array.isArray(params?.setup_action) ? params.setup_action[0] : params?.setup_action;
  const returningFromRepositoryAuthorization = Boolean(installationId)
    || ["install", "update"].includes(String(setupAction ?? "").toLowerCase());
  if (!returningFromRepositoryAuthorization) return "/";
  return safeInternalReturnPath(params?.state ?? rememberedPath, "/");
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
