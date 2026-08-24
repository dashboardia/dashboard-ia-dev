import { describe, expect, it } from "vitest";

import { formatExecutionDuration } from "./execution-duration";

describe("execution duration", () => {
  it("formata uma execução ainda não iniciada", () => {
    expect(formatExecutionDuration(null)).toBe("Não iniciada");
  });

  it("usa o relógio atual enquanto a execução está ativa", () => {
    expect(formatExecutionDuration("2026-08-24T12:00:00.000Z", null, "2026-08-24T12:07:12.000Z")).toBe("7min 12s");
  });

  it("congela a duração quando existe término", () => {
    expect(formatExecutionDuration("2026-08-24T12:00:00.000Z", "2026-08-24T12:00:31.000Z", "2026-08-24T13:00:00.000Z")).toBe("31s");
  });
});
