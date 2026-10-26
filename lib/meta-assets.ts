import { directGraphRequest, directMetaReadiness } from "./meta-direct";

export type AssetKind = "image" | "creative";
export type MetaAsset = { id: string; name: string; previewUrl?: string; width?: number; height?: number; summary?: string };

const accountNumber = (value: string) => value.replace(/^act_/i, "");
const accountPath = (value: string) => `/act_${accountNumber(value)}`;
const imageHash = (value: string) => /^[a-f\d]{32,64}$/i.test(value);
const creativeId = (value: string) => /^\d{5,30}$/.test(value);
const safeText = (value: unknown, max = 255) => typeof value === "string" ? value.slice(0, max) : "";
const safePreview = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/(^|\.)(fbcdn\.net|facebook\.com|fbsbx\.com)$/.test(url.hostname) || [...url.searchParams.keys()].some(key => /token|secret|proof|auth/i.test(key))) return undefined;
    return url.toString();
  } catch { return undefined; }
};

export async function assertAccessibleMetaAccount(accountId: string) {
  if (!/^act_\d{5,30}$/.test(accountId)) throw new Error("Choose a valid ad account.");
  const readiness = await directMetaReadiness();
  if (readiness.graphError || !readiness.permissions.includes("ads_management:granted") || !readiness.accounts.some(account => accountNumber(account.id) === accountNumber(accountId))) throw new Error("The selected account is unavailable to this token.");
}

export async function listMetaAssets(accountId: string, kind: AssetKind, after = "") {
  await assertAccessibleMetaAccount(accountId);
  if (kind !== "image" && kind !== "creative") throw new Error("Choose images or creatives.");
  if (after && (after.length > 512 || /[\x00-\x1f]/.test(after))) throw new Error("Invalid asset page cursor.");
  const fields = kind === "image" ? "account_id,hash,name,url_128,width,height,status" : "id,account_id,name,body,title,thumbnail_url,status";
  const edge = kind === "image" ? "adimages" : "adcreatives";
  const query = new URLSearchParams({ fields, limit: "50" });
  if (after) query.set("after", after);
  const response = await directGraphRequest(`${accountPath(accountId)}/${edge}?${query}`);
  const data = Array.isArray(response.data) ? response.data : [];
  const items: MetaAsset[] = data.flatMap(value => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    if (item.account_id && accountNumber(String(item.account_id)) !== accountNumber(accountId)) return [];
    if (item.status === "DELETED" || item.status === "ARCHIVED" || item.status === "INTERNAL") return [];
    const id = kind === "image" ? item.hash : item.id;
    if (typeof id !== "string" || !(kind === "image" ? imageHash(id) : creativeId(id))) return [];
    return [{ id, name: safeText(item.name) || `${kind === "image" ? "Image" : "Creative"} ${id}`, previewUrl: safePreview(kind === "image" ? item.url_128 : item.thumbnail_url), ...(kind === "image" ? { width: typeof item.width === "number" ? item.width : undefined, height: typeof item.height === "number" ? item.height : undefined } : { summary: safeText(item.title || item.body, 180) }) }];
  });
  const paging = response.paging && typeof response.paging === "object" ? response.paging as { cursors?: { after?: unknown }; next?: unknown } : undefined;
  return { items, nextCursor: typeof paging?.next === "string" && typeof paging.cursors?.after === "string" ? paging.cursors.after : null };
}

export async function verifyMetaAsset(accountId: string, kind: AssetKind, id: string) {
  await assertAccessibleMetaAccount(accountId);
  if (kind === "image") {
    if (!imageHash(id)) throw new Error("Choose an image from the selected account.");
    const query = new URLSearchParams({ fields: "account_id,hash,name,url_128,status", hashes: JSON.stringify([id]), limit: "10" });
    const response = await directGraphRequest(`${accountPath(accountId)}/adimages?${query}`);
    const match = Array.isArray(response.data) ? response.data.find(value => value && typeof value === "object" && (value as { hash?: unknown }).hash === id) as Record<string, unknown> | undefined : undefined;
    if (!match || match.status === "DELETED" || match.status === "INTERNAL" || (match.account_id && accountNumber(String(match.account_id)) !== accountNumber(accountId))) throw new Error("Selected image is not available in this ad account.");
    return { id, name: safeText(match.name) || `Image ${id}`, previewUrl: safePreview(match.url_128) } satisfies MetaAsset;
  }
  if (kind === "creative") {
    if (!creativeId(id)) throw new Error("Choose a creative from the selected account.");
    const query = new URLSearchParams({ fields: "id,account_id,name,body,title,thumbnail_url,status" });
    const item = await directGraphRequest(`/${id}?${query}`);
    if (item.id !== id || accountNumber(String(item.account_id || "")) !== accountNumber(accountId) || item.status === "DELETED" || item.status === "ARCHIVED") throw new Error("Selected creative is not available in this ad account.");
    return { id, name: safeText(item.name) || `Creative ${id}`, summary: safeText(item.title || item.body, 180), previewUrl: safePreview(item.thumbnail_url) } satisfies MetaAsset;
  }
  throw new Error("Choose images or creatives.");
}
