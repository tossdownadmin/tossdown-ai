import { BedrockRuntimeClient, ConverseStreamCommand, type ConverseStreamCommandInput } from "@aws-sdk/client-bedrock-runtime";
import { fromStatic } from "@aws-sdk/token-providers";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { LIMITS } from "./limits";
import { callTool, type McpTool } from "./mcp";

const system = "You are tossdown AI, an internal marketing assistant for tossdown employees. Be practical, clear, and honest. Help with ads, creative briefs, plans, and analysis. Do not claim access to live campaign data unless it is provided in the conversation. Keep recommendations concise and structured.";
const MAX_TURNS = 4;
const client = () => { const region = process.env.AWS_REGION || "eu-north-1"; const bearerToken = process.env.AWS_BEARER_TOKEN_BEDROCK; if (bearerToken) return new BedrockRuntimeClient({ region, token: fromStatic({ token: { token: bearerToken } }) }); return new BedrockRuntimeClient({ region, ...(process.env.AWS_ROLE_ARN ? { credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }) } : {}) }); };
type InputMessage = { role: "user" | "assistant"; content: string };
export type BedrockEvent = { type: "text"; text: string } | { type: "tool_start"; name: string } | { type: "tool_result"; name: string; ok: boolean };
export type SafeToolResult = { toolResult: { toolUseId: string; status?: "success" | "error"; content: Array<{ text: string } | { json: unknown }> } };
export function toBedrockToolResult(toolUseId: string, result: { isError?: boolean; content?: Array<{ type?: string; text?: string; json?: unknown }> }): SafeToolResult {
  const content: Array<{ text: string } | { json: unknown }> = [];
  for (const item of result.content || []) {
    if (item.type === "text" && typeof item.text === "string") content.push({ text: item.text });
    else if (item.type === "json") content.push({ json: item.json });
    else content.push({ text: "Tool returned an unsupported result type." });
  }
  return { toolResult: { toolUseId, status: result.isError ? "error" : "success", content: content.length ? content : [{ text: result.isError ? "Tool reported an error." : "Tool returned no data." }] } };
}
export async function* runBedrock(messages: InputMessage[], modelId: string, tools: McpTool[]): AsyncGenerator<BedrockEvent> {
  const conversation: any[] = messages.map(m => ({ role: m.role, content: [{ text: m.content }] }));
  const toolDefinitions = tools.map(t => ({ toolSpec: { name: t.name, description: t.description || `Read-only ${t.connection} data`, inputSchema: { json: t.inputSchema } } }));
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const input: ConverseStreamCommandInput = { modelId, system: [{ text: system }], messages: conversation, inferenceConfig: { maxTokens: LIMITS.maxOutputTokens, temperature: 0.4 }, ...(toolDefinitions.length ? { toolConfig: { tools: toolDefinitions } as any } : {}) };
    const output = await client().send(new ConverseStreamCommand(input));
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
    conversation.push({ role: "assistant", content });
    const results: any[] = [];
    for (const block of content) if (block.toolUse) {
      const tool = tools.find(t => t.name === block.toolUse.name); if (!tool) { results.push({ toolResult: { toolUseId: block.toolUse.toolUseId, status: "error", content: [{ text: "Tool is not allowlisted." }] } }); continue; }
      yield { type: "tool_start", name: tool.name };
      try { const args = block.toolUse.input ? JSON.parse(block.toolUse.input) : {}; const result = await callTool(tool, args); const safeResult = result as unknown as { isError?: boolean; content?: Array<{ type?: string; text?: string; json?: unknown }> }; results.push(toBedrockToolResult(block.toolUse.toolUseId, safeResult)); yield { type: "tool_result", name: tool.name, ok: safeResult.isError !== true }; } catch { results.push({ toolResult: { toolUseId: block.toolUse.toolUseId, status: "error", content: [{ text: "Tool request failed or timed out." }] } }); yield { type: "tool_result", name: tool.name, ok: false }; }
    }
    conversation.push({ role: "user", content: results });
  }
  throw new Error("MCP_TOOL_LOOP_LIMIT");
}
