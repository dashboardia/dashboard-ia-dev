import { describe, expect, it } from "vitest";

import { asaasCheckoutCustomerId, asaasCheckoutLookup } from "./asaas-webhook";

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

  it("recupera o cliente do checkout quando o Asaas envia string ou objeto", () => {
    expect(asaasCheckoutCustomerId({ checkout: { customer: "cus_123" } })).toBe("cus_123");
    expect(asaasCheckoutCustomerId({ checkout: { customer: { id: "cus_456" } } })).toBe("cus_456");
  });
});
