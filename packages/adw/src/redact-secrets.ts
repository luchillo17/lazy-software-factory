/** Redact common credential shapes from operator-facing text. */
const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /gh[pousr]_[A-Za-z0-9_]{20,}/gi,
  /github_pat_[A-Za-z0-9_]{20,}/gi,
  /CURSOR_API_KEY\s*[=:]\s*\S+/gi,
  /GH_TOKEN\s*[=:]\s*\S+/gi,
  /api[_-]?key\s*[=:]\s*\S+/gi,
  /Bearer\s+[A-Za-z0-9._\-]+/gi,
  /x-access-token:[^\s@/]+/gi,
  /https?:\/\/[^\s/@:]+:[^\s/@]+@/gi,
];

export const redactSecrets = (text: string): string => {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
};
