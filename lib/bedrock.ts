import { BedrockRuntimeClient, ConverseStreamCommand, type ConverseStreamCommandInput } from "@aws-sdk/client-bedrock-runtime";
import { fromStatic } from "@aws-sdk/token-providers";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { LIMITS } from "./limits";
import { callTool, type McpTool } from "./mcp";
import { prepareDirectCampaign } from "./meta-direct";
import { auditSelectedMetaAccount, validMetaAccountId } from "./meta-audit";
import { listSharedMetaAccounts } from "./meta-accounts";
import { classifyMcpFailure, McpToolsFailedError, mcpFailureMessage, primaryMcpFailure, type McpFailureCode } from "./mcp-failure";

const system = "You are tossdown AI, an internal marketing assistant for tossdown employees. Be practical, clear, and honest. Help with ads, creative briefs, plans, and analysis. Do not claim access to live campaign data unless it is provided in the conversation. Keep recommendations concise and structured.";
const MAX_TURNS = 4;
const client = () => { const region = process.env.AWS_REGION || "eu-north-1"; const bearerToken = process.env.AWS_BEARER_TOKEN_BEDROCK; if (bearerToken) return new BedrockRuntimeClient({ region, token: fromStatic({ token: { token: bearerToken } }) }); return new BedrockRuntimeClient({ region, ...(process.env.AWS_ROLE_ARN ? { credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }) } : {}) }); };
type InputMessage = { role: "user" | "assistant"; content: string };
export type BedrockEvent = { type: "text"; text: string } | { type: "tool_start"; name: string } | { type: "tool_result"; name: string; ok: boolean; failureCode?: McpFailureCode } | { type: "campaign_proposal"; status: "awaiting_approval" | "needs_details"; approvalId?: string; expiresInSeconds?: number; args?: Record<string, unknown>; missing?: string[]; accounts?: Array<{ id: string; name?: string }> };
export type ServerTool = { name: string; description: string; inputSchema: Record<string, unknown>; kind: "direct_meta"; user: string; accountId?: string };
export type BedrockTool = McpTool | ServerTool;
export function directMetaToolDefinitions(user: string, selectedAccountId = ""): ServerTool[] { return [
  { name: "meta_list_ad_accounts", description: "List accounts accessible to the shared Meta system-user token. Read-only.", inputSchema: { type: "object", properties: {} }, kind: "direct_meta", user },
  ...(validMetaAccountId(selectedAccountId) ? [{ name: "meta_audit_selected_account", description: "Read campaign structure and last 30 days of campaign-level performance for the account selected by the employee. Read-only; account is bound server-side. Results may be truncated.", inputSchema: { type: "object", properties: {} }, kind: "direct_meta" as const, user, accountId: selectedAccountId }] : []),
  { name: "meta_prepare_campaign", description: "Prepare a proposed PAUSED Meta campaign after resolving an accessible account and exact campaign settings. This only creates an expiring approval proposal; it cannot approve or execute a campaign.", inputSchema: { type: "object", properties: { accountId: { type: "string" }, name: { type: "string" }, objective: { type: "string", description: "Valid Meta OUTCOME_* objective" }, specialAdCategories: { type: "array", items: { type: "string" }, description: "Use [] when no special category applies" } }, required: ["accountId", "name", "objective", "specialAdCategories"] }, kind: "direct_meta", user },
]; }
export async function dispatchDirectMetaTool(tool: ServerTool, args: Record<string, unknown>) {
  if (tool.name === "meta_audit_selected_account") return auditSelectedMetaAccount(tool.accountId || "");
  if (tool.name === "meta_list_ad_accounts") {
    const readiness = await listSharedMetaAccounts();
    return readiness.graphError && !readiness.accounts.length ? { ok: false as const, error: "The shared Meta account list is unavailable. Ask an administrator to check the connection." } : { ok: true as const, accounts: readiness.accounts.map(({ id, name, currency }) => ({ id, name, currency })) };
  }
  return prepareDirectCampaign(tool.user, args);
}
export function campaignProposalEvent(result: Awaited<ReturnType<typeof prepareDirectCampaign>>): BedrockEvent { return result.ok ? { type: "campaign_proposal", status: "awaiting_approval", approvalId: result.approvalId, expiresInSeconds: result.expiresInSeconds, args: result.args } : { type: "campaign_proposal", status: "needs_details", missing: result.missing }; }
export type SafeToolResult = { toolResult: { toolUseId: string; status?: "success" | "error"; content: Array<{ text: string } | { json: unknown }> } };
export function parseToolUseInput(input: string | undefined): Record<string, unknown> { if (!input) return {}; const parsed = JSON.parse(input); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; }
export function structuralDiagnostics(conversation: Array<{ role: string; content?: Array<Record<string, unknown>> }>) {
  const blocks = conversation.flatMap(message => (message.content || []).map(block => ({ role: message.role, type: Object.keys(block)[0] || "unknown", toolUseId: typeof (block.toolUse as { toolUseId?: unknown } | undefined)?.toolUseId === "string" ? "present" : "missing", toolResultId: typeof (block.toolResult as { toolUseId?: unknown } | undefined)?.toolUseId === "string" ? "present" : "missing" })));
  const toolUses = blocks.filter(block => block.type === "toolUse");
  const toolResults = blocks.filter(block => block.type === "toolResult");
  const useIds = new Set(conversation.flatMap(message => (message.content || []).map(block => (block.toolUse as { toolUseId?: unknown } | undefined)?.toolUseId).filter((id): id is string => typeof id === "string")));
  const resultIds = new Set(conversation.flatMap(message => (message.content || []).map(block => (block.toolResult as { toolUseId?: unknown } | undefined)?.toolUseId).filter((id): id is string => typeof id === "string")));
  return { roles: [...new Set(conversation.map(message => message.role))], blockTypes: [...new Set(blocks.map(block => block.type))], blockCount: blocks.length, toolUseCount: toolUses.length, toolResultCount: toolResults.length, toolUseIdsPresent: toolUses.every(block => block.toolUseId === "present"), toolResultIdsPresent: toolResults.every(block => block.toolResultId === "present"), toolUseToolResultCountsMatch: toolUses.length === toolResults.length, toolUseResultIdsMatch: useIds.size === resultIds.size && [...useIds].every(id => resultIds.has(id)) };
}
export function toBedrockToolResult(toolUseId: string, result: { isError?: boolean; content?: Array<{ type?: string; text?: string; json?: unknown }> }): SafeToolResult {
  if (result.isError) {
    const errorText = (result.content || []).filter(item => item.type === "text").map(item => item.text || "").join(" ");
    return { toolResult: { toolUseId, status: "error", content: [{ text: mcpFailureMessage(classifyMcpFailure(errorText)) }] } };
  }
  const content: Array<{ text: string } | { json: unknown }> = [];
  for (const item of result.content || []) {
    if (item.type === "text" && typeof item.text === "string") content.push({ text: item.text });
    else if (item.type === "json") content.push({ json: item.json });
    else content.push({ text: "Tool returned an unsupported result type." });
  }
  return { toolResult: { toolUseId, status: "success", content: content.length ? content : [{ text: "Tool returned no data." }] } };
}
export function normalizeAssistantContent(blocks: any[]) {
  return blocks.filter(block => {
    if (block?.toolUse) return typeof block.toolUse.toolUseId === "string" && typeof block.toolUse.name === "string";
    return typeof block?.text === "string" && block.text.length > 0;
  }).map(block => block.toolUse ? { toolUse: { toolUseId: block.toolUse.toolUseId, name: block.toolUse.name, input: parseToolUseInput(block.toolUse.input) } } : { text: block.text });
}
export async function* runBedrock(messages: InputMessage[], modelId: string, tools: BedrockTool[], skillInstructions: string[] = []): AsyncGenerator<BedrockEvent> {
  const conversation: any[] = messages.map(m => ({ role: m.role, content: [{ text: m.content }] }));
  const toolDefinitions = tools.map(t => ({ toolSpec: { name: t.name, description: t.description || `Read-only ${t.name} data`, inputSchema: { json: t.inputSchema } } }));
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const input: ConverseStreamCommandInput = { modelId, system: [{ text: `${system}${skillInstructions.length ? `\n\nActive skills:\n${skillInstructions.map(instruction => `- ${instruction}`).join("\n")}` : ""}` }], messages: conversation, inferenceConfig: { maxTokens: LIMITS.maxOutputTokens, temperature: 0.4 }, ...(toolDefinitions.length ? { toolConfig: { tools: toolDefinitions } as any } : {}) };
    let output;
    try { output = await client().send(new ConverseStreamCommand(input)); } catch (error) { throw Object.assign(error instanceof Error ? error : new Error("Bedrock request failed"), { diagnostics: structuralDiagnostics(conversation) }); }
    const blocks: any[] = []; let stopReason = "";
    for await (const event of output.stream ?? []) {
      const index = event.contentBlockStart?.contentBlockIndex ?? event.contentBlockDelta?.contentBlockIndex;
      if (event.contentBlockStart?.start?.toolUse) blocks[index ?? blocks.length] = { toolUse: { ...event.contentBlockStart.start.toolUse, input: "" } };
      if ((event.contentBlockStart?.start as any)?.text && index !== undefined) blocks[index] = { text: (event.contentBlockStart?.start as any).text };
      const delta = event.contentBlockDelta?.delta;
      if (delta?.text) { if (index !== undefined) blocks[index] = { ...(blocks[index] || {}), text: `${blocks[index]?.text || ""}${delta.text}` }; yield { type: "text", text: delta.text }; }
      if (delta?.toolUse?.input && index !== undefined) blocks[index] = { ...(blocks[index] || { toolUse: { input: "" } }), toolUse: { ...(blocks[index]?.toolUse || {}), input: (blocks[index]?.toolUse?.input || "") + delta.toolUse.input } };
      if (event.messageStop?.stopReason) stopReason = event.messageStop.stopReason;
    }
    const content = blocks.filter(Boolean);
    if (stopReason !== "tool_use" || !content.some(b => b.toolUse)) return;
    const normalizedContent = normalizeAssistantContent(content);
    if (!normalizedContent.some(block => "toolUse" in block)) return;
    conversation.push({ role: "assistant", content: normalizedContent });
    const results: SafeToolResult[] = [];
    const failureCodes: McpFailureCode[] = [];
    let succeeded = 0;
    for (const block of normalizedContent) if (block.toolUse) {
      const tool = tools.find(t => t.name === block.toolUse.name);
      if (!tool) {
        results.push({ toolResult: { toolUseId: block.toolUse.toolUseId, status: "error", content: [{ text: "Tool is not allowlisted." }] } });
        failureCodes.push("unknown");
        yield { type: "tool_result", name: block.toolUse.name, ok: false, failureCode: "unknown" };
        continue;
      }
      yield { type: "tool_start", name: tool.name };
      try {
        // normalizeAssistantContent already parsed the streamed JSON input.
        const args = block.toolUse.input;
        if ("kind" in tool && tool.kind === "direct_meta") {
          const directResult = await dispatchDirectMetaTool(tool, args);
          const failed = "ok" in directResult && directResult.ok === false;
          results.push({ toolResult: { toolUseId: block.toolUse.toolUseId, status: failed ? "error" : "success", content: [{ text: JSON.stringify(directResult) }] } });
          if (tool.name === "meta_prepare_campaign") yield campaignProposalEvent(directResult as Awaited<ReturnType<typeof prepareDirectCampaign>>);
          if (failed) failureCodes.push("unknown"); else succeeded++;
          yield { type: "tool_result", name: tool.name, ok: !failed, ...(failed ? { failureCode: "unknown" as const } : {}) };
        } else {
          const result = await callTool(tool as McpTool, args);
          const safeResult = result as unknown as { isError?: boolean; content?: Array<{ type?: string; text?: string; json?: unknown }> };
          results.push(toBedrockToolResult(block.toolUse.toolUseId, safeResult));
          if (safeResult.isError) {
            const errorText = (safeResult.content || []).filter(item => item.type === "text").map(item => item.text || "").join(" ");
            const failureCode = classifyMcpFailure(errorText);
            failureCodes.push(failureCode);
            yield { type: "tool_result", name: tool.name, ok: false, failureCode };
          } else {
            succeeded++;
            yield { type: "tool_result", name: tool.name, ok: true };
          }
        }
      } catch (error) {
        const failureCode = classifyMcpFailure(error);
        failureCodes.push(failureCode);
        results.push({ toolResult: { toolUseId: block.toolUse.toolUseId, status: "error", content: [{ text: mcpFailureMessage(failureCode) }] } });
        yield { type: "tool_result", name: tool.name, ok: false, failureCode };
      }
    }
    conversation.push({ role: "user", content: results });
    const mcpOnlyBatch = normalizedContent.every(block => !block.toolUse || !tools.some(tool => tool.name === block.toolUse.name && "kind" in tool && tool.kind === "direct_meta"));
    if (mcpOnlyBatch && results.length > 0 && succeeded === 0) throw new McpToolsFailedError(primaryMcpFailure(failureCodes));
  }
  throw new Error("MCP_TOOL_LOOP_LIMIT");
}
