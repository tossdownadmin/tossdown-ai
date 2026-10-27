import { describe, expect, it } from "vitest";
import { classifyMcpFailure, mcpFailureMessage, primaryMcpFailure } from "./mcp-failure";

describe("safe MCP failure classification", () => {
  it("classifies common failures without including untrusted details in the message", () => {
    expect(classifyMcpFailure("Permission denied for act_123 with token abc")).toBe("permission");
    expect(classifyMcpFailure(new Error("MCP request timed out"))).toBe("timeout");
    expect(classifyMcpFailure("429 rate limit for account 123")).toBe("throttled");
    expect(classifyMcpFailure("unexpected account 123 secret abc")).toBe("unknown");
    expect(mcpFailureMessage("permission")).not.toMatch(/act_123|token abc/);
    expect(primaryMcpFailure(["unknown", "permission"])).toBe("permission");
  });
});
