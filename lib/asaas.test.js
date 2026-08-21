import { describe, expect, it } from "vitest";

import { ASAAS_CHECKOUT_EXPIRATION_MINUTES, asaasSubscriptionIdentityFromPayments } from "./asaas";

describe("conciliação de assinatura do Asaas", () => {
  it("recupera cliente e assinatura a partir do pagamento do checkout", () => {
    expect(asaasSubscriptionIdentityFromPayments([
      { id: "pay_1", customer: "cus_1", subscription: "sub_1" },
    ])).toEqual({ customerId: "cus_1", subscriptionId: "sub_1" });
  });

  it("recusa um checkout associado a assinaturas diferentes", () => {
    expect(() => asaasSubscriptionIdentityFromPayments([
      { id: "pay_1", customer: "cus_1", subscription: "sub_1" },
      { id: "pay_2", customer: "cus_1", subscription: "sub_2" },
    ])).toThrow("mais de uma assinatura");
  });

  it("mantém o checkout curto para liberar rapidamente uma compra abandonada", () => {
    expect(ASAAS_CHECKOUT_EXPIRATION_MINUTES).toBe(10);
  });
});
