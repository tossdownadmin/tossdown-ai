import { describe, expect, it, vi } from "vitest";
import * as metaDirect from "./meta-direct";
import * as metaAudit from "./meta-audit";
import { campaignProposalEvent, directMetaToolDefinitions, dispatchDirectMetaTool, normalizeAssistantContent, parseToolUseInput, structuralDiagnostics, toBedrockToolResult } from "./bedrock";

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

  it("removes empty streamed text and incomplete tool blocks before continuation", () => {
    expect(normalizeAssistantContent([{ text: "" }, { toolUse: { name: "meta_list_ad_accounts", input: "{}" } }, { toolUse: { toolUseId: "u1", name: "meta_list_ad_accounts", input: "{}" } }])).toEqual([{ toolUse: { toolUseId: "u1", name: "meta_list_ad_accounts", input: {} } }]);
  });

  it("dispatches the direct preparation tool and emits an approval proposal event", async () => {
    const proposal = { ok: true as const, approvalId: "00000000-0000-0000-0000-000000000001" as `${string}-${string}-${string}-${string}-${string}`, expiresInSeconds: 300, args: { accountId: "780400040884747", name: "Test Campaign", objective: "OUTCOME_SALES", specialAdCategories: [] as string[] } };
    const prepare = vi.spyOn(metaDirect, "prepareDirectCampaign").mockResolvedValue(proposal);
    const tool = directMetaToolDefinitions("employee@tossdown.com").find(candidate => candidate.name === "meta_prepare_campaign");
    expect(tool).toBeDefined();
    const result = await dispatchDirectMetaTool(tool!, proposal.args);
    expect(prepare).toHaveBeenCalledWith("employee@tossdown.com", proposal.args);
    expect(campaignProposalEvent(result as typeof proposal)).toMatchObject({ type: "campaign_proposal", status: "awaiting_approval", approvalId: proposal.approvalId, args: proposal.args });
    prepare.mockRestore();
  });

  it("binds a shared audit to the server-selected account, not model arguments", async () => {
    const audit = vi.spyOn(metaAudit, "auditSelectedMetaAccount").mockResolvedValue({ ok: true, account: { id: "act_123" } } as never);
    const selected = directMetaToolDefinitions("colleague@tossdown.com", "act_123").find(tool => tool.name === "meta_audit_selected_account");
    expect(selected?.inputSchema).toEqual({ type: "object", properties: {} });
    await dispatchDirectMetaTool(selected!, { accountId: "act_999" });
    expect(audit).toHaveBeenCalledWith("act_123");
    expect(directMetaToolDefinitions("colleague@tossdown.com", "not-an-account").some(tool => tool.name === "meta_audit_selected_account")).toBe(false);
    audit.mockRestore();
  });
});
