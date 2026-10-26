import crypto from "node:crypto";
import { Redis } from "@upstash/redis";
import { getRedisConfig } from "./redis";
import { deleteSecure, getSecure, putSecure } from "./secure-store";
import { directCampaignPayload, directGraphRequest, directMetaConfiguration, directMetaReadiness, publicMetaError, sanitizedGraphError, validateDirectCampaignArgs } from "./meta-direct";
import { verifyMetaAsset } from "./meta-assets";

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
  adSetName: string; dailyBudget: string; dailyBudgetMinor: string; currency: string; country: string; ageMin: number; ageMax: number; pixelId: string;
  creativeName: string; adName: string; pageId: string; instagramActorId: string;
  primaryText: string; headline: string; description: string; destinationUrl: string; callToAction: "LEARN_MORE" | "SHOP_NOW" | "SIGN_UP";
  assetMode: "UPLOAD" | "ACCOUNT_IMAGE" | "EXISTING_CREATIVE"; accountImageHash: string; existingCreativeId: string; assetName: string; assetSummary: string;
  imageDigest: string; imageSize: number; imageType: "image/jpeg" | "image/png";
};
type Approval = { user: string; args: FullInput; digest: string; expiresAt: number };
type Created = { campaignId?: string; adSetId?: string; imageHash?: string; creativeId?: string; adId?: string };
type Reused = { imageHash?: string; creativeId?: string };

export function budgetToMinorUnits(amount: string, currency: string): string {
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/.test(amount)) throw new Error("Enter a positive daily budget in the account currency, such as 4.00.");
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("The ad account currency is unavailable. Refresh the account list before continuing.");
  let digits = -1;
  try { digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? -1; }
  catch { throw new Error("The ad account currency is unsupported. Refresh the account list before continuing."); }
  if (digits < 0) throw new Error("The ad account currency precision is unavailable. Refresh the account list before continuing.");
  const [whole, fraction = ""] = amount.split(".");
  if (fraction.length > digits) throw new Error(`Enter no more than ${digits} decimal place${digits === 1 ? "" : "s"} for ${currency}.`);
  const units = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
  if (!Number.isSafeInteger(units) || units <= 0 || units > 1_000_000_000) throw new Error("Daily budget must be positive and no more than 1 billion minor currency units.");
  return units.toString();
}

export function validateFullInput(input: Record<string, unknown>) {
  const campaign = validateDirectCampaignArgs(input);
  const issues = [...campaign.missing];
  const objective = campaign.args.objective;
  if (objective !== "OUTCOME_TRAFFIC" && objective !== "OUTCOME_SALES") issues.push("Full ads currently support Traffic or Sales objectives.");
  const dailyBudget = text(input.dailyBudget, 12);
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/.test(dailyBudget) || Number(dailyBudget) <= 0) issues.push("Enter a positive daily budget in the account currency, such as 4.00.");
  const country = text(input.country, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) issues.push("Choose a two-letter country code.");
  const ageMin = Number(input.ageMin), ageMax = Number(input.ageMax);
  if (!Number.isInteger(ageMin) || !Number.isInteger(ageMax) || ageMin < 18 || ageMax > 65 || ageMin > ageMax) issues.push("Age range must be between 18 and 65+.");
  const pixelId = input.pixelId === "" ? "" : numericId(input.pixelId);
  if (objective === "OUTCOME_SALES" && !pixelId) issues.push("A Meta Pixel ID is required for Sales conversion optimization.");
  const assetMode = input.assetMode === undefined ? "UPLOAD" : input.assetMode;
  if (assetMode !== "UPLOAD" && assetMode !== "ACCOUNT_IMAGE" && assetMode !== "EXISTING_CREATIVE") issues.push("Choose an image upload, an account image, or an existing creative.");
  const pageId = numericId(input.pageId);
  if (assetMode !== "EXISTING_CREATIVE" && !pageId) issues.push("A numeric Facebook Page ID is required.");
  const instagramActorId = input.instagramActorId === "" ? "" : numericId(input.instagramActorId);
  if (assetMode !== "EXISTING_CREATIVE" && input.instagramActorId && !instagramActorId) issues.push("Instagram actor ID must be numeric.");
  const url = text(input.destinationUrl, 2048);
  if (assetMode !== "EXISTING_CREATIVE") {
    try { const parsed = new URL(url); if (parsed.protocol !== "https:" || !parsed.hostname.includes(".")) issues.push("Destination must be a public HTTPS URL."); } catch { issues.push("Destination must be a valid HTTPS URL."); }
  }
  const callToAction = input.callToAction;
  if (assetMode !== "EXISTING_CREATIVE" && callToAction !== "LEARN_MORE" && callToAction !== "SHOP_NOW" && callToAction !== "SIGN_UP") issues.push("Choose a supported call to action.");
  const imageDigest = text(input.imageDigest, 64).toLowerCase();
  const imageSize = Number(input.imageSize);
  if (assetMode === "UPLOAD" && (!/^[a-f0-9]{64}$/.test(imageDigest) || !Number.isInteger(imageSize) || imageSize < 100 || imageSize > MAX_IMAGE_BYTES)) issues.push("Upload a JPEG or PNG image up to 8 MB.");
  const imageType = input.imageType;
  if (assetMode === "UPLOAD" && imageType !== "image/jpeg" && imageType !== "image/png") issues.push("Image must be JPEG or PNG.");
  const accountImageHash = text(input.accountImageHash, 64);
  const existingCreativeId = numericId(input.existingCreativeId);
  if (assetMode === "ACCOUNT_IMAGE" && !/^[a-f0-9]{32,64}$/i.test(accountImageHash)) issues.push("Choose an image from the selected ad account.");
  if (assetMode === "EXISTING_CREATIVE" && !existingCreativeId) issues.push("Choose a creative from the selected ad account.");
  const args = {
    accountId: campaign.args.accountId, name: campaign.args.name, objective: objective as FullInput["objective"], specialAdCategories: campaign.args.specialAdCategories,
    adSetName: text(input.adSetName), dailyBudget, dailyBudgetMinor: "", currency: "", country, ageMin, ageMax, pixelId,
    creativeName: text(input.creativeName), adName: text(input.adName), pageId, instagramActorId,
    primaryText: text(input.primaryText, 2000), headline: text(input.headline), description: text(input.description), destinationUrl: url,
    callToAction: callToAction as FullInput["callToAction"], assetMode: assetMode as FullInput["assetMode"], accountImageHash, existingCreativeId, assetName: "", assetSummary: "", imageDigest, imageSize, imageType: imageType as FullInput["imageType"],
  };
  for (const field of ["adSetName", "adName"] as const) if (!args[field]) issues.push(`${field} is required.`);
  if (assetMode !== "EXISTING_CREATIVE") for (const field of ["creativeName", "primaryText", "headline"] as const) if (!args[field]) issues.push(`${field} is required.`);
  return { issues, args };
}

