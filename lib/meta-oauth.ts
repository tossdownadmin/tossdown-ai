import crypto from "node:crypto";
import { auth as mcpAuth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { getSecure, putSecure, deleteSecure } from "./secure-store";
import { getRedisConfig } from "./redis";

export const META_MCP_URL = "https://mcp.facebook.com/ads";
export const META_RESOURCE_METADATA_URL = "https://mcp.facebook.com/.well-known/oauth-protected-resource/ads";
export const META_AUTHORIZATION_SERVER = "https://www.facebook.com/ads";
// Minimal documented scope set for read-only Ads MCP access. Optional branded-content,
// page-management, catalog-management, and write-ad permissions are intentionally excluded.
export const META_SCOPES = "ads_read";
export const META_MCP_SCOPE = "ads_mcp_management";
export const META_WRITE_SCOPE = "ads_management";
type StoredState = { state: string; verifier: string; redirectUri: string };
type StoredTokens = { access_token: string; refresh_token?: string; token_type: string; expires_in?: number; expires_at?: number; issuer?: string };
const stateKey = (user: string) => `mcp:meta:oauth-state:${user}`;
const tokenKey = (user: string) => `mcp:meta:tokens:${user}`;
export function validateMetaOAuthState(stored: StoredState | null, returnedState: string, redirectUri: string) { return Boolean(stored && stored.state === returnedState && stored.redirectUri === redirectUri); }
export function metaOAuthConfigured() { return metaOAuthConfiguration().configured; }
export function metaWriteEnabled() { return process.env.META_WRITE_ENABLED === "true"; }
export function metaScopesForPermissions(granted: string[]) { const required = [!granted.includes(META_MCP_SCOPE) ? META_MCP_SCOPE : "", metaWriteEnabled() && !granted.includes(META_WRITE_SCOPE) ? META_WRITE_SCOPE : ""].filter(Boolean); return [META_SCOPES, ...required].join(" "); }
export function metaOAuthConfiguration() {
  const missing: string[] = [];
  if (process.env.MCP_ENABLED !== "true") missing.push("MCP_ENABLED=true");
  if (process.env.MCP_REQUIRE_AUTH !== "true") missing.push("MCP_REQUIRE_AUTH=true");
  if (!process.env.META_MCP_CLIENT_ID) missing.push("META_MCP_CLIENT_ID");
  if (!process.env.MCP_TOKEN_ENCRYPTION_KEY) missing.push("MCP_TOKEN_ENCRYPTION_KEY");
  if (!(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL)) missing.push("UPSTASH_REDIS_REST_URL or KV_REST_API_URL");
  if (!(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)) missing.push("UPSTASH_REDIS_REST_TOKEN or KV_REST_API_TOKEN");
  if (process.env.MCP_META_ADS_URL && process.env.MCP_META_ADS_URL !== META_MCP_URL) missing.push("MCP_META_ADS_URL (must be the official Meta MCP URL)");
  return { configured: missing.length === 0, missing: [...new Set(missing)] };
}
export async function metaPermissionStatus(user: string) {
  const token = await metaAccessToken(user);
  if (!token) return { checked: false, granted: [] as string[], missingRequired: [META_MCP_SCOPE], missingWrite: metaWriteEnabled() ? [META_WRITE_SCOPE] : [] };
  try {
    const response = await fetch("https://graph.facebook.com/v26.0/me/permissions", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!response.ok) return { checked: false, granted: [] as string[], missingRequired: [META_MCP_SCOPE], missingWrite: metaWriteEnabled() ? [META_WRITE_SCOPE] : [] };
    const payload = await response.json() as { data?: Array<{ permission?: string; status?: string }> };
    const granted = (payload.data || []).filter(item => item.status === "granted" && typeof item.permission === "string").map(item => item.permission as string);
    return { checked: true, granted, missingRequired: !granted.includes(META_MCP_SCOPE) ? [META_MCP_SCOPE] : [], missingWrite: metaWriteEnabled() && !granted.includes(META_WRITE_SCOPE) ? [META_WRITE_SCOPE] : [] };
  } catch { return { checked: false, granted: [] as string[], missingRequired: [META_MCP_SCOPE], missingWrite: metaWriteEnabled() ? [META_WRITE_SCOPE] : [] }; }
}
export async function metaConnectionStatus(user: string) { const configuration = metaOAuthConfiguration(); const tokens = configuration.configured ? await getSecure<StoredTokens>(tokenKey(user)) : null; const permissions = tokens ? await metaPermissionStatus(user) : { checked: false, granted: [] as string[], missingRequired: [META_MCP_SCOPE], missingWrite: metaWriteEnabled() ? [META_WRITE_SCOPE] : [] }; return { ...configuration, connected: Boolean(tokens?.access_token), writeEnabled: metaWriteEnabled(), permissions, reconnectRequired: Boolean(tokens && (permissions.missingRequired.length || permissions.missingWrite.length)) }; }
class Provider implements OAuthClientProvider {
  authorizationUrl?: URL;
  constructor(private readonly user: string, private readonly redirectUri: string) {}
  get redirectUrl() { return this.redirectUri; }
  get clientMetadata() { return { client_name: "tossdown AI", redirect_uris: [this.redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none", scope: META_SCOPES }; }
  async clientInformation() { const clientId = process.env.META_MCP_CLIENT_ID; return clientId ? { client_id: clientId, issuer: META_AUTHORIZATION_SERVER, token_endpoint_auth_method: "none" as const } : undefined; }
  async tokens() { return (await getSecure<StoredTokens>(tokenKey(this.user))) || undefined; }
  async saveTokens(tokens: StoredTokens) { await putSecure(tokenKey(this.user), tokens, 60 * 60 * 24 * 60); }
  async saveCodeVerifier(verifier: string) { const current = await getSecure<StoredState>(stateKey(this.user)); if (current) await putSecure(stateKey(this.user), { ...current, verifier }, 600); }
  async codeVerifier() { const value = await getSecure<StoredState>(stateKey(this.user)); if (!value) throw new Error("OAuth state expired"); return value.verifier; }
  async redirectToAuthorization(url: URL) { this.authorizationUrl = url; }
  async state() { const value = await getSecure<StoredState>(stateKey(this.user)); if (!value) throw new Error("OAuth state expired"); return value.state; }
}
export async function requestedMetaScopes(user: string) { const permissions = await metaPermissionStatus(user); return metaScopesForPermissions(permissions.granted); }
export async function startMetaOAuth(user: string, redirectUri: string) { if (!metaOAuthConfigured()) throw new Error("META_MCP_NOT_CONFIGURED"); const state = cryptoRandom(); await putSecure(stateKey(user), { state, verifier: "", redirectUri }, 600); const provider = new Provider(user, redirectUri); await mcpAuth(provider, { serverUrl: META_MCP_URL, resourceMetadataUrl: new URL(META_RESOURCE_METADATA_URL), scope: await requestedMetaScopes(user) }); if (!provider.authorizationUrl) throw new Error("META_OAUTH_URL_NOT_CREATED"); return { url: provider.authorizationUrl.toString(), state }; }
export async function finishMetaOAuth(user: string, code: string, returnedState: string, redirectUri: string) { const stored = await getSecure<StoredState>(stateKey(user)); if (!validateMetaOAuthState(stored, returnedState, redirectUri)) throw new Error("META_OAUTH_STATE_INVALID"); const provider = new Provider(user, redirectUri); await putSecure(stateKey(user), stored, 600); await mcpAuth(provider, { serverUrl: META_MCP_URL, resourceMetadataUrl: new URL(META_RESOURCE_METADATA_URL), authorizationCode: code, scope: await requestedMetaScopes(user) }); await deleteSecure(stateKey(user)); }
export async function disconnectMeta(user: string) { await deleteSecure(tokenKey(user)); }
export async function metaAccessToken(user: string) { return (await getSecure<StoredTokens>(tokenKey(user)))?.access_token || null; }
function cryptoRandom() { return Array.from(cryptoBytes(24), b => b.toString(16).padStart(2, "0")).join(""); }
function cryptoBytes(length: number) { const bytes = new Uint8Array(length); if (typeof crypto.randomFillSync === "function") crypto.randomFillSync(bytes); return bytes; }
