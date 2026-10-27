export type McpFailureCode = "auth" | "permission" | "arguments" | "throttled" | "timeout" | "unavailable" | "unknown";

// MCP error text is untrusted and may contain account data. Inspect it only to
// choose a fixed message; never return or log the original text.
export function classifyMcpFailure(error: unknown): McpFailureCode {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  if (/timed? out|timeout|deadline exceeded|aborted/i.test(message)) return "timeout";
  if (/rate.?limit|too many requests|throttl|\b429\b/i.test(message)) return "throttled";
  if (/permission|not authorized|insufficient scope|access denied|forbidden|\b403\b/i.test(message)) return "permission";
  if (/unauthorized|invalid token|expired token|access token|authentication|\b401\b/i.test(message)) return "auth";
  if (/invalid (?:argument|parameter|params|input)|missing required|validation|bad request|\b400\b/i.test(message)) return "arguments";
  if (/unavailable|connection|network|gateway|\b50[0234]\b/i.test(message)) return "unavailable";
  return "unknown";
}

export function mcpFailureMessage(code: McpFailureCode): string {
  switch (code) {
    case "auth": return "The ad connection needs to be reconnected. No account data was retrieved.";
    case "permission": return "The ad connection does not have permission for this request or account. No account data was retrieved.";
    case "arguments": return "The ad service rejected the tool inputs. Try a narrower request or another account.";
    case "throttled": return "The ad service is rate limiting requests. Please wait and try again.";
    case "timeout": return "The ad service did not respond in time. Please try again.";
    case "unavailable": return "The ad service is unavailable right now. Please try again later.";
    default: return "The ad service rejected the tool request. No account data was retrieved. Check the connection and try again.";
  }
}

export class McpToolsFailedError extends Error {
  readonly code: McpFailureCode;
  constructor(code: McpFailureCode) {
    super("MCP_TOOLS_FAILED");
    this.name = "McpToolsFailedError";
    this.code = code;
  }
}

export function primaryMcpFailure(codes: McpFailureCode[]): McpFailureCode {
  for (const code of ["auth", "permission", "throttled", "timeout", "unavailable", "arguments"] as const) {
    if (codes.includes(code)) return code;
  }
  return "unknown";
}