export function adSetPayload(args: FullInput, campaignId: string) {
  if (!/^\d+$/.test(args.dailyBudgetMinor) || args.dailyBudgetMinor === "0") throw new Error("Budget conversion is missing; review the package again.");
  const body = new URLSearchParams({ name: args.adSetName, campaign_id: campaignId, daily_budget: args.dailyBudgetMinor, billing_event: "IMPRESSIONS", optimization_goal: args.objective === "OUTCOME_SALES" ? "OFFSITE_CONVERSIONS" : "LINK_CLICKS", bid_strategy: "LOWEST_COST_WITHOUT_CAP", targeting: JSON.stringify({ geo_locations: { countries: [args.country] }, age_min: args.ageMin, age_max: args.ageMax }), status: "PAUSED" });
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
  const account = readiness.accounts.find(item => item.id.replace(/^act_/i, "") === args.accountId.replace(/^act_/i, ""));
  if (readiness.graphError || !readiness.permissions.includes("ads_management:granted") || !account) return { ok: false as const, error: "Token lacks access to the selected account or ads_management permission." };
  try { args.dailyBudgetMinor = budgetToMinorUnits(args.dailyBudget, account.currency || ""); args.currency = account.currency || ""; }
  catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "Invalid daily budget." }; }
  if (args.assetMode !== "UPLOAD") {
    try {
      const asset = await verifyMetaAsset(args.accountId, args.assetMode === "ACCOUNT_IMAGE" ? "image" : "creative", args.assetMode === "ACCOUNT_IMAGE" ? args.accountImageHash : args.existingCreativeId);
      args.assetName = asset.name; args.assetSummary = asset.summary || "";
    } catch (error) { return { ok: false as const, error: publicMetaError(error) ? sanitizedGraphError(error) : error instanceof Error ? error.message : "Selected asset is unavailable.", diagnostics: publicMetaError(error) }; }
  }
  const approvalId = crypto.randomUUID();
  const digest = crypto.createHash("sha256").update(JSON.stringify(args)).digest("hex");
  await putSecure(key(user, approvalId), { user, args, digest, expiresAt: Date.now() + TTL * 1000 } satisfies Approval, TTL);
  return { ok: true as const, approvalId, expiresInSeconds: TTL, args };
}

export function validateImage(file: File, bytes: Buffer, args: FullInput) {
  if (file.size !== args.imageSize || bytes.length !== args.imageSize || file.type !== args.imageType || crypto.createHash("sha256").update(bytes).digest("hex") !== args.imageDigest) return false;
  return args.imageType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes.subarray(0, 3).equals(Buffer.from([255,216,255]));
}

