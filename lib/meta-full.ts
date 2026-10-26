import crypto from "node:crypto";
import { Redis } from "@upstash/redis";
import { getRedisConfig } from "./redis";
import { deleteSecure, getSecure, putSecure } from "./secure-store";
import { directCampaignPayload, directGraphRequest, directMetaConfiguration, directMetaReadiness, publicMetaError, sanitizedGraphError, validateDirectCampaignArgs } from "./meta-direct";

const TTL = 5 * 60;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const key = (user: string, id: string) => `meta:full:approval:${user}:${id}`;
const accountPath = (accountId: string) => `/act_${encodeURIComponent(accountId.replace(/^act_/i, ""))}`;
const text = (value: unknown, max = 255) => typeof value === "string" && value.trim().length <= max ? value.trim() : "";
const numericId = (value: unknown) => typeof value === "string" && /^\d{5,30}$/.test(value.trim()) ? value.trim() : "";
const post = (path: string, body: URLSearchParams | FormData) => directGraphRequest(path, { method: "POST", ...(body instanceof URLSearchParams ? { headers: { "Content-Type": "application/x-www-form-urlencoded" } } : {}), body });
const read = (id: string, fields: string) => directGraphRequest(`/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}`);
const objectId = (data: Record<string, unknown>) => typeof data.id === "string" && /^\d+$/.test(data.id) ? data.id : "";

export type FullInput = {
  accountId: string; name: string; objective: "OUTCOME_TRAFFIC" | "OUTCOME_SALES"; specialAdCategories: string[];
  adSetName: string; dailyBudget: string; country: string; ageMin: number; ageMax: number; pixelId: string;
  creativeName: string; adName: string; pageId: string; instagramActorId: string;
  primaryText: string; headline: string; description: string; destinationUrl: string; callToAction: "LEARN_MORE" | "SHOP_NOW" | "SIGN_UP";
  imageDigest: string; imageSize: number; imageType: "image/jpeg" | "image/png";
};
type Approval = { user: string; args: FullInput; digest: string; expiresAt: number };
type Created = { campaignId?: string; adSetId?: string; imageHash?: string; creativeId?: string; adId?: string };

export function validateFullInput(input: Record<string, unknown>) {
  const campaign = validateDirectCampaignArgs(input);
  const issues = [...campaign.missing];
  const objective = campaign.args.objective;
  if (objective !== "OUTCOME_TRAFFIC" && objective !== "OUTCOME_SALES") issues.push("Full ads currently support Traffic or Sales objectives.");
  const dailyBudget = text(input.dailyBudget, 12);
  if (!/^\d+$/.test(dailyBudget) || !Number.isSafeInteger(Number(dailyBudget)) || Number(dailyBudget) <= 0 || Number(dailyBudget) > 1_000_000_000) issues.push("Daily budget must be a positive amount in the ad account's minor currency units, up to 1 billion units.");
  const country = text(input.country, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) issues.push("Choose a two-letter country code.");
  const ageMin = Number(input.ageMin), ageMax = Number(input.ageMax);
  if (!Number.isInteger(ageMin) || !Number.isInteger(ageMax) || ageMin < 18 || ageMax > 65 || ageMin > ageMax) issues.push("Age range must be between 18 and 65+.");
  const pixelId = input.pixelId === "" ? "" : numericId(input.pixelId);
  if (objective === "OUTCOME_SALES" && !pixelId) issues.push("A Meta Pixel ID is required for Sales conversion optimization.");
  const pageId = numericId(input.pageId);
  if (!pageId) issues.push("A numeric Facebook Page ID is required.");
  const instagramActorId = input.instagramActorId === "" ? "" : numericId(input.instagramActorId);
  if (input.instagramActorId && !instagramActorId) issues.push("Instagram actor ID must be numeric.");
  const url = text(input.destinationUrl, 2048);
  try { const parsed = new URL(url); if (parsed.protocol !== "https:" || !parsed.hostname.includes(".")) issues.push("Destination must be a public HTTPS URL."); } catch { issues.push("Destination must be a valid HTTPS URL."); }
  const callToAction = input.callToAction;
  if (callToAction !== "LEARN_MORE" && callToAction !== "SHOP_NOW" && callToAction !== "SIGN_UP") issues.push("Choose a supported call to action.");
  const imageDigest = text(input.imageDigest, 64).toLowerCase();
  const imageSize = Number(input.imageSize);
  if (!/^[a-f0-9]{64}$/.test(imageDigest) || !Number.isInteger(imageSize) || imageSize < 100 || imageSize > MAX_IMAGE_BYTES) issues.push("Upload a JPEG or PNG image up to 8 MB.");
  const imageType = input.imageType;
  if (imageType !== "image/jpeg" && imageType !== "image/png") issues.push("Image must be JPEG or PNG.");
  const args = {
    accountId: campaign.args.accountId, name: campaign.args.name, objective: objective as FullInput["objective"], specialAdCategories: campaign.args.specialAdCategories,
    adSetName: text(input.adSetName), dailyBudget, country, ageMin, ageMax, pixelId,
    creativeName: text(input.creativeName), adName: text(input.adName), pageId, instagramActorId,
    primaryText: text(input.primaryText, 2000), headline: text(input.headline), description: text(input.description), destinationUrl: url,
    callToAction: callToAction as FullInput["callToAction"], imageDigest, imageSize, imageType: imageType as FullInput["imageType"],
  };
  for (const field of ["adSetName", "creativeName", "adName", "primaryText", "headline"] as const) if (!args[field]) issues.push(`${field} is required.`);
  return { issues, args };
}

