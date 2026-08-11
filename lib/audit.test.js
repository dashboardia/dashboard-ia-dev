import { describe, expect, it } from "vitest";

import { auditActionLabel, auditData, auditEntityHref } from "./audit";

describe("auditData", () => {
  it("registra o primeiro IP encaminhado sem expor cabeçalhos extras", () => {
    const request = new Request("https://forgeboard.test", { headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.1", "user-agent": "Vitest" } });
    expect(auditData({ actorId: "user-1", action: "auth.sign_in", entityType: "User", request })).toMatchObject({ ip: "203.0.113.10", userAgent: "Vitest" });
  });
});

describe("audit display", () => {
  it("traduz ações conhecidas e cria links apenas para entidades navegáveis", () => {
    expect(auditActionLabel("demand.approve")).toBe("Demanda aprovada");
    expect(auditActionLabel("custom.event")).toBe("custom.event");
    expect(auditEntityHref("Demand", "demand-1")).toBe("/demands/demand-1");
    expect(auditEntityHref("ProjectMember", "member-1")).toBeNull();
  });
});
