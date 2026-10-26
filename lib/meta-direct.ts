import crypto from "node:crypto";
import { deleteSecure, getSecure, putSecure } from "./secure-store";

export const META_GRAPH_API_VERSION = "v26.0";
const GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_API_VERSION}`;
const APPROVAL_TTL = 5 * 60;
type Args = { accountId: string; name: string; objective: string; specialAdCategories: string[] };
type Approval = { user: string; args: Args; hash: string; expiresAt: number };
const approvalKey = (user: string, id: string) => `meta:direct:campaign-approval:${user}:${id}`;
const normalizeAccountId = (value: string) => value.trim().replace(/^act_/i, "");
const allowedAccounts = () => new Set((process.env.META_WRITE_ACCOUNT_IDS || "").split(",").map(normalizeAccountId).filter(Boolean));
const token = () => process.env.META_SYSTEM_USER_TOKEN || "";
export const DIRECT_CAMPAIGN_OBJECTIVES = ["OUTCOME_AWARENESS", "OUTCOME_TRAFFIC", "OUTCOME_ENGAGEMENT", "OUTCOME_LEADS", "OUTCOME_SALES", "OUTCOME_APP_PROMOTION"] as const;
export const DIRECT_SPECIAL_AD_CATEGORIES = ["HOUSING", "EMPLOYMENT", "CREDIT", "ISSUES_ELECTIONS_POLITICS", "ONLINE_GAMBLING_AND_GAMING", "FINANCIAL_PRODUCTS_SERVICES"] as const;

export function directMetaConfiguration() {
  const missing: string[] = [];
  if (!token()) missing.push("META_SYSTEM_USER_TOKEN");
  return { configured: missing.length === 0, writeEnabled: process.env.META_WRITE_ENABLED === "true", tokenConfigured: Boolean(token()), missing };
}
export function validateDirectCampaignArgs(input: Record<string, unknown>) {
  const missing: string[] = [];
  const accountId = typeof input.accountId === "string" ? input.accountId.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const objective = typeof input.objective === "string" ? input.objective.trim() : "";
  const categories = Array.isArray(input.specialAdCategories) ? input.specialAdCategories.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map(value => value.trim()) : [];
  if (!accountId) missing.push("accountId");
  if (!name) missing.push("name");
  if (!objective) missing.push("objective");
  if (objective && !(DIRECT_CAMPAIGN_OBJECTIVES as readonly string[]).includes(objective)) missing.push("objective must be a supported campaign objective");
  if (!Array.isArray(input.specialAdCategories)) missing.push("specialAdCategories (required; use [] when no category applies)");
  if (Array.isArray(input.specialAdCategories) && categories.length !== input.specialAdCategories.length) missing.push("specialAdCategories must contain documented values");
  if (categories.some(category => !(DIRECT_SPECIAL_AD_CATEGORIES as readonly string[]).includes(category))) missing.push("specialAdCategories must contain documented values");
  return { missing, args: { accountId, name, objective, specialAdCategories: categories } };
}
const objectiveMap: Record<string, string> = { awareness: "OUTCOME_AWARENESS", traffic: "OUTCOME_TRAFFIC", engagement: "OUTCOME_ENGAGEMENT", leads: "OUTCOME_LEADS", sales: "OUTCOME_SALES", "app promotion": "OUTCOME_APP_PROMOTION" };
export function parseCampaignRequest(text: string, accounts: Array<{ id: string; name?: string }>) {
  const lower = text.toLowerCase();
  if (!/\b(create|launch|start|make|set up)\b.{0,40}\bcampaign\b/i.test(text)) return null;
  const nameMatch = text.match(/\b(?:campaign\s+(?:called|named)|called|named)\s+["“]?([^"”\n,]+)["”]?/i);
  const name = nameMatch?.[1]?.trim() || "";
  const objectiveKey = Object.keys(objectiveMap).find(key => lower.includes(key));
  const rawObjective = text.match(/\b(OUTCOME_[A-Z_]+)\b/i)?.[1]?.toUpperCase() || "";
  const objective = rawObjective || (objectiveKey ? objectiveMap[objectiveKey] : "");
  const categories: string[] = lower.includes("no special") || lower.includes("no category") || lower.includes("regular campaign") ? [] : ["housing", "employment", "credit", "politics", "gambling", "financial"].filter(value => lower.includes(value));
  const specialAdCategories = categories.length ? [categories[0] === "politics" ? "ISSUES_ELECTIONS_POLITICS" : categories[0] === "gambling" ? "ONLINE_GAMBLING_AND_GAMING" : categories[0] === "financial" ? "FINANCIAL_PRODUCTS_SERVICES" : categories[0].toUpperCase()] : (lower.includes("special") ? [] : undefined);
  const accountMatches = accounts.filter(account => lower.includes(account.id.toLowerCase()) || (account.name && lower.includes(account.name.toLowerCase())));
  const missing = [...(!name ? ["campaign name"] : []), ...(!objective ? ["objective (for example awareness, traffic, engagement, leads, sales, or app promotion)"] : []), ...(specialAdCategories === undefined ? ["special ad category choice (say no special category if none applies)"] : []), ...(accountMatches.length === 1 ? [] : [accountMatches.length ? "which accessible account" : "accessible ad account"])];
  return { name, objective, specialAdCategories, accountMatches, missing };
}
function hash(args: Args) { return crypto.createHash("sha256").update(JSON.stringify(args)).digest("hex"); }
type MetaErrorDetails = { code?: number; error_subcode?: number; type?: string; message?: string; error_user_title?: string; error_user_msg?: string; fbtrace_id?: string };
class MetaGraphError extends Error { constructor(readonly status: number, readonly details: MetaErrorDetails = {}) { super("Meta Graph API request failed"); } }
export async function directGraphRequest(path: string, init?: RequestInit) { const response = await fetch(`${GRAPH_BASE}${path}`, { ...init, headers: { Accept: "application/json", ...(init?.headers || {}), Authorization: `Bearer ${token()}` }, cache: "no-store" }); const payload = await response.json().catch(() => ({})); if (!response.ok) { const error = payload && typeof payload === "object" && "error" in payload ? (payload as { error?: MetaErrorDetails }).error : undefined; throw new MetaGraphError(response.status, error || {}); } return payload as Record<string, unknown>; }
const graph = directGraphRequest;
function safeApiMessage(message: string | undefined) { if (!message) return ""; let safe = message; for (const secret of [process.env.META_SYSTEM_USER_TOKEN, process.env.AUTH_GOOGLE_SECRET, process.env.META_MCP_CLIENT_SECRET]) if (secret && secret.length > 4) safe = safe.split(secret).join("[redacted]"); return safe.replace(/(?:access[_ ]?token|token|oauth|bearer)\s*[:=]?\s*[^\s,;]+/gi, "authorization detail").replace(/https?:\/\/\S+/gi, "external URL").slice(0, 240); }
export function sanitizeMetaErrorDetails(details: MetaErrorDetails) { return { code: details.code, error_subcode: details.error_subcode, type: details.type, message: safeApiMessage(details.message), error_user_title: safeApiMessage(details.error_user_title), error_user_msg: safeApiMessage(details.error_user_msg), fbtrace_id: details.fbtrace_id }; }
export function publicMetaError(error: unknown) { if (!(error instanceof MetaGraphError)) return undefined; return sanitizeMetaErrorDetails(error.details); }
export function sanitizedGraphError(error: unknown) { if (!(error instanceof MetaGraphError)) return "Meta API request failed. Try again or contact an administrator."; if (error.status === 401 || error.details.code === 190) return "Meta authorization failed. Reconnect or ask an administrator to check the system-user token."; if (error.status === 403) return "Meta denied this action. Confirm the token has ads_management access to this account."; if (error.status === 400) return `Meta rejected the campaign details${safeApiMessage(error.details.message) ? `: ${safeApiMessage(error.details.message)}` : ". Check the account, objective, and special category selection."}`; return "Meta could not complete the request. Try again or contact an administrator."; }
export async function directMetaReadiness() {
  const config = directMetaConfiguration();
  const emptyAccounts: Array<{ id: string; name?: string; account_status?: number; tasks?: string[]; currency?: string }> = [];
  if (!config.configured) return { ...config, permissionsChecked: false, permissions: [] as string[], accounts: emptyAccounts, graphError: "missing_configuration" as const };
  let permissions: string[] = []; let accounts = emptyAccounts; let permissionError = ""; let accountError = "";
  try { const payload = await graph("/me/permissions"); permissions = Array.isArray(payload.data) ? payload.data.filter((item): item is { permission: string; status: string } => Boolean(item && typeof item === "object" && typeof (item as { permission?: unknown }).permission === "string" && typeof (item as { status?: unknown }).status === "string")).map(item => `${item.permission}:${item.status}`) : []; } catch (error) { permissionError = error instanceof MetaGraphError && error.status === 401 ? "permission_error" : "graph_api_error"; }
  try { const payload = await graph("/me/adaccounts?fields=id,name,account_status,tasks,currency&limit=100"); accounts = Array.isArray(payload.data) ? payload.data.filter((item): item is { id: string; name?: string; account_status?: number; tasks?: string[]; currency?: string } => Boolean(item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string")).map(item => ({ id: item.id, name: item.name, account_status: item.account_status, tasks: Array.isArray(item.tasks) ? item.tasks.filter((task): task is string => typeof task === "string") : [], currency: typeof item.currency === "string" ? item.currency : undefined })) : []; } catch (error) { accountError = error instanceof MetaGraphError && error.status === 401 ? "permission_error" : "graph_api_error"; }
  let tokenApp: { appId?: string; appName?: string; userId?: string; scopes?: string[] } = {};
  try { const payload = await graph(`/debug_token?input_token=${encodeURIComponent(token())}&access_token=${encodeURIComponent(token())}`); const data = payload.data && typeof payload.data === "object" ? payload.data as { app_id?: string; application?: string; user_id?: string; scopes?: unknown } : {}; tokenApp = { appId: data.app_id, appName: data.application, userId: data.user_id, scopes: Array.isArray(data.scopes) ? data.scopes.filter((scope): scope is string => typeof scope === "string") : [] }; } catch { /* Best-effort diagnostic; never blocks readiness. */ }
  return { ...config, permissionsChecked: !permissionError, permissions, accounts, allowedAccounts: accounts.filter(account => allowedAccounts().has(account.id)).map(account => account.id), tokenApp, graphError: permissionError || accountError || null };
}
export async function prepareDirectCampaign(user: string, input: Record<string, unknown>) {
  const config = directMetaConfiguration();
  if (!config.writeEnabled) return { ok: false as const, missing: ["META_WRITE_ENABLED=true"] };
  if (!config.configured) return { ok: false as const, missing: config.missing };
  const validation = validateDirectCampaignArgs(input);
  if (validation.missing.length) return { ok: false as const, missing: validation.missing };
  if (allowedAccounts().size && !allowedAccounts().has(normalizeAccountId(validation.args.accountId))) return { ok: false as const, missing: ["an explicitly allowed account"] };
  const readiness = await directMetaReadiness();
  if (!readiness.permissionsChecked) return { ok: false as const, missing: ["Meta permission/account readiness check"] };
  if (!readiness.permissions.includes("ads_management:granted")) return { ok: false as const, missing: ["ads_management permission"] };
  if (!readiness.accounts.some(account => normalizeAccountId(account.id) === normalizeAccountId(validation.args.accountId))) return { ok: false as const, missing: ["the selected account is not accessible to this token"] };
  const id = crypto.randomUUID();
  await putSecure(approvalKey(user, id), { user, args: validation.args, hash: hash(validation.args), expiresAt: Date.now() + APPROVAL_TTL * 1000 }, APPROVAL_TTL);
  return { ok: true as const, approvalId: id, expiresInSeconds: APPROVAL_TTL, args: validation.args };
}
export function directCampaignPayload(args: Args) { return new URLSearchParams({ name: args.name, objective: args.objective, special_ad_categories: JSON.stringify(args.specialAdCategories.length ? args.specialAdCategories : ["NONE"]), status: "PAUSED", is_adset_budget_sharing_enabled: "false" }); }
export async function executeDirectCampaign(user: string, approvalId: string) {
  const key = approvalKey(user, approvalId); const approval = await getSecure<Approval>(key);
  if (!approval || approval.user !== user || approval.expiresAt < Date.now() || hash(approval.args) !== approval.hash) return { ok: false as const, error: "Approval expired or invalid." };
  await deleteSecure(key);
  const body = directCampaignPayload(approval.args);
  let created: Record<string, unknown>; try { created = await graph(`/act_${encodeURIComponent(approval.args.accountId.replace(/^act_/, ""))}/campaigns`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }); } catch (error) { return { ok: false as const, error: sanitizedGraphError(error), diagnostics: publicMetaError(error) }; }
  const campaignId = typeof created.id === "string" ? created.id : "";
  if (!campaignId) return { ok: false as const, error: "Meta returned no campaign ID." };
  let readback: Record<string, unknown>; try { readback = await graph(`/${encodeURIComponent(campaignId)}?fields=id,name,objective,status,special_ad_categories`); } catch (error) { return { ok: false as const, error: `Campaign ${campaignId} was created, but Meta readback failed. ${sanitizedGraphError(error)}`, diagnostics: publicMetaError(error) }; }
  const state = typeof readback.status === "string" ? readback.status : "UNKNOWN";
  if (state !== "PAUSED") return { ok: false as const, error: "Campaign was created but did not verify as PAUSED." };
  return { ok: true as const, verified: true, campaignId, state, accountId: approval.args.accountId, objective: typeof readback.objective === "string" ? readback.objective : approval.args.objective };
}
