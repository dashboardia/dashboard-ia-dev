export function asaasCheckoutLookup(payload) {
  const providerCheckoutId = payload?.checkout?.id?.trim();
  const internalCheckoutId = payload?.checkout?.externalReference?.trim();
  const identifiers = [
    providerCheckoutId ? { providerCheckoutId } : null,
    internalCheckoutId ? { id: internalCheckoutId } : null,
  ].filter(Boolean);

  return identifiers.length ? { OR: identifiers } : null;
}

export function asaasCheckoutCustomerId(payload) {
  const customer = payload?.checkout?.customer ?? payload?.payment?.customer ?? null;
  if (typeof customer === "string") return customer.trim() || null;
  if (customer && typeof customer === "object") {
    const id = customer.id ?? customer.customer ?? null;
    return id == null ? null : String(id).trim() || null;
  }
  return null;
}

