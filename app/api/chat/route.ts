import { runBedrock } from "../../../lib/bedrock";
import { LIMITS, validateMessages } from "../../../lib/limits";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { getRedisConfig } from "../../../lib/redis";
import { isAllowedModel } from "../../../lib/model-config";
import { auth } from "../../../auth";
import { discoverTools, mcpEnabled, type ConnectionId } from "../../../lib/mcp";
import { isAllowedEmployeeEmail } from "../../../lib/access";
import crypto from "node:crypto";
import { directMetaReadiness, parseCampaignRequest, prepareDirectCampaign } from "../../../lib/meta-direct";

export const runtime = "nodejs";
function logFailure(requestId: string, stage: string, error: unknown) { const aws = error as { name?: unknown; message?: unknown; $metadata?: { requestId?: unknown; httpStatusCode?: unknown }; diagnostics?: unknown }; const message = typeof aws.message === "string" ? aws.message.replace(/(bearer|token|secret|password|credential)[^\s:=]*\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]").replace(/("[^"\n]{1,300}"|'[^'\n]{1,300}')/g, "[redacted]").slice(0, 300) : "Unknown error"; console.error(JSON.stringify({ requestId, stage, error: typeof aws.name === "string" ? aws.name : "UnknownError", message, awsRequestId: typeof aws.$metadata?.requestId === "string" ? aws.$metadata.requestId : undefined, httpStatus: typeof aws.$metadata?.httpStatusCode === "number" ? aws.$metadata.httpStatusCode : undefined, diagnostics: aws.diagnostics })); }
function limiter() { const config = getRedisConfig(); if (!config) return null; return new Ratelimit({ redis: new Redis(config), limiter: Ratelimit.slidingWindow(20, "1 h"), analytics: true }); }
export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const length = Number(request.headers.get("content-length") || 0); if (length > LIMITS.maxRequestBytes) return Response.json({ error: "Request is too large." }, { status: 413 });
  const rate = limiter(); if (!rate) return Response.json({ error: "Rate limiting is not configured." }, { status: 503 });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "anonymous";
  const result = await rate.limit(`ip:${ip}`); if (!result.success) return Response.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  let body: unknown; try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  const requestBody = body as {messages?: unknown; modelId?: unknown; enabledConnections?: unknown};
  const error = validateMessages(requestBody.messages); if (error) return Response.json({ error }, { status: 400 });
  if (mcpEnabled()) { const session = await auth(); if (!isAllowedEmployeeEmail(session?.user?.email)) return Response.json({ error: "Sign in with a verified tossdown.com account." }, { status: 401 }); }
  const modelId = requestBody.modelId === undefined ? process.env.BEDROCK_MODEL_ID : requestBody.modelId; if (!isAllowedModel(modelId)) return Response.json({ error: "That model is not enabled on the server." }, { status: 400 });
  const enabledConnections = Array.isArray(requestBody.enabledConnections) ? requestBody.enabledConnections.filter((id): id is ConnectionId => id === "google_ads" || id === "meta_ads") : [];
  const latestUserMessage = (requestBody.messages as Array<{ role: "user" | "assistant"; content: string }>).filter(message => message.role === "user").at(-1)?.content || "";
  const campaignKeyword = /\b(create|launch|start|make|set up)\b.{0,40}\bcampaign\b/i.test(latestUserMessage);
  if (campaignKeyword) {
    const session = await auth(); const email = session?.user?.email?.toLowerCase();
    if (!email || !isAllowedEmployeeEmail(email)) return Response.json({ error: "Sign in with a verified tossdown.com account." }, { status: 401 });
    const encoder = new TextEncoder(); const readiness = await directMetaReadiness(); const campaignIntent = parseCampaignRequest(latestUserMessage, readiness.accounts);
    if (!campaignIntent) return Response.json({ error: "Campaign request could not be understood." }, { status: 400 });
    const proposal = campaignIntent.accountMatches.length === 1 && campaignIntent.name && campaignIntent.objective && campaignIntent.specialAdCategories !== undefined
      ? await prepareDirectCampaign(email, { accountId: campaignIntent.accountMatches[0].id, name: campaignIntent.name, objective: campaignIntent.objective, specialAdCategories: campaignIntent.specialAdCategories })
      : { ok: false as const, missing: campaignIntent.missing };
    const event = { type: "campaign_proposal", status: proposal.ok ? "awaiting_approval" : "needs_details", approvalId: proposal.ok ? proposal.approvalId : undefined, expiresInSeconds: proposal.ok ? proposal.expiresInSeconds : undefined, args: proposal.ok ? proposal.args : { accountId: campaignIntent.accountMatches[0]?.id, name: campaignIntent.name, objective: campaignIntent.objective, specialAdCategories: campaignIntent.specialAdCategories }, missing: proposal.ok ? [] : proposal.missing, accounts: readiness.accounts.map(account => ({ id: account.id, name: account.name })) };
    const stream = new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(`${JSON.stringify({ type: "text", text: proposal.ok ? "I prepared a paused campaign proposal. Review the exact settings below and approve it to create the campaign." : "I need a few details before I can prepare a paused campaign proposal." })}\n`)); controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); controller.close(); } });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache", "X-Request-ID": requestId } });
  }
  if (process.env.MOCK_MODE === "true" && process.env.NODE_ENV !== "production") { const text = "[Local mock mode] This response was not generated by Amazon Bedrock."; return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } }); }
  try { const session = mcpEnabled() ? await auth() : null; const user = session?.user?.email?.toLowerCase() || "anonymous"; let tools; try { tools = mcpEnabled() && enabledConnections.length ? await discoverTools(enabledConnections, user) : []; } catch (e) { logFailure(requestId, "mcp_discovery", e); return Response.json({ error: `MCP discovery failed. Request ID: ${requestId}` }, { status: 502 }); } const encoder = new TextEncoder(); const stream = new ReadableStream({ async start(controller) { try { for await (const event of runBedrock(requestBody.messages as {role:"user"|"assistant";content:string}[], modelId, tools)) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); controller.close(); } catch (e) { logFailure(requestId, "bedrock_stream_or_tool_continuation", e); const code = e instanceof Error ? e.message : ""; const message = code === "MCP_TOOL_LOOP_LIMIT" ? "Tool-call limit reached." : "Generation failed while continuing after a tool call."; controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", error: `${message} Request ID: ${requestId}` })}\n`)); controller.close(); } } }); return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache", "X-Request-ID": requestId } }); } catch (e) { logFailure(requestId, "request_setup", e); const code = e instanceof Error ? e.message : ""; const status = code === "BEDROCK_NOT_CONFIGURED" ? 503 : 502; return Response.json({ error: status === 503 ? "Bedrock is not configured." : `Bedrock could not complete the request. Request ID: ${requestId}` }, { status, headers: { "X-Request-ID": requestId } }); }
}
