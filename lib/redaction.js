export function redactSensitiveData(value, secrets = []) {
  let redacted = String(value ?? "");
  for (const secret of secrets.filter(Boolean)) redacted = redacted.replaceAll(secret, "[REDACTED]");
  return redacted
    .replace(/(Authorization:\s*(?:Basic|Bearer)\s+)[^\s'\"]+/gi, "$1[REDACTED]")
    .replace(/(x-access-token:)[^\s@'\"]+/gi, "$1[REDACTED]");
}
