import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export type ConnectionId = "google_ads" | "meta_ads";
export type McpTool = { name: string; description?: string; inputSchema: Record<string, unknown>; connection: ConnectionId; serverName: string; client: Client };
export const MCP_LIMITS = { maxTools: 40, maxTurns: 4, connectMs: 8_000, callMs: 10_000 } as const;
type ConnectionConfig = { id: ConnectionId; label: string; url?: string; token?: string; allowlist: Set<string> };
const configs: ConnectionConfig[] = [
  { id: "google_ads", label: "Google Ads", url: process.env.MCP_GOOGLE_ADS_URL, token: process.env.MCP_GOOGLE_ADS_TOKEN, allowlist: new Set((process.env.MCP_GOOGLE_ADS_READ_TOOLS || "").split(",").map(s => s.trim()).filter(Boolean)) },
  { id: "meta_ads", label: "Meta Ads", url: process.env.MCP_META_ADS_URL, token: process.env.MCP_META_ADS_TOKEN, allowlist: new Set((process.env.MCP_META_ADS_READ_TOOLS || "").split(",").map(s => s.trim()).filter(Boolean)) },
];
export function mcpEnabled() { return process.env.MCP_ENABLED === "true" && process.env.MCP_REQUIRE_AUTH === "true"; }
export function connectionStatus() { return configs.map(c => ({ id: c.id, label: c.label, status: !mcpEnabled() || !c.url || !c.token || !c.allowlist.size ? "not_configured" : "configured" as const })); }
function timeout<T>(promise: Promise<T>, ms: number) { return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("MCP request timed out")), ms))]); }
async function connect(c: ConnectionConfig) { if (!mcpEnabled() || !c.url || !c.token || !c.allowlist.size) throw new Error("MCP connection is not configured"); const client = new Client({ name: "tossdown-ai", version: "0.1.0" }); const transport = new StreamableHTTPClientTransport(new URL(c.url), { requestInit: { headers: { Authorization: `Bearer ${c.token}` } } }); await timeout(client.connect(transport), MCP_LIMITS.connectMs); return client; }
export function selectAllowlistedTools(id: ConnectionId, serverTools: Array<{ name: string; description?: string; inputSchema?: unknown; annotations?: { readOnlyHint?: boolean } }>, allowlist: Set<string>, client: Client) { return serverTools.filter(t => allowlist.has(t.name) && t.annotations?.readOnlyHint === true).slice(0, MCP_LIMITS.maxTools).map(t => ({ name: `${id}__${t.name}`, description: t.description, inputSchema: (t.inputSchema || {}) as Record<string, unknown>, connection: id, serverName: t.name, client })); }
export async function discoverTools(ids: ConnectionId[]) { const tools: McpTool[] = []; for (const id of ids) { const c = configs.find(x => x.id === id); if (!c || !mcpEnabled() || !c.url || !c.token || !c.allowlist.size) continue; const client = await connect(c); const result = await timeout(client.listTools(), MCP_LIMITS.connectMs); tools.push(...selectAllowlistedTools(id, result.tools, c.allowlist, client).slice(0, MCP_LIMITS.maxTools - tools.length)); } return tools; }
export async function callTool(tool: McpTool, args: Record<string, unknown>) { return timeout(tool.client.callTool({ name: tool.serverName, arguments: args }), MCP_LIMITS.callMs); }
