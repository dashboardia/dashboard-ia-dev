import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { githubPullRequestState, githubWebhookUrl, verifyGitHubWebhookSignature } from "./webhooks";

describe("verifyGitHubWebhookSignature", () => {
  it("aceita somente a assinatura HMAC correta", () => {
    const body = '{"action":"closed"}';
    const secret = "segredo-de-teste";
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

    expect(verifyGitHubWebhookSignature(body, signature, secret)).toBe(true);
    expect(verifyGitHubWebhookSignature(body, "sha256=incorreta", secret)).toBe(false);
    expect(verifyGitHubWebhookSignature(body, null, secret)).toBe(false);
  });
});

describe("githubPullRequestState", () => {
  it("marca demanda como concluida somente depois do merge", () => {
    expect(githubPullRequestState({ state: "closed", merged: true, merged_at: "2026-08-11T20:00:00Z" })).toMatchObject({
      pullRequestStatus: "MERGED",
      demandStatus: "SUCCEEDED",
    });
  });

  it("sincroniza PR aberto, draft e fechado", () => {
    expect(githubPullRequestState({ state: "open", draft: true }).pullRequestStatus).toBe("DRAFT");
    expect(githubPullRequestState({ state: "open", draft: false }).pullRequestStatus).toBe("OPEN");
    expect(githubPullRequestState({ state: "closed", merged: false })).toMatchObject({
      pullRequestStatus: "CLOSED",
      demandStatus: "CANCELLED",
    });
  });
});

describe("githubWebhookUrl", () => {
  it("gera a URL publica sem depender de barra final", () => {
    expect(githubWebhookUrl("https://forgeboard.example.com/base")).toBe("https://forgeboard.example.com/api/webhooks/github");
  });
});
