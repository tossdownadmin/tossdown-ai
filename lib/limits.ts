export const LIMITS = { maxRequestBytes: 32_000, maxMessages: 24, maxMessageChars: 8_000, maxOutputTokens: 2_000 } as const;
export function validateMessages(input: unknown) {
  if (!Array.isArray(input) || input.length === 0 || input.length > LIMITS.maxMessages) return "Send between 1 and 24 messages.";
  for (const message of input) {
    if (!message || typeof message !== "object" || !["user","assistant"].includes((message as {role?: string}).role ?? "") || typeof (message as {content?: unknown}).content !== "string") return "Each message must have a valid role and text.";
    if (!(message as {content: string}).content.trim() || (message as {content: string}).content.length > LIMITS.maxMessageChars) return "Messages must be non-empty and under 8,000 characters.";
  }
  return null;
}
