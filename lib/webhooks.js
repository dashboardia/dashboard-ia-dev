import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyGitHubWebhookSignature(body, signature, secret) {
  if (!secret || !signature?.startsWith("sha256=")) return false;

  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function githubPullRequestState(pullRequest) {
  if (pullRequest.merged === true || pullRequest.merged_at) {
    return {
      pullRequestStatus: "MERGED",
      demandStatus: "SUCCEEDED",
      mergedAt: pullRequest.merged_at ? new Date(pullRequest.merged_at) : new Date(),
    };
  }

  if (pullRequest.state === "closed") {
    return { pullRequestStatus: "CLOSED", demandStatus: "CANCELLED", mergedAt: null };
  }

  return {
    pullRequestStatus: pullRequest.draft ? "DRAFT" : "OPEN",
    demandStatus: "REVIEW",
    mergedAt: null,
  };
}

export function githubWebhookUrl(applicationUrl) {
  return new URL("/api/webhooks/github", applicationUrl).toString();
}

export function isGitHubWebhookConfirmed(project) {
  return Boolean(project.githubWebhookId || project.githubWebhookAt);
}
