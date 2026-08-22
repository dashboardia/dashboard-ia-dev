const GITHUB_AUTHORIZATION_FAILURE = /permission to .* denied|requested url returned error:\s*403|github:\s*(?:resource not accessible|forbidden|not found)|github app não configurado|projeto sem instalação do github app/i;

export function isGitHubAuthorizationFailure(value) {
  return GITHUB_AUTHORIZATION_FAILURE.test(String(value ?? ""));
}

export function githubInstallationPublicationAccess(installation) {
  const permissions = installation?.permissions ?? {};
  const contentsPermission = String(permissions.contents ?? "").toLowerCase();
  const pullRequestsPermission = String(permissions.pull_requests ?? "").toLowerCase();
  return {
    canPublish: contentsPermission === "write" && pullRequestsPermission === "write",
    contentsPermission,
    pullRequestsPermission,
  };
}

export function installationRepositoryListIncludes(payload, repositoryFullName) {
  const expected = String(repositoryFullName ?? "").trim().toLowerCase();
  if (!expected) return false;
  const repositories = Array.isArray(payload?.repositories) ? payload.repositories : [];
  return repositories.some((repository) => String(repository?.full_name ?? "").trim().toLowerCase() === expected);
}
