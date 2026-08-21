function redactKnownSecrets(value, secrets) {
  return secrets
    .filter((secret) => typeof secret === "string" && secret.length >= 4)
    .sort((left, right) => right.length - left.length)
    .reduce((current, secret) => current.replaceAll(secret, "[REDACTED]"), value);
}

export function redactSensitiveData(value, secrets = []) {
  return redactKnownSecrets(String(value ?? ""), secrets)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]")
    .replace(/((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^:\s/]+:)[^@\s]+@/gi, "$1[REDACTED]@")
    .replace(/((?:Authorization|Proxy-Authorization):\s*(?:Basic|Bearer)\s+)[^\s'\"]+/gi, "$1[REDACTED]")
    .replace(/((?:Cookie|Set-Cookie):\s*)[^\r\n]+/gi, "$1[REDACTED]")
    .replace(/((?:x-access-token|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd)\s*[:=]\s*)[^\s,'\";]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:access_token|refresh_token|token|api_key|secret|password)=)[^&#\s]+/gi, "$1[REDACTED]");
}
