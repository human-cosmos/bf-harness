const patterns: Array<[string, RegExp]> = [
  ["Bearer token", /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi],
  [
    "Private key",
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi,
  ],
  [
    "AWS secret access key",
    /\b(?:AWS[_-]?SECRET[_-]?ACCESS[_-]?KEY|aws_secret_access_key)\s*[:=]\s*["']?[A-Za-z0-9/+=]{16,}["']?/gi,
  ],
  [
    "AWS access key",
    /\b(?:AWS[_-]?ACCESS[_-]?KEY[_-]?ID|aws_access_key_id)\s*[:=]\s*["']?[A-Z0-9]{16,}["']?/gi,
  ],
  ["AWS secret id", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  [
    "API key",
    /\b(?:api[_-]?key|apikey|access[_-]?token|secret[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9._-]{8,}["']?/gi,
  ],
  [
    "Password",
    /\b(?:password|passwd|pwd)\s*[:=]\s*["']?[^\r\n"']{4,}["']?/gi,
  ],
  [
    "Generic secret",
    /\b(?:secret|token|credential)s?\s*[:=]\s*["']?[^\r\n"']{4,}["']?/gi,
  ],
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
