import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { auth } from "../../../../../../auth";
import { isAllowedEmployeeEmail } from "../../../../../../lib/access";
import { getRedisConfig } from "../../../../../../lib/redis";
import { prepareDirectCampaign } from "../../../../../../lib/meta-direct";
export const runtime = "nodejs";
export async function POST(request: Request) { const session = await auth(); const email = session?.user?.email?.toLowerCase(); if (!email || !isAllowedEmployeeEmail(email)) return Response.json({ error: "Sign in with a verified tossdown.com account." }, { status: 401 }); if (Number(request.headers.get("content-length") || 0) > 16_384) return Response.json({ error: "Request is too large." }, { status: 413 }); const config = getRedisConfig(); if (!config) return Response.json({ error: "Rate limiting is not configured." }, { status: 503 }); const rate = await new Ratelimit({ redis: new Redis(config), limiter: Ratelimit.slidingWindow(5, "1 m"), prefix: "tossdown-ai:meta-direct-write" }).limit(email); if (!rate.success) return Response.json({ error: "Too many requests. Try again shortly." }, { status: 429 }); let body: unknown; try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); } const result = await prepareDirectCampaign(email, body as Record<string, unknown>); return result.ok ? Response.json(result) : Response.json({ error: "Campaign creation is not ready.", missing: result.missing }, { status: 409 }); }
