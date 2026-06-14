const LIMIT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(insufficient[_\s-]?quota|quota\s+exceeded|resource[_\s-]?exhausted)\b/i, reason: "provider quota exhausted" },
  { pattern: /\b(credits?|billing|spend(?:ing)?\s+limit|hard\s+limit|monthly\s+budget)\b/i, reason: "provider billing/token budget exhausted" },
  { pattern: /\b(rate\s*limit|too\s+many\s+requests|\b429\b)\b/i, reason: "provider rate/token limit reached" },
  { pattern: /\b(context\s+(?:length|window|limit)|maximum\s+context|context_length_exceeded)\b/i, reason: "context window exhausted" },
  { pattern: /\b(prompt|input|request)\b[\s\S]{0,80}\b(too\s+long|exceed(?:s|ed)?|larger\s+than|over\s+the\s+limit)\b/i, reason: "prompt/input token limit exceeded" },
  { pattern: /\b(tokens?|token\s+limit|max(?:imum)?\s+tokens?)\b[\s\S]{0,80}\b(exceed(?:s|ed)?|too\s+long|reached|exhausted|over\s+the\s+limit)\b/i, reason: "token limit exceeded" },
];

const TRUNCATION_MARKERS = [
  /…\s*\[\s*truncated/i,
  /\.\.\.\s*\[\s*truncated/i,
  /\[\s*truncated(?::|\])/i,
  /\btruncated:\s+/i,
  /\boutput\s+truncated\b/i,
  /<\s*truncated\s*>/i,
];

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => {
    if (block && typeof block === "object" && "text" in block && typeof block.text === "string") return block.text;
    if (block && typeof block === "object" && "thinking" in block && typeof block.thinking === "string") return block.thinking;
    return "";
  }).filter(Boolean).join("\n");
}

export function limitExhaustionReason(text: string): string | null {
  for (const { pattern, reason } of LIMIT_PATTERNS) {
    if (pattern.test(text)) return reason;
  }
  return null;
}

export function assistantLimitExhaustionReason(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const record = message as Record<string, unknown>;
  if (record.role !== "assistant") return null;
  const errorText = [
    typeof record.stopReason === "string" ? record.stopReason : "",
    typeof record.errorMessage === "string" ? record.errorMessage : "",
    textFromContent(record.content),
  ].filter(Boolean).join("\n");
  if (!errorText) return null;
  return limitExhaustionReason(errorText);
}

export function containsTruncationMarker(text: string): boolean {
  return TRUNCATION_MARKERS.some((pattern) => pattern.test(text));
}
