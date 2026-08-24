import { describe, expect, it } from "vitest";

import { operationalAccessAllowed, publicExecutionAccessEnabled } from "./operational-access";

const baseConfiguration = {
  BETA_ALLOWED_GITHUB_LOGINS: undefined,
  PUBLIC_EXECUTIONS_ENABLED: false,
  EXECUTION_ISOLATION_MODE: "trusted-worker",
};

describe("operational access", () => {
  it("sempre permite o administrador", () => {
    expect(operationalAccessAllowed({ globalRole: "ADMIN", githubLogin: "dashboardia" }, baseConfiguration)).toBe(true);
  });

  it("permite somente logins explicitamente liberados no beta", () => {
    const configuration = { ...baseConfiguration, BETA_ALLOWED_GITHUB_LOGINS: "camila-dev, outro-usuario" };
    expect(operationalAccessAllowed({ globalRole: "USER", githubLogin: " Camila-Dev " }, configuration)).toBe(true);
    expect(operationalAccessAllowed({ globalRole: "USER", githubLogin: "desconhecido" }, configuration)).toBe(false);
  });

  it("não libera o público enquanto o worker ainda é confiável", () => {
    const configuration = { ...baseConfiguration, PUBLIC_EXECUTIONS_ENABLED: true };
    expect(publicExecutionAccessEnabled(configuration)).toBe(false);
    expect(operationalAccessAllowed({ globalRole: "USER", githubLogin: "qualquer" }, configuration)).toBe(false);
  });

  it("libera o público apenas com isolamento por container", () => {
    const configuration = {
      ...baseConfiguration,
      PUBLIC_EXECUTIONS_ENABLED: true,
      EXECUTION_ISOLATION_MODE: "isolated-container",
    };
    expect(publicExecutionAccessEnabled(configuration)).toBe(true);
    expect(operationalAccessAllowed({ globalRole: "USER", githubLogin: "qualquer" }, configuration, true)).toBe(true);
  });
});
