import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { listSharedMetaAccounts } from "../../../../../lib/meta-accounts";
import { getRedisConfig } from "../../../../../lib/redis";
import { auth } from "../../../../../auth";
import { isAllowedEmployeeEmail } from "../../../../../lib/access";
import crypto from "node:crypto";
export const runtime = "nodejs";
export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!isAllowedEmployeeEmail(email) || typeof email !== "string") return Response.json({ error: "Sign in with a verified tossdown.com account." }, { status: 401 });
  const config = getRedisConfig();
  if (!config) return Response.json({ error: "Rate limiting is unavailable." }, { status: 503 });
  const redis = new Redis(config);
  const userKey = crypto.createHash("sha256").update(email.toLowerCase()).digest("hex");
  const perUser = await new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30, "1 m"), prefix: "tossdown-ai:meta-status-read-user" }).limit(userKey);
  if (!perUser.success) return Response.json({ error: "Too many account requests. Try again shortly." }, { status: 429 });
  const overall = await new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(200, "1 m"), prefix: "tossdown-ai:meta-status-read-global" }).limit("all-employees");
  if (!overall.success) return Response.json({ error: "Meta account requests are busy. Try again shortly." }, { status: 429 });
  const readiness = await listSharedMetaAccounts();
  // Expose only safe readiness and account-picker fields to verified employees.
  return Response.json({ configured: readiness.configured, available: readiness.configured && readiness.accounts.length > 0, graphError: readiness.accounts.length ? null : readiness.graphError, truncated: readiness.truncated, accounts: readiness.accounts.map(({ id, name, currency }) => ({ id, name, currency })) }, { headers: { "Cache-Control": "no-store" } });
}
