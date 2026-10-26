import { describe, expect, it } from "vitest";
import { parseToolUseInput, structuralDiagnostics, toBedrockToolResult } from "./bedrock";

describe("Bedrock tool-result continuation", () => {
  it("preserves the matching toolUseId and converts successful MCP content", () => {
    const result = toBedrockToolResult("toolu-123", { content: [{ type: "text", text: "Account list" }] });
    expect(result).toEqual({ toolResult: { toolUseId: "toolu-123", status: "success", content: [{ text: "Account list" }] } });
  });

  it("marks MCP isError results as Bedrock errors", () => {
    const result = toBedrockToolResult("toolu-456", { isError: true, content: [{ type: "text", text: "MCP rejected the request" }] });
    expect(result.toolResult.toolUseId).toBe("toolu-456");
    expect(result.toolResult.status).toBe("error");
  });

  it("parses streamed tool input and diagnoses structural pairing without values", () => {
    expect(parseToolUseInput('{"customer_id":"123"}')).toEqual({ customer_id: "123" });
    expect(structuralDiagnostics([{ role: "assistant", content: [{ toolUse: { toolUseId: "u1" } }] }, { role: "user", content: [{ toolResult: { toolUseId: "u1" } }] }])).toMatchObject({ toolUseCount: 1, toolResultCount: 1, toolUseIdsPresent: true, toolResultIdsPresent: true, toolUseToolResultCountsMatch: true, toolUseResultIdsMatch: true });
  });
});
