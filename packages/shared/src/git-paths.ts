const SINGLE_CHAR_ESCAPES: Record<string, number> = {
  a: 0x07,
  b: 0x08,
  t: 0x09,
  n: 0x0a,
  v: 0x0b,
  f: 0x0c,
  r: 0x0d,
  "\\": 0x5c,
  '"': 0x22,
};

function pushUtf8(bytes: number[], value: string): void {
  for (const byte of new TextEncoder().encode(value)) {
    bytes.push(byte);
  }
}

/**
 * Decodes a git C-style quoted path (e.g. `"a/foo bar"` or
 * `"a/\346\265\213\350\257\225"`) into its raw filesystem path. Unquoted
 * inputs are returned unchanged.
 */
export function decodeGitPath(input: string): string {
  if (!input.startsWith('"')) {
    return input;
  }

  const body = input.endsWith('"') ? input.slice(1, -1) : input.slice(1);
  const bytes: number[] = [];

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char !== "\\") {
      pushUtf8(bytes, char);
      continue;
    }

    const next = body[index + 1];
    if (next === undefined) {
      bytes.push(0x5c);
      break;
    }

    if (next >= "0" && next <= "7") {
      let octal = "";
      let cursor = index + 1;
      while (
        cursor < body.length &&
        octal.length < 3 &&
        body[cursor] >= "0" &&
        body[cursor] <= "7"
      ) {
        octal += body[cursor];
        cursor += 1;
      }
      bytes.push(parseInt(octal, 8));
      index = cursor - 1;
      continue;
    }

    const escaped = SINGLE_CHAR_ESCAPES[next];
    if (escaped !== undefined) {
      bytes.push(escaped);
      index += 1;
      continue;
    }

    // Unknown escape: preserve it literally rather than silently dropping it.
    bytes.push(0x5c);
    pushUtf8(bytes, next);
    index += 1;
  }

  return new TextDecoder().decode(new Uint8Array(bytes));
}
