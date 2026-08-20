import { describe, expect, it } from "vitest";

import { asaasSubscriptionIdentityFromPayments } from "./asaas";

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
});
