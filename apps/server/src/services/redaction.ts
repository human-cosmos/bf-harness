const patterns: Array<[string, RegExp]> = [
  ["Bearer token", /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi],
  ["API key", /\b(?:api[_-]?key|apikey|access[_-]?token)\s*[:=]\s*["']?[A-Za-z0-9._-]{8,}["']?/gi],
  ["Password", /\b(?:password|passwd|pwd)\s*[:=]\s*["']?[^\s"']{4,}["']?/gi],
  ["Private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi],
  ["AWS secret", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
];

export function redactSensitive(value: string): string {
  let output = value;
  for (const [label, pattern] of patterns) {
    output = output.replace(pattern, `[REDACTED:${label}]`);
  }
  return output;
}

export function redactObject<T>(value: T): T {
  if (typeof value === "string") {
    return redactSensitive(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactObject(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactObject(item)]),
    ) as T;
  }
  return value;
}
