const blockedKeys = new Set(["password", "password_hash", "token", "secret", "public_check_token", "public_check_token_hash"]);

export function redact(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, blockedKeys.has(key) ? "[REDACTED]" : redact(entry)])
  );
}

export function redactedLogPayload(message: string, payload: unknown): { message: string; payload: unknown } {
  return { message, payload: redact(payload) };
}
