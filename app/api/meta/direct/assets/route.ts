import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { listMetaAssets, type AssetKind } from "../../../../../lib/meta-assets";
import { publicMetaError, sanitizedGraphError } from "../../../../../lib/meta-direct";
import { PUBLIC_CAMPAIGN_BUILDER_ACTOR } from "../../../../../lib/public-campaign-builder";
import { getRedisConfig } from "../../../../../lib/redis";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const config = getRedisConfig();
  if (!config) return Response.json({ error: "Rate limiting is unavailable." }, { status: 503 });
  const rate = await new Ratelimit({ redis: new Redis(config), limiter: Ratelimit.slidingWindow(30, "1 m"), prefix: "tossdown-ai:meta-assets-read" }).limit(PUBLIC_CAMPAIGN_BUILDER_ACTOR);
  if (!rate.success) return Response.json({ error: "Too many asset requests. Try again shortly." }, { status: 429 });
  const url = new URL(request.url);
  const accountId = url.searchParams.get("accountId") || "";
  const kind = url.searchParams.get("kind");
  const after = url.searchParams.get("after") || "";
  if (!/^act_\d{5,30}$/.test(accountId) || (kind !== "image" && kind !== "creative") || after.length > 512) return Response.json({ error: "Choose a valid account and asset type." }, { status: 400 });
  try {
    const result = await listMetaAssets(accountId, kind as AssetKind, after);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const diagnostics = publicMetaError(error);
    return Response.json({ error: diagnostics ? sanitizedGraphError(error) : error instanceof Error ? error.message : "Could not load account assets.", ...(diagnostics ? { diagnostics } : {}) }, { status: 409 });
  }
}
