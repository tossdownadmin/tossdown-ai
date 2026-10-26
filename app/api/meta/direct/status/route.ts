import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { directMetaReadiness } from "../../../../../lib/meta-direct";
import { PUBLIC_CAMPAIGN_BUILDER_ACTOR } from "../../../../../lib/public-campaign-builder";
import { getRedisConfig } from "../../../../../lib/redis";
export const runtime = "nodejs";
export async function GET() {
  const config = getRedisConfig();
  if (!config) return Response.json({ error: "Rate limiting is unavailable." }, { status: 503 });
  const rate = await new Ratelimit({ redis: new Redis(config), limiter: Ratelimit.slidingWindow(30, "1 m"), prefix: "tossdown-ai:meta-status-read" }).limit(PUBLIC_CAMPAIGN_BUILDER_ACTOR);
  if (!rate.success) return Response.json({ error: "Too many account requests. Try again shortly." }, { status: 429 });
  const readiness = await directMetaReadiness();
  // This route is public: only return the fields needed to populate the form.
  return Response.json({ accounts: readiness.accounts.map(({ id, name, currency }) => ({ id, name, currency })) }, { headers: { "Cache-Control": "no-store" } });
}