export async function executeFullPackage(user: string, approvalId: string, file?: File) {
  const approval = await getSecure<Approval>(key(user, approvalId));
  if (!approval || approval.user !== user || approval.expiresAt < Date.now() || crypto.createHash("sha256").update(JSON.stringify(approval.args)).digest("hex") !== approval.digest) return { ok: false as const, error: "Approval expired or invalid." };
  if (approval.args.assetMode !== "UPLOAD" && approval.args.assetMode !== "ACCOUNT_IMAGE" && approval.args.assetMode !== "EXISTING_CREATIVE") return { ok: false as const, error: "Approval uses an older package format. Review the package again." };
  try {
    if (!approval.args.dailyBudgetMinor || approval.args.dailyBudgetMinor !== budgetToMinorUnits(approval.args.dailyBudget, approval.args.currency)) return { ok: false as const, error: "Budget approval is invalid. Review the package again." };
  } catch { return { ok: false as const, error: "Budget approval is invalid. Review the package again." }; }
  let bytes: Buffer | undefined;
  if (approval.args.assetMode === "UPLOAD") {
    if (!file) return { ok: false as const, error: "Approved image upload is required." };
    if (file.size > MAX_IMAGE_BYTES) return { ok: false as const, error: "Image exceeds 8 MB." };
    bytes = Buffer.from(await file.arrayBuffer());
    if (!validateImage(file, bytes, approval.args)) return { ok: false as const, error: "Image changed since review. Review the package again." };
  } else {
    if (file) return { ok: false as const, error: "Do not upload an image for the selected account asset." };
    try { await verifyMetaAsset(approval.args.accountId, approval.args.assetMode === "ACCOUNT_IMAGE" ? "image" : "creative", approval.args.assetMode === "ACCOUNT_IMAGE" ? approval.args.accountImageHash : approval.args.existingCreativeId); }
    catch (error) { return { ok: false as const, error: publicMetaError(error) ? sanitizedGraphError(error) : error instanceof Error ? error.message : "Selected asset is unavailable.", diagnostics: publicMetaError(error) }; }
  }
  const redisConfig = getRedisConfig();
  if (!redisConfig) return { ok: false as const, error: "Duplicate protection is unavailable." };
  const claimed = await new Redis(redisConfig).set(`${key(user, approvalId)}:claimed`, "1", { nx: true, ex: TTL });
  if (claimed !== "OK") return { ok: false as const, error: "This approval was already submitted." };
  await deleteSecure(key(user, approvalId));
  const args = approval.args, created: Created = {}, reused: Reused = {};
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
    if (args.assetMode === "EXISTING_CREATIVE") {
      reused.creativeId = args.existingCreativeId;
    } else {
      let hash: string;
      if (args.assetMode === "ACCOUNT_IMAGE") { hash = args.accountImageHash; reused.imageHash = hash; }
      else {
        stage = "image upload";
        if (!bytes) throw new Error("Approved image is missing.");
        const upload = new FormData();
        upload.set("filename", new File([new Uint8Array(bytes)], `creative.${args.imageType === "image/png" ? "png" : "jpg"}`, { type: args.imageType }));
        const uploaded = await post(`${accountPath(args.accountId)}/adimages`, upload);
        const images = uploaded.images && typeof uploaded.images === "object" ? Object.values(uploaded.images as Record<string, { hash?: string }>) : [];
        hash = images.find(image => typeof image?.hash === "string")?.hash || "";
        if (!hash) throw new Error("Meta did not return an image hash.");
        created.imageHash = hash;
      }
      stage = "creative";
      const creative = await post(`${accountPath(args.accountId)}/adcreatives`, creativePayload(args, hash));
      created.creativeId = objectId(creative);
      if (!created.creativeId) throw new Error("Meta did not return a creative ID.");
      const checkedCreative = await read(created.creativeId, "id,name,object_story_spec");
      if (checkedCreative.id !== created.creativeId || checkedCreative.name !== args.creativeName) throw new Error("Creative readback did not verify.");
    }
    stage = "ad";
    const usedCreativeId = created.creativeId || reused.creativeId;
    if (!usedCreativeId) throw new Error("Creative is missing.");
    const ad = await post(`${accountPath(args.accountId)}/ads`, adPayload(args, created.adSetId, usedCreativeId));
    created.adId = objectId(ad);
    if (!created.adId) throw new Error("Meta did not return an ad ID.");
    const checkedAd = await read(created.adId, "id,adset_id,creative,status");
    const linkedCreative = checkedAd.creative as { id?: string } | undefined;
    if (checkedAd.status !== "PAUSED" || checkedAd.adset_id !== created.adSetId || linkedCreative?.id !== usedCreativeId) throw new Error("Ad readback did not verify the creative, ad set, and PAUSED status.");
    return { ok: true as const, created, reused, verified: true };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error && !publicMetaError(error) ? error.message : `Meta failed during ${stage}: ${sanitizedGraphError(error)}`, stage, created, reused, diagnostics: publicMetaError(error) };
  }
}
