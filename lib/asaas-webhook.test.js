import { describe, expect, it } from "vitest";

import { asaasCheckoutLookup } from "./asaas-webhook";

describe("asaasCheckoutLookup", () => {
  it("concilia o checkout pelo identificador do Asaas ou pela referencia interna", () => {
    expect(asaasCheckoutLookup({
      checkout: {
        id: "checkout-asaas",
        externalReference: "checkout-interno",
      },
    })).toEqual({
      OR: [
        { providerCheckoutId: "checkout-asaas" },
        { id: "checkout-interno" },
      ],
    });
  });

  it("rejeita payload sem identificadores de checkout", () => {
    expect(asaasCheckoutLookup({ checkout: {} })).toBeNull();
  });
});