export function adSetPayload(args: FullInput, campaignId: string) {
  const body = new URLSearchParams({ name: args.adSetName, campaign_id: campaignId, daily_budget: args.dailyBudget, billing_event: "IMPRESSIONS", optimization_goal: args.objective === "OUTCOME_SALES" ? "OFFSITE_CONVERSIONS" : "LINK_CLICKS", bid_strategy: "LOWEST_COST_WITHOUT_CAP", targeting: JSON.stringify({ geo_locations: { countries: [args.country] }, age_min: args.ageMin, age_max: args.ageMax }), status: "PAUSED" });
  if (args.objective === "OUTCOME_SALES") body.set("promoted_object", JSON.stringify({ pixel_id: args.pixelId, custom_event_type: "PURCHASE" }));
  return body;
}
export function creativePayload(args: FullInput, imageHash: string) {
  const story: Record<string, unknown> = { page_id: args.pageId, link_data: { link: args.destinationUrl, message: args.primaryText, name: args.headline, description: args.description, image_hash: imageHash, call_to_action: { type: args.callToAction, value: { link: args.destinationUrl } } } };
  if (args.instagramActorId) story.instagram_actor_id = args.instagramActorId;
  return new URLSearchParams({ name: args.creativeName, object_story_spec: JSON.stringify(story) });
}
export function adPayload(args: FullInput, adSetId: string, creativeId: string) { return new URLSearchParams({ name: args.adName, adset_id: adSetId, creative: JSON.stringify({ creative_id: creativeId }), status: "PAUSED" }); }

export async function prepareFullPackage(user: string, input: Record<string, unknown>) {
  const config = directMetaConfiguration();
  if (!config.configured || !config.writeEnabled) return { ok: false as const, error: "Meta campaign creation is not configured." };
  const { issues, args } = validateFullInput(input);
  if (issues.length) return { ok: false as const, error: issues.join(" ") };
  const allowed = (process.env.META_WRITE_ACCOUNT_IDS || "").split(",").map(value => value.trim().replace(/^act_/i, "")).filter(Boolean);
  if (allowed.length && !allowed.includes(args.accountId.replace(/^act_/i, ""))) return { ok: false as const, error: "Account is not on the write allowlist." };
  const readiness = await directMetaReadiness();
  if (readiness.graphError || !readiness.permissions.includes("ads_management:granted") || !readiness.accounts.some(account => account.id.replace(/^act_/i, "") === args.accountId.replace(/^act_/i, ""))) return { ok: false as const, error: "Token lacks access to the selected account or ads_management permission." };
  const approvalId = crypto.randomUUID();
  const digest = crypto.createHash("sha256").update(JSON.stringify(args)).digest("hex");
  await putSecure(key(user, approvalId), { user, args, digest, expiresAt: Date.now() + TTL * 1000 } satisfies Approval, TTL);
  return { ok: true as const, approvalId, expiresInSeconds: TTL, args };
}

