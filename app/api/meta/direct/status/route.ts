import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { directMetaReadiness } from "../../../../../lib/meta-direct";
import { getRedisConfig } from "../../../../../lib/redis";
import { auth } from "../../../../../auth";
import { isAllowedEmployeeEmail } from "../../../../../lib/access";
export const runtime = "nodejs";
export async function GET() {
  const session = await auth();
  if (!isAllowedEmployeeEmail(session?.user?.email)) return Response.json({ error: "Sign in with a verified tossdown.com account." }, { status: 401 });
  const config = getRedisConfig();
  if (!config) return Response.json({ error: "Rate limiting is unavailable." }, { status: 503 });
  const rate = await new Ratelimit({ redis: new Redis(config), limiter: Ratelimit.slidingWindow(30, "1 m"), prefix: "tossdown-ai:meta-status-read" }).limit("authenticated-meta-account-status");
  if (!rate.success) return Response.json({ error: "Too many account requests. Try again shortly." }, { status: 429 });
  const readiness = await directMetaReadiness();
  // This route is public: only return the fields needed to populate the form.
  return Response.json({ accounts: readiness.accounts.map(({ id, name, currency }) => ({ id, name, currency })) }, { headers: { "Cache-Control": "no-store" } });
}
