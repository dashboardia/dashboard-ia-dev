const GITHUB_AUTHORIZATION_FAILURE = /permission to .* denied|requested url returned error:\s*403|github:\s*(?:resource not accessible|forbidden|not found)|github app não configurado|projeto sem instalação do github app/i;

export function isGitHubAuthorizationFailure(value) {
  return GITHUB_AUTHORIZATION_FAILURE.test(String(value ?? ""));
}
