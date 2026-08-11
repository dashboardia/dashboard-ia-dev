export function parsePage(value) {
  const page = Number.parseInt(String(value ?? "1"), 10);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function normalizeListQuery(value, maxLength = 100) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

export function paginationHref(basePath, params, page) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  });
  if (page > 1) search.set("page", String(page));
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}
