import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { auth } from "../../../../../../auth";
import { isAllowedEmployeeEmail } from "../../../../../../lib/access";
import { prepareFullPackage } from "../../../../../../lib/meta-full";
import { getRedisConfig } from "../../../../../../lib/redis";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const email = (await auth())?.user?.email?.toLowerCase();
  if (!email || !isAllowedEmployeeEmail(email)) return Response.json({ error: "Sign in with a verified tossdown.com account." }, { status: 401 });
  if (Number(request.headers.get("content-length") || 0) > 16_384) return Response.json({ error: "Request is too large." }, { status: 413 });
  const config = getRedisConfig();
  if (!config) return Response.json({ error: "Rate limiting is unavailable." }, { status: 503 });
  const rate = await new Ratelimit({ redis: new Redis(config), limiter: Ratelimit.slidingWindow(5, "1 m"), prefix: "tossdown-ai:meta-full-write" }).limit(email);
  if (!rate.success) return Response.json({ error: "Too many requests. Try again shortly." }, { status: 429 });
  let input: unknown;
  try { input = await request.json(); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  if (!input || typeof input !== "object" || Array.isArray(input)) return Response.json({ error: "Invalid package details." }, { status: 400 });
  const result = await prepareFullPackage(email, input as Record<string, unknown>);
  return Response.json(result, { status: result.ok ? 200 : 409 });
}
