export function asaasCheckoutLookup(payload) {
  const providerCheckoutId = payload?.checkout?.id?.trim();
  const internalCheckoutId = payload?.checkout?.externalReference?.trim();
  const identifiers = [
    providerCheckoutId ? { providerCheckoutId } : null,
    internalCheckoutId ? { id: internalCheckoutId } : null,
  ].filter(Boolean);

  return identifiers.length ? { OR: identifiers } : null;
}

