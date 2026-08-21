const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const EXEMPT_PATH_PREFIXES = ["/api/auth", "/api/webhooks"];

function header(request, name) {
  return request.headers?.get?.(name) ?? null;
}

export function expectedRequestOrigins(request) {
  const requestUrl = new URL(request.url);
  const origins = new Set([requestUrl.origin]);
  const forwardedHost = header(request, "x-forwarded-host");
  const forwardedProto = header(request, "x-forwarded-proto");
  if (forwardedHost && forwardedProto) origins.add(`${forwardedProto}://${forwardedHost}`);
  return origins;
}

export function isRequestSecurityExempt(request) {
  const pathname = new URL(request.url).pathname;
  return EXEMPT_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function mutationRequestAllowed(request) {
  const method = String(request.method ?? "GET").toUpperCase();
  if (SAFE_METHODS.has(method) || isRequestSecurityExempt(request)) return true;

  const origin = header(request, "origin");
  if (origin && !expectedRequestOrigins(request).has(origin)) return false;

  const fetchSite = header(request, "sec-fetch-site");
  if (!origin && ["cross-site", "same-site"].includes(fetchSite)) return false;

  return true;
}
