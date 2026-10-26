import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { executeFullPackage } from "../../../../../../lib/meta-full";
import { PUBLIC_CAMPAIGN_BUILDER_ACTOR } from "../../../../../../lib/public-campaign-builder";
import { getRedisConfig } from "../../../../../../lib/redis";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > 9 * 1024 * 1024) return Response.json({ error: "Upload exceeds 8 MB." }, { status: 413 });
  const config = getRedisConfig();
  if (!config) return Response.json({ error: "Rate limiting is unavailable." }, { status: 503 });
  const rate = await new Ratelimit({ redis: new Redis(config), limiter: Ratelimit.slidingWindow(5, "1 m"), prefix: "tossdown-ai:meta-full-write" }).limit(PUBLIC_CAMPAIGN_BUILDER_ACTOR);
  if (!rate.success) return Response.json({ error: "Too many requests. Try again shortly." }, { status: 429 });
  let form: FormData;
  try { form = await request.formData(); } catch { return Response.json({ error: "Invalid upload." }, { status: 400 }); }
  const approvalId = form.get("approvalId"), image = form.get("image");
  if (typeof approvalId !== "string" || !/^[0-9a-f-]{36}$/i.test(approvalId) || (image !== null && !(image instanceof File))) return Response.json({ error: "Valid approval and optional image are required." }, { status: 400 });
  const result = await executeFullPackage(PUBLIC_CAMPAIGN_BUILDER_ACTOR, approvalId, image instanceof File ? image : undefined);
  return Response.json(result, { status: result.ok ? 200 : 409 });
}