export function validateImage(file: File, bytes: Buffer, args: FullInput) {
  if (file.size !== args.imageSize || bytes.length !== args.imageSize || file.type !== args.imageType || crypto.createHash("sha256").update(bytes).digest("hex") !== args.imageDigest) return false;
  return args.imageType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes.subarray(0, 3).equals(Buffer.from([255,216,255]));
}

export async function executeFullPackage(user: string, approvalId: string, file: File) {
  const approval = await getSecure<Approval>(key(user, approvalId));
  if (!approval || approval.user !== user || approval.expiresAt < Date.now() || crypto.createHash("sha256").update(JSON.stringify(approval.args)).digest("hex") !== approval.digest) return { ok: false as const, error: "Approval expired or invalid." };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false as const, error: "Image exceeds 8 MB." };
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!validateImage(file, bytes, approval.args)) return { ok: false as const, error: "Image changed since review. Review the package again." };
  const redisConfig = getRedisConfig();
  if (!redisConfig) return { ok: false as const, error: "Duplicate protection is unavailable." };
  const claimed = await new Redis(redisConfig).set(`${key(user, approvalId)}:claimed`, "1", { nx: true, ex: TTL });
  if (claimed !== "OK") return { ok: false as const, error: "This approval was already submitted." };
  await deleteSecure(key(user, approvalId));
  const args = approval.args, created: Created = {};
  let stage = "campaign";
  try {
    const campaign = await post(`${accountPath(args.accountId)}/campaigns`, directCampaignPayload(args));
    created.campaignId = objectId(campaign);
    if (!created.campaignId) throw new Error("Meta did not return a campaign ID.");
    const checkedCampaign = await read(created.campaignId, "id,status,objective,account_id");
    if (checkedCampaign.status !== "PAUSED" || checkedCampaign.objective !== args.objective) throw new Error("Campaign readback did not verify PAUSED status and objective.");
    stage = "ad set";
    const adSet = await post(`${accountPath(args.accountId)}/adsets`, adSetPayload(args, created.campaignId));
    created.adSetId = objectId(adSet);
    if (!created.adSetId) throw new Error("Meta did not return an ad set ID.");
    const checkedAdSet = await read(created.adSetId, "id,campaign_id,status,daily_budget");
    if (checkedAdSet.campaign_id !== created.campaignId || checkedAdSet.status !== "PAUSED") throw new Error("Ad set readback did not verify its campaign and PAUSED status.");
    stage = "image upload";
    const upload = new FormData();
    upload.set("filename", new File([bytes], `creative.${args.imageType === "image/png" ? "png" : "jpg"}`, { type: args.imageType }));
    const uploaded = await post(`${accountPath(args.accountId)}/adimages`, upload);
    const images = uploaded.images && typeof uploaded.images === "object" ? Object.values(uploaded.images as Record<string, { hash?: string }>) : [];
    created.imageHash = images.find(image => typeof image?.hash === "string")?.hash;
    if (!created.imageHash) throw new Error("Meta did not return an image hash.");
    stage = "creative";
    const creative = await post(`${accountPath(args.accountId)}/adcreatives`, creativePayload(args, created.imageHash));
    created.creativeId = objectId(creative);
    if (!created.creativeId) throw new Error("Meta did not return a creative ID.");
    const checkedCreative = await read(created.creativeId, "id,name,object_story_spec");
    if (checkedCreative.id !== created.creativeId || checkedCreative.name !== args.creativeName) throw new Error("Creative readback did not verify.");
    stage = "ad";
    const ad = await post(`${accountPath(args.accountId)}/ads`, adPayload(args, created.adSetId, created.creativeId));
    created.adId = objectId(ad);
    if (!created.adId) throw new Error("Meta did not return an ad ID.");
    const checkedAd = await read(created.adId, "id,adset_id,creative,status");
    const linkedCreative = checkedAd.creative as { id?: string } | undefined;
    if (checkedAd.status !== "PAUSED" || checkedAd.adset_id !== created.adSetId || linkedCreative?.id !== created.creativeId) throw new Error("Ad readback did not verify the creative, ad set, and PAUSED status.");
    return { ok: true as const, created, verified: true };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error && !publicMetaError(error) ? error.message : `Meta failed during ${stage}: ${sanitizedGraphError(error)}`, stage, created, diagnostics: publicMetaError(error) };
  }
}
